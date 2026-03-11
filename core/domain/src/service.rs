use std::{
    collections::{hash_map::DefaultHasher, HashMap, HashSet},
    hash::{Hash, Hasher},
    sync::Arc,
    time::{Duration, Instant},
};

use reqwest::Client;
use url::Url;

use crate::{
    dto::{
        ChatMessage, ChatMessageRole, ChatWithAgentRequest, ChatWithAgentResponse,
        ChatWithSessionRequest, ChatWithSessionResponse, CreateAgentRequest,
        CreateModelRequest, CreateProviderRequest, CreateWorkspaceChatSessionRequest,
        ProbeModelConnectionRequest, ProbeModelConnectionResponse, ProbeProviderConnectionRequest,
        ProbeProviderConnectionResponse, RegenerateChatReplyRequest, RewriteChatUserMessageRequest,
        RewriteLastUserMessageRequest, RuntimeStats, UndoLastChatTurnRequest,
        UndoLastChatTurnResponse, UpdateAgentRequest, UpdateModelRequest,
        UpdateProviderRequest, UpdateWorkspaceChatSessionRequest,
    },
    error::{AppError, AppResult},
    repository::{
        AgentRepository, ChatRepository, ModelRepository, ProviderRepository,
        WorkspaceChatRepository,
    },
    runtime::{ChatCompletionGateway, CompletionRequest},
    types::{
        AgentConfig, AgentMode, AgentParamSlots, ChatSession, CustomProvider, ModelCategory,
        ModelConfig, ModelParams, ProviderConfig, SlotParams, WorkspaceChatMessage,
        WorkspaceChatMessageRole, WorkspaceChatParticipant, WorkspaceChatParticipantMode,
        WorkspaceChatReply, WorkspaceChatSession,
    },
};

const MAX_HISTORY_MESSAGES: usize = 100;

struct ReplyCompletion {
    model_ref_id: String,
    model_id: String,
    text: String,
}

#[derive(Clone)]
pub struct AppService<R>
where
    R: ProviderRepository
        + ModelRepository
        + AgentRepository
        + ChatRepository
        + WorkspaceChatRepository,
{
    repo: Arc<R>,
}

impl<R> AppService<R>
where
    R: ProviderRepository
        + ModelRepository
        + AgentRepository
        + ChatRepository
        + WorkspaceChatRepository,
{
    pub fn new(repo: Arc<R>) -> Self {
        Self { repo }
    }

    pub async fn runtime_stats(&self) -> AppResult<RuntimeStats> {
        let providers = self.repo.list_providers().await?;
        let models = self.repo.list_models().await?;
        let agents = self.repo.list_agents().await?;
        let (chat_session_count, chat_message_count) = self.repo.chat_counts().await?;
        let (workspace_session_count, workspace_message_count) = self.repo.workspace_chat_counts().await?;

        Ok(RuntimeStats {
            provider_count: providers.len() as i64,
            model_count: models.len() as i64,
            agent_count: agents.len() as i64,
            session_count: chat_session_count + workspace_session_count,
            message_count: chat_message_count + workspace_message_count,
        })
    }

    pub async fn probe_provider_connection(
        &self,
        input: ProbeProviderConnectionRequest,
    ) -> AppResult<ProbeProviderConnectionResponse> {
        let provider_id = input.provider_id.trim();
        if provider_id.is_empty() {
            return Err(AppError::validation("providerId is required"));
        }

        let provider = self.repo.get_provider(provider_id).await?;
        if !provider.enabled {
            return Err(AppError::validation("provider is disabled"));
        }
        validate_url(&provider.api_base)?;

        let mut probe_url = provider.api_base.trim().trim_end_matches('/').to_string();
        probe_url.push_str("/models");

        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|error| AppError::internal(format!("failed to create probe client: {error}")))?;

        let mut request = client.get(&probe_url);
        if let Some(key) = provider
            .keys
            .iter()
            .map(|item| item.trim())
            .find(|item| !item.is_empty())
        {
            request = request.bearer_auth(key);
        }

        let started_at = Instant::now();
        let result = request.send().await;
        let latency_ms = probe_latency_ms(started_at.elapsed().as_millis());

        match result {
            Ok(response) => Ok(ProbeProviderConnectionResponse {
                provider_id: provider.id,
                reachable: true,
                latency_ms,
                detail: format!("HTTP {}", response.status().as_u16()),
            }),
            Err(error) => Ok(ProbeProviderConnectionResponse {
                provider_id: provider.id,
                reachable: false,
                latency_ms,
                detail: error.to_string(),
            }),
        }
    }

    pub async fn probe_model_connection<G>(
        &self,
        gateway: &G,
        input: ProbeModelConnectionRequest,
    ) -> AppResult<ProbeModelConnectionResponse>
    where
        G: ChatCompletionGateway,
    {
        let model_ref_id = input.model_ref_id.trim();
        if model_ref_id.is_empty() {
            return Err(AppError::validation("modelRefId is required"));
        }

        let model = self.repo.get_model(model_ref_id).await?;
        if !model.enabled {
            return Err(AppError::validation("model is disabled"));
        }

        let (api_base, api_key) = if let Some(custom_provider) = &model.custom_provider {
            (
                custom_provider.api_base.trim().to_string(),
                non_empty(custom_provider.api_key.trim()),
            )
        } else if let Some(provider_ref) = &model.provider_ref {
            let provider = self.repo.get_provider(provider_ref).await?;
            if !provider.enabled {
                return Err(AppError::validation("provider is disabled"));
            }
            (
                provider.api_base.trim().to_string(),
                pick_provider_key(&provider.keys, &model.id),
            )
        } else {
            return Err(AppError::validation(
                "model must use providerRef or customProvider",
            ));
        };
        if api_base.is_empty() {
            return Err(AppError::validation("apiBase is required"));
        }

        let started_at = Instant::now();
        let result = gateway
            .complete(CompletionRequest {
                api_base,
                api_key,
                model_id: model.model_id.clone(),
                messages: vec![
                    ChatMessage {
                        role: ChatMessageRole::System,
                        content: "You are a health-check probe. Reply with one short line."
                            .to_string(),
                    },
                    ChatMessage {
                        role: ChatMessageRole::User,
                        content: "probe".to_string(),
                    },
                ],
                params: ModelParams {
                    temperature: model.params.temperature,
                    max_tokens: model.params.max_tokens.clamp(1, 32),
                    top_p: model.params.top_p,
                    frequency_penalty: model.params.frequency_penalty,
                },
            })
            .await;
        let latency_ms = probe_latency_ms(started_at.elapsed().as_millis());

        match result {
            Ok(response) => {
                let detail = if response.text.trim().is_empty() {
                    "model responded with empty text".to_string()
                } else {
                    let snippet = response.text.chars().take(120).collect::<String>();
                    format!("model responded: {snippet}")
                };
                Ok(ProbeModelConnectionResponse {
                    model_ref_id: model.id,
                    model_id: model.model_id,
                    reachable: true,
                    latency_ms,
                    detail,
                })
            }
            Err(error) => Ok(ProbeModelConnectionResponse {
                model_ref_id: model.id,
                model_id: model.model_id,
                reachable: false,
                latency_ms,
                detail: error.payload().message,
            }),
        }
    }

    pub async fn list_providers(&self) -> AppResult<Vec<ProviderConfig>> {
        self.repo.list_providers().await
    }

    pub async fn create_provider(
        &self,
        mut input: CreateProviderRequest,
    ) -> AppResult<ProviderConfig> {
        normalize_provider_fields(
            &mut input.display_name,
            &mut input.provider_kind,
            &mut input.api_base,
        );
        validate_provider_input(&input)?;
        input.keys = sanitize_keys(&input.keys);
        self.repo.create_provider(input).await
    }

    pub async fn update_provider(
        &self,
        id: &str,
        mut input: UpdateProviderRequest,
    ) -> AppResult<ProviderConfig> {
        normalize_provider_fields(
            &mut input.display_name,
            &mut input.provider_kind,
            &mut input.api_base,
        );
        validate_provider_input(&input)?;
        input.keys = sanitize_keys(&input.keys);
        self.repo.update_provider(id, input).await
    }

    pub async fn delete_provider(&self, id: &str) -> AppResult<()> {
        if self.repo.is_provider_in_use(id).await? {
            return Err(AppError::reference_in_use(
                "provider is referenced by one or more models",
            ));
        }
        self.repo.delete_provider(id).await
    }

    pub async fn list_models(&self) -> AppResult<Vec<ModelConfig>> {
        self.repo.list_models().await
    }

    pub async fn create_model(&self, mut input: CreateModelRequest) -> AppResult<ModelConfig> {
        normalize_model_input(
            &mut input.name,
            &mut input.model_id,
            &mut input.provider_ref,
            &mut input.custom_provider,
            &mut input.category,
            &mut input.categories,
            &mut input.capabilities.input_modes,
            &mut input.capabilities.output_modes,
        );
        self.validate_model_input(&input).await?;
        self.repo.create_model(input).await
    }

    pub async fn update_model(
        &self,
        id: &str,
        mut input: UpdateModelRequest,
    ) -> AppResult<ModelConfig> {
        normalize_model_input(
            &mut input.name,
            &mut input.model_id,
            &mut input.provider_ref,
            &mut input.custom_provider,
            &mut input.category,
            &mut input.categories,
            &mut input.capabilities.input_modes,
            &mut input.capabilities.output_modes,
        );
        self.validate_model_update(&input).await?;
        self.repo.update_model(id, input).await
    }

    pub async fn delete_model(&self, id: &str) -> AppResult<()> {
        if self.repo.is_model_in_use(id).await? {
            return Err(AppError::reference_in_use(
                "model is referenced by one or more agents",
            ));
        }
        self.repo.delete_model(id).await
    }

    pub async fn list_agents(&self) -> AppResult<Vec<AgentConfig>> {
        self.repo.list_agents().await
    }

    pub async fn create_agent(&self, mut input: CreateAgentRequest) -> AppResult<AgentConfig> {
        normalize_agent_text_fields(&mut input.name, &mut input.persona, &mut input.speech_rules);
        normalize_agent_model_refs(
            &mut input.reply_model_id,
            &mut input.component_slot.asr_model_id,
            &mut input.component_slot.tts_model_id,
            &mut input.component_slot.vision_model_id,
            &mut input.tool_slot.planner_model_id,
            &mut input.tool_slot.executor_model_id,
            input.decision_slot.enabled,
            &mut input.decision_slot.model_id,
        );

        self.validate_agent_input(
            &input.name,
            &input.persona,
            &input.speech_rules,
            &input.reply_model_id,
            &input.mode,
            input.component_slot.asr_model_id.as_deref(),
            input.component_slot.tts_model_id.as_deref(),
            input.component_slot.vision_model_id.as_deref(),
            input.tool_slot.planner_model_id.as_deref(),
            input.tool_slot.executor_model_id.as_deref(),
            input.decision_slot.enabled,
            input.decision_slot.model_id.as_deref(),
            &input.param_slots,
        )
        .await?;

        self.repo.create_agent(input).await
    }

    pub async fn update_agent(
        &self,
        id: &str,
        mut input: UpdateAgentRequest,
    ) -> AppResult<AgentConfig> {
        normalize_agent_text_fields(&mut input.name, &mut input.persona, &mut input.speech_rules);
        normalize_agent_model_refs(
            &mut input.reply_model_id,
            &mut input.component_slot.asr_model_id,
            &mut input.component_slot.tts_model_id,
            &mut input.component_slot.vision_model_id,
            &mut input.tool_slot.planner_model_id,
            &mut input.tool_slot.executor_model_id,
            input.decision_slot.enabled,
            &mut input.decision_slot.model_id,
        );

        self.validate_agent_input(
            &input.name,
            &input.persona,
            &input.speech_rules,
            &input.reply_model_id,
            &input.mode,
            input.component_slot.asr_model_id.as_deref(),
            input.component_slot.tts_model_id.as_deref(),
            input.component_slot.vision_model_id.as_deref(),
            input.tool_slot.planner_model_id.as_deref(),
            input.tool_slot.executor_model_id.as_deref(),
            input.decision_slot.enabled,
            input.decision_slot.model_id.as_deref(),
            &input.param_slots,
        )
        .await?;

        self.repo.update_agent(id, input).await
    }

    pub async fn delete_agent(&self, id: &str) -> AppResult<()> {
        self.repo.delete_agent(id).await
    }

    pub async fn list_agent_chat_sessions(&self, agent_id: &str) -> AppResult<Vec<ChatSession>> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        self.repo.get_agent(agent_id).await?;
        self.repo.list_agent_chat_sessions(agent_id).await
    }

    pub async fn create_agent_chat_session(
        &self,
        agent_id: &str,
        title: &str,
    ) -> AppResult<ChatSession> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        let title = title.trim();
        validate_chat_session_title(title)?;
        self.repo.get_agent(agent_id).await?;
        self.repo.create_agent_chat_session(agent_id, title).await
    }

    pub async fn rename_agent_chat_session(
        &self,
        agent_id: &str,
        session_id: &str,
        title: &str,
    ) -> AppResult<ChatSession> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        let title = title.trim();
        validate_chat_session_title(title)?;
        self.repo.get_agent(agent_id).await?;
        self.repo
            .rename_agent_chat_session(agent_id, session_id, title)
            .await
    }

    pub async fn duplicate_agent_chat_session(
        &self,
        agent_id: &str,
        source_session_id: &str,
        title: &str,
    ) -> AppResult<ChatSession> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        let source_session_id = source_session_id.trim();
        if source_session_id.is_empty() {
            return Err(AppError::validation("sourceSessionId is required"));
        }
        let title = title.trim();
        validate_chat_session_title(title)?;
        self.repo.get_agent(agent_id).await?;
        self.repo
            .duplicate_agent_chat_session(agent_id, source_session_id, title)
            .await
    }

    pub async fn set_agent_chat_session_pinned(
        &self,
        agent_id: &str,
        session_id: &str,
        pinned: bool,
    ) -> AppResult<ChatSession> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        self.repo.get_agent(agent_id).await?;
        self.repo
            .set_agent_chat_session_pinned(agent_id, session_id, pinned)
            .await
    }

    pub async fn set_agent_chat_session_archived(
        &self,
        agent_id: &str,
        session_id: &str,
        archived: bool,
    ) -> AppResult<ChatSession> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        self.repo.get_agent(agent_id).await?;
        self.repo
            .set_agent_chat_session_archived(agent_id, session_id, archived)
            .await
    }

    pub async fn set_agent_chat_session_tags(
        &self,
        agent_id: &str,
        session_id: &str,
        tags: &[String],
    ) -> AppResult<ChatSession> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        let tags = normalize_chat_session_tags(tags)?;
        self.repo.get_agent(agent_id).await?;
        self.repo
            .set_agent_chat_session_tags(agent_id, session_id, &tags)
            .await
    }

    pub async fn delete_agent_chat_session(&self, agent_id: &str, session_id: &str) -> AppResult<()> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        self.repo.get_agent(agent_id).await?;
        self.repo.delete_agent_chat_session(agent_id, session_id).await
    }

    pub async fn list_agent_chat_messages(&self, agent_id: &str) -> AppResult<Vec<ChatMessage>> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        self.repo.get_agent(agent_id).await?;
        self.repo.list_agent_chat_messages(agent_id).await
    }

    pub async fn clear_agent_chat_messages(&self, agent_id: &str) -> AppResult<()> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        self.repo.get_agent(agent_id).await?;
        self.repo.clear_agent_chat_messages(agent_id).await
    }

    pub async fn list_chat_session_messages(
        &self,
        agent_id: &str,
        session_id: &str,
    ) -> AppResult<Vec<ChatMessage>> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        self.repo.get_agent(agent_id).await?;
        self.repo.list_chat_session_messages(agent_id, session_id).await
    }

    pub async fn clear_chat_session_messages(&self, agent_id: &str, session_id: &str) -> AppResult<()> {
        let agent_id = agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        self.repo.get_agent(agent_id).await?;
        self.repo.clear_chat_session_messages(agent_id, session_id).await
    }

    pub async fn list_workspace_chat_sessions(&self) -> AppResult<Vec<WorkspaceChatSession>> {
        self.repo.list_workspace_chat_sessions().await
    }

    pub async fn create_workspace_chat_session(
        &self,
        input: CreateWorkspaceChatSessionRequest,
    ) -> AppResult<WorkspaceChatSession> {
        let title = input.title.trim();
        validate_chat_session_title(title)?;
        let participants = self
            .normalize_workspace_chat_participants(&input.participants)
            .await?;
        self.repo
            .create_workspace_chat_session(title, &participants)
            .await
    }

    pub async fn update_workspace_chat_session(
        &self,
        session_id: &str,
        input: UpdateWorkspaceChatSessionRequest,
    ) -> AppResult<WorkspaceChatSession> {
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        let title = input.title.trim();
        validate_chat_session_title(title)?;
        let participants = self
            .normalize_workspace_chat_participants(&input.participants)
            .await?;
        let tags = normalize_chat_session_tags(&input.tags)?;
        self.repo
            .update_workspace_chat_session(
                session_id,
                title,
                &participants,
                input.is_pinned,
                input.is_archived,
                &tags,
            )
            .await
    }

    pub async fn delete_workspace_chat_session(&self, session_id: &str) -> AppResult<()> {
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        self.repo.delete_workspace_chat_session(session_id).await
    }

    pub async fn list_workspace_chat_messages(
        &self,
        session_id: &str,
    ) -> AppResult<Vec<WorkspaceChatMessage>> {
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        self.repo.list_workspace_chat_messages(session_id).await
    }

    pub async fn clear_workspace_chat_messages(&self, session_id: &str) -> AppResult<()> {
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        self.repo.clear_workspace_chat_messages(session_id).await
    }

    pub async fn chat_with_session<G>(
        &self,
        gateway: &G,
        input: ChatWithSessionRequest,
    ) -> AppResult<ChatWithSessionResponse>
    where
        G: ChatCompletionGateway,
    {
        let session_id = input.session_id.trim();
        let user_message = input.user_message.trim();
        if session_id.is_empty() {
            return Err(AppError::validation("sessionId is required"));
        }
        if user_message.is_empty() {
            return Err(AppError::validation("userMessage is required"));
        }

        let session = self.repo.get_workspace_chat_session(session_id).await?;
        let participant_configs = self
            .load_workspace_participant_agents(&session.participants)
            .await?;
        let visible_to_agent_ids = participant_configs
            .iter()
            .filter(|agent| {
                let participant = session
                    .participants
                    .iter()
                    .find(|item| item.agent_id == agent.id)
                    .expect("participant config missing");
                participant_receives_message(participant, agent, user_message)
            })
            .map(|agent| agent.id.clone())
            .collect::<Vec<_>>();

        let mut message_buffer = self.repo.list_workspace_chat_messages(session_id).await?;
        message_buffer.push(WorkspaceChatMessage {
            role: WorkspaceChatMessageRole::User,
            content: user_message.to_string(),
            agent_id: None,
            visible_to_agent_ids: visible_to_agent_ids.clone(),
            created_at: String::new(),
        });

        let mut replies = Vec::<WorkspaceChatReply>::new();
        for participant in &session.participants {
            let Some(agent) = participant_configs.iter().find(|item| item.id == participant.agent_id) else {
                continue;
            };
            if !participant_receives_message(participant, agent, user_message) {
                continue;
            }
            if !participant_replies_to_message(participant, agent, user_message) {
                continue;
            }

            let runtime_history =
                build_workspace_runtime_history(&message_buffer, agent, &participant_configs);
            validate_chat_history(&runtime_history)?;
            let reply_completion = self
                .complete_workspace_agent_reply(
                    gateway,
                    agent,
                    &participant_configs,
                    user_message,
                    clamp_chat_history(runtime_history),
                    input.temperature,
                    input.max_tokens,
                    input.top_p,
                    input.frequency_penalty,
                )
                .await?;

            replies.push(WorkspaceChatReply {
                agent_id: agent.id.clone(),
                agent_name: agent.name.clone(),
                model_ref_id: reply_completion.model_ref_id,
                model_id: reply_completion.model_id,
                message: reply_completion.text.clone(),
            });
            message_buffer.push(WorkspaceChatMessage {
                role: WorkspaceChatMessageRole::Assistant,
                content: reply_completion.text,
                agent_id: Some(agent.id.clone()),
                visible_to_agent_ids: visible_to_agent_ids.clone(),
                created_at: String::new(),
            });
        }

        self.repo
            .append_workspace_chat_message(
                session_id,
                WorkspaceChatMessageRole::User,
                user_message.to_string(),
                None,
                &visible_to_agent_ids,
            )
            .await?;
        for reply in &replies {
            self.repo
                .append_workspace_chat_message(
                    session_id,
                    WorkspaceChatMessageRole::Assistant,
                    reply.message.clone(),
                    Some(&reply.agent_id),
                    &visible_to_agent_ids,
                )
                .await?;
        }

        Ok(ChatWithSessionResponse {
            session_id: session.id,
            replies,
        })
    }

    pub async fn chat_with_agent<G>(
        &self,
        gateway: &G,
        input: ChatWithAgentRequest,
    ) -> AppResult<ChatWithAgentResponse>
    where
        G: ChatCompletionGateway,
    {
        let agent_id = input.agent_id.trim();
        let user_message = input.user_message.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        if user_message.is_empty() {
            return Err(AppError::validation("userMessage is required"));
        }

        let agent = self.repo.get_agent(agent_id).await?;
        let session_id = self
            .resolve_chat_session_id(agent_id, input.session_id.as_deref())
            .await?;

        let runtime_history = if input.history.is_empty() {
            clamp_chat_history(
                self.repo
                    .list_chat_session_messages(agent_id, &session_id)
                    .await?,
            )
        } else {
            input.history
        };
        validate_chat_history(&runtime_history)?;

        let completion = self
            .complete_agent_reply(
                gateway,
                agent_id,
                &agent,
                user_message,
                runtime_history,
                input.temperature,
                input.max_tokens,
                input.top_p,
                input.frequency_penalty,
            )
            .await?;

        self.repo
            .append_chat_session_message(
                agent_id,
                &session_id,
                ChatMessageRole::User,
                user_message.to_string(),
            )
            .await?;
        self.repo
            .append_chat_session_message(
                agent_id,
                &session_id,
                ChatMessageRole::Assistant,
                completion.text.clone(),
            )
            .await?;

        Ok(ChatWithAgentResponse {
            agent_id: agent.id,
            session_id,
            model_ref_id: completion.model_ref_id,
            model_id: completion.model_id,
            message: completion.text,
        })
    }

    pub async fn regenerate_chat_reply<G>(
        &self,
        gateway: &G,
        input: RegenerateChatReplyRequest,
    ) -> AppResult<ChatWithAgentResponse>
    where
        G: ChatCompletionGateway,
    {
        let agent_id = input.agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }

        let agent = self.repo.get_agent(agent_id).await?;
        let session_id = self
            .resolve_chat_session_id(agent_id, input.session_id.as_deref())
            .await?;

        let runtime_history = clamp_chat_history(
            self.repo
                .list_chat_session_messages(agent_id, &session_id)
                .await?,
        );
        validate_chat_history(&runtime_history)?;

        let last_user_index = runtime_history
            .iter()
            .rposition(|message| message.role == ChatMessageRole::User)
            .ok_or_else(|| {
                AppError::validation("cannot regenerate without a user message in session")
            })?;
        let user_message = runtime_history[last_user_index].content.trim().to_string();
        if user_message.is_empty() {
            return Err(AppError::validation("last user message is empty"));
        }
        let prior_history = runtime_history
            .into_iter()
            .take(last_user_index)
            .collect::<Vec<_>>();

        let completion = self
            .complete_agent_reply(
                gateway,
                agent_id,
                &agent,
                &user_message,
                prior_history,
                input.temperature,
                input.max_tokens,
                input.top_p,
                input.frequency_penalty,
            )
            .await?;

        if input.replace_last_assistant {
            let _ = self
                .repo
                .delete_last_chat_session_assistant_message(agent_id, &session_id)
                .await?;
        }

        self.repo
            .append_chat_session_message(
                agent_id,
                &session_id,
                ChatMessageRole::Assistant,
                completion.text.clone(),
            )
            .await?;

        Ok(ChatWithAgentResponse {
            agent_id: agent.id,
            session_id,
            model_ref_id: completion.model_ref_id,
            model_id: completion.model_id,
            message: completion.text,
        })
    }

    pub async fn undo_last_chat_turn(
        &self,
        input: UndoLastChatTurnRequest,
    ) -> AppResult<UndoLastChatTurnResponse> {
        let agent_id = input.agent_id.trim();
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }

        let agent = self.repo.get_agent(agent_id).await?;
        let session_id = self
            .resolve_chat_session_id(agent_id, input.session_id.as_deref())
            .await?;
        let removed_count = self.repo.pop_last_chat_session_turn(agent_id, &session_id).await?;

        Ok(UndoLastChatTurnResponse {
            agent_id: agent.id,
            session_id,
            removed_count,
        })
    }

    pub async fn rewrite_last_user_message<G>(
        &self,
        gateway: &G,
        input: RewriteLastUserMessageRequest,
    ) -> AppResult<ChatWithAgentResponse>
    where
        G: ChatCompletionGateway,
    {
        self.rewrite_chat_user_message(
            gateway,
            RewriteChatUserMessageRequest {
                agent_id: input.agent_id,
                session_id: input.session_id,
                target_user_offset: 0,
                user_message: input.user_message,
                temperature: input.temperature,
                max_tokens: input.max_tokens,
                top_p: input.top_p,
                frequency_penalty: input.frequency_penalty,
            },
        )
        .await
    }

    pub async fn rewrite_chat_user_message<G>(
        &self,
        gateway: &G,
        input: RewriteChatUserMessageRequest,
    ) -> AppResult<ChatWithAgentResponse>
    where
        G: ChatCompletionGateway,
    {
        let agent_id = input.agent_id.trim();
        let user_message = input.user_message.trim();
        let target_user_offset = input.target_user_offset;
        if agent_id.is_empty() {
            return Err(AppError::validation("agentId is required"));
        }
        if user_message.is_empty() {
            return Err(AppError::validation("userMessage is required"));
        }
        if target_user_offset < 0 {
            return Err(AppError::validation("targetUserOffset must be >= 0"));
        }

        let agent = self.repo.get_agent(agent_id).await?;
        let session_id = self
            .resolve_chat_session_id(agent_id, input.session_id.as_deref())
            .await?;

        let runtime_history = clamp_chat_history(
            self.repo
                .list_chat_session_messages(agent_id, &session_id)
                .await?,
        );
        validate_chat_history(&runtime_history)?;

        let user_indices = runtime_history
            .iter()
            .enumerate()
            .filter(|(_, message)| message.role == ChatMessageRole::User)
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if user_indices.is_empty() {
            return Err(AppError::validation(
                "cannot rewrite without a user message in session",
            ));
        }
        let target_position = user_indices.len() as i32 - 1 - target_user_offset;
        if target_position < 0 {
            return Err(AppError::validation(
                "targetUserOffset exceeds available user messages",
            ));
        }
        let target_user_index = user_indices[target_position as usize];
        let preserved_history = runtime_history
            .iter()
            .take(target_user_index)
            .cloned()
            .collect::<Vec<_>>();

        let completion = self
            .complete_agent_reply(
                gateway,
                agent_id,
                &agent,
                user_message,
                preserved_history.clone(),
                input.temperature,
                input.max_tokens,
                input.top_p,
                input.frequency_penalty,
            )
            .await?;

        self.repo
            .clear_chat_session_messages(agent_id, &session_id)
            .await?;

        for message in preserved_history {
            self.repo
                .append_chat_session_message(
                    agent_id,
                    &session_id,
                    message.role,
                    message.content,
                )
                .await?;
        }
        self.repo
            .append_chat_session_message(
                agent_id,
                &session_id,
                ChatMessageRole::User,
                user_message.to_string(),
            )
            .await?;
        self.repo
            .append_chat_session_message(
                agent_id,
                &session_id,
                ChatMessageRole::Assistant,
                completion.text.clone(),
            )
            .await?;

        Ok(ChatWithAgentResponse {
            agent_id: agent.id,
            session_id,
            model_ref_id: completion.model_ref_id,
            model_id: completion.model_id,
            message: completion.text,
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn complete_agent_reply<G>(
        &self,
        gateway: &G,
        agent_id: &str,
        agent: &AgentConfig,
        user_message: &str,
        runtime_history: Vec<ChatMessage>,
        temperature: Option<f64>,
        max_tokens: Option<i32>,
        top_p: Option<f64>,
        frequency_penalty: Option<f64>,
    ) -> AppResult<ReplyCompletion>
    where
        G: ChatCompletionGateway,
    {
        let model_ref_id = agent.model_slots.reply.model_id.trim().to_string();
        if model_ref_id.is_empty() {
            return Err(AppError::validation("reply model is required"));
        }

        let model = self.repo.get_model(&model_ref_id).await?;
        if !model.enabled {
            return Err(AppError::validation("reply model is disabled"));
        }
        if !model
            .capabilities
            .output_modes
            .iter()
            .any(|mode| mode.eq_ignore_ascii_case("text"))
        {
            return Err(AppError::validation("reply model must support text output"));
        }

        let (api_base, api_key) = if let Some(custom_provider) = &model.custom_provider {
            (
                custom_provider.api_base.trim().to_string(),
                non_empty(custom_provider.api_key.trim()),
            )
        } else if let Some(provider_ref) = &model.provider_ref {
            let provider = self.repo.get_provider(provider_ref).await?;
            if !provider.enabled {
                return Err(AppError::validation("provider is disabled"));
            }
            let key_seed = format!("{agent_id}:{user_message}");
            (
                provider.api_base.trim().to_string(),
                pick_provider_key(&provider.keys, &key_seed),
            )
        } else {
            return Err(AppError::validation(
                "model must use providerRef or customProvider",
            ));
        };

        if api_base.is_empty() {
            return Err(AppError::validation("apiBase is required"));
        }

        validate_slot_params("reply", &agent.param_slots.reply)?;
        let slot_params_merged = merge_slot_params(&model.params, &agent.param_slots.reply)?;
        let params = merge_model_params(
            &slot_params_merged,
            temperature,
            max_tokens,
            top_p,
            frequency_penalty,
        )?;
        let messages = compose_chat_messages(agent, runtime_history, user_message);

        let completion = gateway
            .complete(CompletionRequest {
                api_base,
                api_key,
                model_id: model.model_id.clone(),
                messages,
                params,
            })
            .await?;

        Ok(ReplyCompletion {
            model_ref_id: model.id,
            model_id: model.model_id,
            text: completion.text,
        })
    }

    async fn normalize_workspace_chat_participants(
        &self,
        participants: &[WorkspaceChatParticipant],
    ) -> AppResult<Vec<WorkspaceChatParticipant>> {
        let mut normalized = Vec::<WorkspaceChatParticipant>::new();
        let mut seen = HashSet::<String>::new();

        for participant in participants {
            let agent_id = participant.agent_id.trim();
            if agent_id.is_empty() || !seen.insert(agent_id.to_string()) {
                continue;
            }
            self.repo.get_agent(agent_id).await?;
            normalized.push(WorkspaceChatParticipant {
                agent_id: agent_id.to_string(),
                receive_mode: participant.receive_mode.clone(),
                reply_mode: participant.reply_mode.clone(),
                sort_order: normalized.len() as i32,
            });
        }

        if normalized.is_empty() {
            return Err(AppError::validation("at least one participant is required"));
        }
        if normalized.len() > 16 {
            return Err(AppError::validation("participants cannot exceed 16 agents"));
        }

        Ok(normalized)
    }

    async fn load_workspace_participant_agents(
        &self,
        participants: &[WorkspaceChatParticipant],
    ) -> AppResult<Vec<AgentConfig>> {
        let mut output = Vec::with_capacity(participants.len());
        for participant in participants {
            output.push(self.repo.get_agent(&participant.agent_id).await?);
        }
        Ok(output)
    }

    #[allow(clippy::too_many_arguments)]
    async fn complete_workspace_agent_reply<G>(
        &self,
        gateway: &G,
        agent: &AgentConfig,
        participants: &[AgentConfig],
        user_message: &str,
        runtime_history: Vec<ChatMessage>,
        temperature: Option<f64>,
        max_tokens: Option<i32>,
        top_p: Option<f64>,
        frequency_penalty: Option<f64>,
    ) -> AppResult<ReplyCompletion>
    where
        G: ChatCompletionGateway,
    {
        let mut runtime_agent = agent.clone();
        let peer_names = participants
            .iter()
            .filter(|item| item.id != agent.id)
            .map(|item| item.name.trim())
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>();
        if !peer_names.is_empty() {
            let collaboration_note = format!(
                "你当前处于多智能体协作会话中，其他参与角色：{}。",
                peer_names.join("、")
            );
            runtime_agent.persona = if runtime_agent.persona.trim().is_empty() {
                collaboration_note
            } else {
                format!("{}\n{}", runtime_agent.persona.trim(), collaboration_note)
            };
            runtime_agent.speech_rules = if runtime_agent.speech_rules.trim().is_empty() {
                "保持自己的身份发言，不要代替其他智能体作答。".to_string()
            } else {
                format!(
                    "{}\n保持自己的身份发言，不要代替其他智能体作答。",
                    runtime_agent.speech_rules.trim()
                )
            };
        }

        self.complete_agent_reply(
            gateway,
            &agent.id,
            &runtime_agent,
            user_message,
            runtime_history,
            temperature,
            max_tokens,
            top_p,
            frequency_penalty,
        )
        .await
    }

    async fn validate_model_input(&self, input: &CreateModelRequest) -> AppResult<()> {
        validate_model_common(
            &input.name,
            &input.model_id,
            &input.provider_ref,
            input.custom_provider.as_ref(),
            &input.category,
            &input.categories,
            &input.capabilities.input_modes,
            &input.capabilities.output_modes,
            input.params.max_tokens,
        )?;

        if let Some(provider_id) = &input.provider_ref {
            if !self.repo.provider_exists(provider_id).await? {
                return Err(AppError::validation("providerRef does not exist"));
            }
        }
        Ok(())
    }

    async fn validate_model_update(&self, input: &UpdateModelRequest) -> AppResult<()> {
        validate_model_common(
            &input.name,
            &input.model_id,
            &input.provider_ref,
            input.custom_provider.as_ref(),
            &input.category,
            &input.categories,
            &input.capabilities.input_modes,
            &input.capabilities.output_modes,
            input.params.max_tokens,
        )?;

        if let Some(provider_id) = &input.provider_ref {
            if !self.repo.provider_exists(provider_id).await? {
                return Err(AppError::validation("providerRef does not exist"));
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn validate_agent_input(
        &self,
        name: &str,
        _persona: &str,
        _speech_rules: &str,
        reply_model_id: &str,
        mode: &AgentMode,
        component_asr_model_id: Option<&str>,
        component_tts_model_id: Option<&str>,
        component_vision_model_id: Option<&str>,
        tool_planner_model_id: Option<&str>,
        tool_executor_model_id: Option<&str>,
        decision_enabled: bool,
        decision_model_id: Option<&str>,
        param_slots: &AgentParamSlots,
    ) -> AppResult<()> {
        if name.trim().is_empty() {
            return Err(AppError::validation("agent name is required"));
        }
        let reply_model_id = reply_model_id.trim();
        if reply_model_id.is_empty() {
            return Err(AppError::validation("reply model is required"));
        }

        let reply_model = self.fetch_agent_model(reply_model_id).await?;
        validate_slot_output_mode(&reply_model, "reply", "text")?;

        if let Some(model_id) = normalize_model_id(component_asr_model_id) {
            let model = self.fetch_agent_model(model_id).await?;
            validate_slot_category(&model, "component.asr", &ModelCategory::Asr)?;
            validate_slot_output_mode(&model, "component.asr", "text")?;
        }

        if let Some(model_id) = normalize_model_id(component_tts_model_id) {
            let model = self.fetch_agent_model(model_id).await?;
            validate_slot_category(&model, "component.tts", &ModelCategory::Tts)?;
            validate_slot_output_mode(&model, "component.tts", "audio")?;
        }

        if let Some(model_id) = normalize_model_id(component_vision_model_id) {
            let model = self.fetch_agent_model(model_id).await?;
            validate_slot_category(&model, "component.vision", &ModelCategory::Vlm)?;
            validate_slot_input_mode(&model, "component.vision", "image")?;
        }

        if let Some(model_id) = normalize_model_id(tool_planner_model_id) {
            let model = self.fetch_agent_model(model_id).await?;
            validate_slot_output_mode(&model, "tool.planner", "text")?;
        }

        if let Some(model_id) = normalize_model_id(tool_executor_model_id) {
            let model = self.fetch_agent_model(model_id).await?;
            validate_slot_output_mode(&model, "tool.executor", "text")?;
        }

        if let Some(model_id) = normalize_model_id(decision_model_id) {
            let model = self.fetch_agent_model(model_id).await?;
            validate_slot_output_mode(&model, "decision", "text")?;
        }

        validate_slot_params("component.asr", &param_slots.component.asr)?;
        validate_slot_params("component.tts", &param_slots.component.tts)?;
        validate_slot_params("component.vision", &param_slots.component.vision)?;
        validate_slot_params("tool.planner", &param_slots.tool.planner)?;
        validate_slot_params("tool.executor", &param_slots.tool.executor)?;
        validate_slot_params("reply", &param_slots.reply)?;
        validate_slot_params("decision", &param_slots.decision)?;

        if decision_enabled && decision_model_id.unwrap_or("").trim().is_empty() {
            return Err(AppError::validation(
                "decision model must be set when decision is enabled",
            ));
        }

        if *mode == AgentMode::Ambient && !decision_enabled {
            return Err(AppError::validation(
                "ambient mode requires decision slot enabled",
            ));
        }

        Ok(())
    }

    async fn fetch_agent_model(&self, model_id: &str) -> AppResult<ModelConfig> {
        match self.repo.get_model(model_id).await {
            Ok(model) => Ok(model),
            Err(AppError::Domain { code, .. }) if code == "NOT_FOUND" => Err(AppError::validation(
                format!("referenced model does not exist: {model_id}"),
            )),
            Err(error) => Err(error),
        }
    }

    async fn resolve_chat_session_id(
        &self,
        agent_id: &str,
        session_id: Option<&str>,
    ) -> AppResult<String> {
        if let Some(value) = session_id {
            let normalized = value.trim();
            if normalized.is_empty() {
                return Err(AppError::validation("sessionId is required"));
            }
            let sessions = self.repo.list_agent_chat_sessions(agent_id).await?;
            if sessions.iter().any(|session| session.id == normalized) {
                return Ok(normalized.to_string());
            }
            return Err(AppError::validation("sessionId does not exist"));
        }

        let sessions = self.repo.list_agent_chat_sessions(agent_id).await?;
        if let Some(default_session) = sessions.into_iter().find(|session| session.is_default) {
            return Ok(default_session.id);
        }

        Err(AppError::internal("default chat session is missing"))
    }
}

fn sanitize_keys(keys: &[String]) -> Vec<String> {
    keys.iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn validate_chat_session_title(title: &str) -> AppResult<()> {
    if title.is_empty() {
        return Err(AppError::validation("session title is required"));
    }
    if title.chars().count() > 64 {
        return Err(AppError::validation("session title cannot exceed 64 characters"));
    }
    Ok(())
}

fn normalize_chat_session_tags(tags: &[String]) -> AppResult<Vec<String>> {
    const MAX_TAGS: usize = 12;
    const MAX_TAG_LEN: usize = 24;

    let mut normalized = Vec::<String>::new();
    for tag in tags {
        let value = tag.trim();
        if value.is_empty() {
            continue;
        }
        if value.chars().count() > MAX_TAG_LEN {
            return Err(AppError::validation(format!(
                "session tag cannot exceed {MAX_TAG_LEN} characters"
            )));
        }
        if normalized
            .iter()
            .any(|item| item.eq_ignore_ascii_case(value))
        {
            continue;
        }
        normalized.push(value.to_string());
        if normalized.len() > MAX_TAGS {
            return Err(AppError::validation(format!(
                "session tags cannot exceed {MAX_TAGS} items"
            )));
        }
    }

    Ok(normalized)
}

fn normalize_provider_fields(display_name: &mut String, provider_kind: &mut String, api_base: &mut String) {
    *display_name = display_name.trim().to_string();
    *provider_kind = provider_kind.trim().to_lowercase();
    *api_base = api_base.trim().trim_end_matches('/').to_string();
}

fn normalize_model_input(
    name: &mut String,
    model_id: &mut String,
    provider_ref: &mut Option<String>,
    custom_provider: &mut Option<CustomProvider>,
    category: &mut ModelCategory,
    categories: &mut Vec<ModelCategory>,
    input_modes: &mut Vec<String>,
    output_modes: &mut Vec<String>,
) {
    *name = name.trim().to_string();
    *model_id = model_id.trim().to_string();
    normalize_optional_string(provider_ref);

    if let Some(custom) = custom_provider.as_mut() {
        custom.api_base = custom.api_base.trim().trim_end_matches('/').to_string();
        custom.api_key = custom.api_key.trim().to_string();
    }

    normalize_model_categories(category, categories);
    normalize_mode_list(input_modes);
    normalize_mode_list(output_modes);
}

fn normalize_model_categories(category: &mut ModelCategory, categories: &mut Vec<ModelCategory>) {
    if categories.is_empty() {
        categories.push(category.clone());
    }

    let mut seen = HashSet::<ModelCategory>::new();
    let mut normalized = Vec::with_capacity(categories.len());
    for item in categories.iter().cloned() {
        if seen.insert(item.clone()) {
            normalized.push(item);
        }
    }

    if normalized.is_empty() {
        normalized.push(category.clone());
    }

    *category = normalized[0].clone();
    *categories = normalized;
}

fn normalize_agent_text_fields(name: &mut String, persona: &mut String, speech_rules: &mut String) {
    *name = name.trim().to_string();
    *persona = persona.trim().to_string();
    *speech_rules = speech_rules.trim().to_string();
}

fn normalize_optional_string(value: &mut Option<String>) {
    *value = value
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string);
}

fn normalize_mode_list(modes: &mut Vec<String>) {
    let mut seen = HashSet::<String>::new();
    let mut normalized = Vec::with_capacity(modes.len());
    for mode in modes
        .iter()
        .map(|item| item.trim().to_lowercase())
        .filter(|item| !item.is_empty())
    {
        if seen.insert(mode.clone()) {
            normalized.push(mode);
        }
    }
    *modes = normalized;
}

fn normalized_model_categories(
    primary_category: &ModelCategory,
    categories: &[ModelCategory],
) -> Vec<ModelCategory> {
    if categories.is_empty() {
        vec![primary_category.clone()]
    } else {
        categories.to_vec()
    }
}

fn validate_provider_input<T>(input: &T) -> AppResult<()>
where
    T: ProviderLike,
{
    if input.display_name().trim().is_empty() {
        return Err(AppError::validation("displayName is required"));
    }
    if input.provider_kind().trim().is_empty() {
        return Err(AppError::validation("providerKind is required"));
    }
    validate_url(input.api_base())?;
    Ok(())
}

fn validate_url(value: &str) -> AppResult<()> {
    Url::parse(value.trim())
        .map_err(|error| AppError::validation(format!("invalid apiBase: {error}")))?;
    Ok(())
}

fn validate_model_common(
    name: &str,
    model_id: &str,
    provider_ref: &Option<String>,
    custom_provider: Option<&crate::types::CustomProvider>,
    primary_category: &ModelCategory,
    categories: &[ModelCategory],
    input_modes: &[String],
    output_modes: &[String],
    max_tokens: i32,
) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::validation("model name is required"));
    }
    if model_id.trim().is_empty() {
        return Err(AppError::validation("modelId is required"));
    }
    if max_tokens <= 0 {
        return Err(AppError::validation("maxTokens must be greater than 0"));
    }

    match (provider_ref.as_ref(), custom_provider) {
        (Some(provider), None) if !provider.trim().is_empty() => {}
        (None, Some(custom)) => {
            validate_url(&custom.api_base)?;
        }
        _ => {
            return Err(AppError::validation(
                "model must use providerRef or customProvider (exactly one)",
            ))
        }
    }

    if input_modes.is_empty() || output_modes.is_empty() {
        return Err(AppError::validation(
            "capabilities.inputModes and outputModes cannot be empty",
        ));
    }

    let categories = normalized_model_categories(primary_category, categories);

    if categories.contains(&ModelCategory::Asr) && !has_mode(output_modes, "text") {
        return Err(AppError::validation(
            "ASR model should include text in outputModes",
        ));
    }

    if categories.contains(&ModelCategory::Tts) && !has_mode(output_modes, "audio") {
        return Err(AppError::validation(
            "TTS model should include audio in outputModes",
        ));
    }

    Ok(())
}

fn non_empty(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn probe_latency_ms(value: u128) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn pick_provider_key(keys: &[String], seed: &str) -> Option<String> {
    let clean_keys: Vec<&str> = keys
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .collect();

    if clean_keys.is_empty() {
        return None;
    }

    let mut hasher = DefaultHasher::new();
    seed.hash(&mut hasher);
    let index = (hasher.finish() as usize) % clean_keys.len();
    Some(clean_keys[index].to_string())
}

fn merge_model_params(
    base: &ModelParams,
    temperature: Option<f64>,
    max_tokens: Option<i32>,
    top_p: Option<f64>,
    frequency_penalty: Option<f64>,
) -> AppResult<ModelParams> {
    let mut params = base.clone();

    if let Some(value) = temperature {
        if !(0.0..=2.0).contains(&value) {
            return Err(AppError::validation(
                "temperature must be between 0.0 and 2.0",
            ));
        }
        params.temperature = value;
    }

    if let Some(value) = max_tokens {
        if value <= 0 {
            return Err(AppError::validation("maxTokens must be greater than 0"));
        }
        params.max_tokens = value;
    }

    if let Some(value) = top_p {
        if !(0.0..=1.0).contains(&value) {
            return Err(AppError::validation("topP must be between 0.0 and 1.0"));
        }
        params.top_p = value;
    }

    if let Some(value) = frequency_penalty {
        if !(-2.0..=2.0).contains(&value) {
            return Err(AppError::validation(
                "frequencyPenalty must be between -2.0 and 2.0",
            ));
        }
        params.frequency_penalty = value;
    }

    Ok(params)
}

fn merge_slot_params(base: &ModelParams, slot: &SlotParams) -> AppResult<ModelParams> {
    merge_model_params(
        base,
        slot.temperature,
        slot.max_tokens,
        slot.top_p,
        slot.frequency_penalty,
    )
}

fn compose_chat_messages(
    agent: &AgentConfig,
    history: Vec<ChatMessage>,
    user_message: &str,
) -> Vec<ChatMessage> {
    let mut messages = Vec::with_capacity(history.len() + 2);
    messages.push(ChatMessage {
        role: ChatMessageRole::System,
        content: compose_system_prompt(agent),
    });

    for message in history {
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }
        messages.push(ChatMessage {
            role: message.role,
            content: content.to_string(),
        });
    }

    messages.push(ChatMessage {
        role: ChatMessageRole::User,
        content: user_message.to_string(),
    });

    messages
}

fn build_workspace_runtime_history(
    messages: &[WorkspaceChatMessage],
    agent: &AgentConfig,
    participants: &[AgentConfig],
) -> Vec<ChatMessage> {
    let participant_name_map = participants
        .iter()
        .map(|item| (item.id.clone(), item.name.clone()))
        .collect::<HashMap<_, _>>();

    messages
        .iter()
        .filter(|message| workspace_message_visible_to_agent(message, &agent.id))
        .filter_map(|message| {
            let role = workspace_role_as_chat_role(&message.role);
            if role == ChatMessageRole::System {
                return None;
            }

            let mut content = message.content.trim().to_string();
            if content.is_empty() {
                return None;
            }
            if role == ChatMessageRole::Assistant {
                if let Some(agent_id) = message.agent_id.as_deref() {
                    let agent_name = participant_name_map
                        .get(agent_id)
                        .cloned()
                        .unwrap_or_else(|| agent_id.to_string());
                    content = format!("{agent_name}：{content}");
                }
            }

            Some(ChatMessage { role, content })
        })
        .collect()
}

fn compose_system_prompt(agent: &AgentConfig) -> String {
    let persona = agent.persona.trim();
    let speech_rules = agent.speech_rules.trim();
    let mut prompt = String::from(
        "Distinguish user chat content from any tool/context information.\n\
         Follow configured instructions only when they are explicitly provided.\n\
         Do not fabricate a fixed identity, background, or role unless it is configured.\n\
         Reply with natural conversational text only.",
    );
    if !persona.is_empty() {
        prompt.push_str("\n\nPersona:\n");
        prompt.push_str(persona);
    }
    if !speech_rules.is_empty() {
        prompt.push_str("\n\nSpeech rules:\n");
        prompt.push_str(speech_rules);
    }
    prompt
}

fn normalize_model_id(value: Option<&str>) -> Option<&str> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn participant_receives_message(
    participant: &WorkspaceChatParticipant,
    agent: &AgentConfig,
    message: &str,
) -> bool {
    match participant.receive_mode {
        WorkspaceChatParticipantMode::All => true,
        WorkspaceChatParticipantMode::Mention => message_mentions_agent(message, agent),
    }
}

fn participant_replies_to_message(
    participant: &WorkspaceChatParticipant,
    agent: &AgentConfig,
    message: &str,
) -> bool {
    match participant.reply_mode {
        WorkspaceChatParticipantMode::All => true,
        WorkspaceChatParticipantMode::Mention => message_mentions_agent(message, agent),
    }
}

fn message_mentions_agent(message: &str, agent: &AgentConfig) -> bool {
    let lower = message.to_lowercase();
    [agent.id.trim(), agent.name.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
        .any(|alias| lower.contains(&format!("@{alias}")))
}

fn workspace_message_visible_to_agent(message: &WorkspaceChatMessage, agent_id: &str) -> bool {
    if message.visible_to_agent_ids.is_empty() {
        return true;
    }
    message
        .visible_to_agent_ids
        .iter()
        .any(|item| item.eq_ignore_ascii_case(agent_id))
}

fn workspace_role_as_chat_role(role: &WorkspaceChatMessageRole) -> ChatMessageRole {
    match role {
        WorkspaceChatMessageRole::System => ChatMessageRole::System,
        WorkspaceChatMessageRole::User => ChatMessageRole::User,
        WorkspaceChatMessageRole::Assistant => ChatMessageRole::Assistant,
        WorkspaceChatMessageRole::Tool => ChatMessageRole::Tool,
    }
}

#[allow(clippy::too_many_arguments)]
fn normalize_agent_model_refs(
    reply_model_id: &mut String,
    component_asr_model_id: &mut Option<String>,
    component_tts_model_id: &mut Option<String>,
    component_vision_model_id: &mut Option<String>,
    tool_planner_model_id: &mut Option<String>,
    tool_executor_model_id: &mut Option<String>,
    decision_enabled: bool,
    decision_model_id: &mut Option<String>,
) {
    *reply_model_id = reply_model_id.trim().to_string();
    normalize_optional_model_id(component_asr_model_id);
    normalize_optional_model_id(component_tts_model_id);
    normalize_optional_model_id(component_vision_model_id);
    normalize_optional_model_id(tool_planner_model_id);
    normalize_optional_model_id(tool_executor_model_id);
    normalize_optional_model_id(decision_model_id);
    if !decision_enabled {
        *decision_model_id = None;
    }
}

fn normalize_optional_model_id(value: &mut Option<String>) {
    *value = value
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string);
}

fn clamp_chat_history(history: Vec<ChatMessage>) -> Vec<ChatMessage> {
    if history.len() <= MAX_HISTORY_MESSAGES {
        return history;
    }
    let len = history.len();
    history.into_iter().skip(len - MAX_HISTORY_MESSAGES).collect()
}

fn validate_chat_history(history: &[ChatMessage]) -> AppResult<()> {
    if history.len() > MAX_HISTORY_MESSAGES {
        return Err(AppError::validation(format!(
            "history cannot exceed {MAX_HISTORY_MESSAGES} messages"
        )));
    }

    for (index, message) in history.iter().enumerate() {
        if message.content.trim().is_empty() {
            return Err(AppError::validation(format!(
                "history[{index}] content is required"
            )));
        }
        if message.role == ChatMessageRole::System {
            return Err(AppError::validation(
                "history role cannot contain system messages",
            ));
        }
    }

    Ok(())
}

fn has_mode(modes: &[String], target: &str) -> bool {
    modes
        .iter()
        .any(|mode| mode.trim().eq_ignore_ascii_case(target))
}

fn validate_slot_input_mode(
    model: &ModelConfig,
    slot_name: &str,
    input_mode: &str,
) -> AppResult<()> {
    if has_mode(&model.capabilities.input_modes, input_mode) {
        return Ok(());
    }

    Err(AppError::validation(format!(
        "{slot_name} model must support {input_mode} input"
    )))
}

fn validate_slot_output_mode(
    model: &ModelConfig,
    slot_name: &str,
    output_mode: &str,
) -> AppResult<()> {
    if has_mode(&model.capabilities.output_modes, output_mode) {
        return Ok(());
    }

    Err(AppError::validation(format!(
        "{slot_name} model must support {output_mode} output"
    )))
}

fn validate_slot_category(
    model: &ModelConfig,
    slot_name: &str,
    expected_category: &ModelCategory,
) -> AppResult<()> {
    if model_has_category(model, expected_category) {
        return Ok(());
    }

    Err(AppError::validation(format!(
        "{slot_name} model must be category {}, got {}",
        category_as_str(expected_category),
        format_model_categories(model)
    )))
}

fn model_has_category(model: &ModelConfig, expected_category: &ModelCategory) -> bool {
    if model.categories.is_empty() {
        &model.category == expected_category
    } else {
        model.categories.iter().any(|item| item == expected_category)
    }
}

fn format_model_categories(model: &ModelConfig) -> String {
    normalized_model_categories(&model.category, &model.categories)
        .iter()
        .map(category_as_str)
        .collect::<Vec<_>>()
        .join(", ")
}

fn validate_slot_params(slot_name: &str, params: &SlotParams) -> AppResult<()> {
    if let Some(value) = params.temperature {
        if !(0.0..=2.0).contains(&value) {
            return Err(AppError::validation(format!(
                "{slot_name} temperature must be between 0.0 and 2.0"
            )));
        }
    }

    if let Some(value) = params.max_tokens {
        if value <= 0 {
            return Err(AppError::validation(format!(
                "{slot_name} maxTokens must be greater than 0"
            )));
        }
    }

    if let Some(value) = params.top_p {
        if !(0.0..=1.0).contains(&value) {
            return Err(AppError::validation(format!(
                "{slot_name} topP must be between 0.0 and 1.0"
            )));
        }
    }

    if let Some(value) = params.frequency_penalty {
        if !(-2.0..=2.0).contains(&value) {
            return Err(AppError::validation(format!(
                "{slot_name} frequencyPenalty must be between -2.0 and 2.0"
            )));
        }
    }

    Ok(())
}

fn category_as_str(category: &ModelCategory) -> &'static str {
    match category {
        ModelCategory::Llm => "llm",
        ModelCategory::Vlm => "vlm",
        ModelCategory::Asr => "asr",
        ModelCategory::Tts => "tts",
    }
}

trait ProviderLike {
    fn display_name(&self) -> &str;
    fn provider_kind(&self) -> &str;
    fn api_base(&self) -> &str;
}

impl ProviderLike for CreateProviderRequest {
    fn display_name(&self) -> &str {
        &self.display_name
    }
    fn provider_kind(&self) -> &str {
        &self.provider_kind
    }
    fn api_base(&self) -> &str {
        &self.api_base
    }
}

impl ProviderLike for UpdateProviderRequest {
    fn display_name(&self) -> &str {
        &self.display_name
    }
    fn provider_kind(&self) -> &str {
        &self.provider_kind
    }
    fn api_base(&self) -> &str {
        &self.api_base
    }
}
