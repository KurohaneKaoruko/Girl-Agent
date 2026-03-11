use std::{collections::HashSet, str::FromStr, sync::Arc};

use async_trait::async_trait;
use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    FromRow, SqlitePool,
};
use uuid::Uuid;

use crate::{
    dto::{
        ChatMessage, ChatMessageRole, CreateAgentRequest, CreateModelRequest, CreateProviderRequest,
        UpdateAgentRequest, UpdateModelRequest, UpdateProviderRequest,
    },
    error::{AppError, AppResult},
    repository::{
        AgentRepository, ChatRepository, ModelRepository, ProviderRepository,
        WorkspaceChatRepository,
    },
    types::{
        AgentConfig, AgentMode, AgentModelSlots, AgentParamSlots, ChatSession, ComponentParamSlot,
        ComponentSlot, DecisionSlot, ModelCapabilities, ModelCategory, ModelConfig, ModelParams,
        ProviderConfig, ReplySlot, SlotParams, ToolParamSlot, ToolSlot, WorkspaceChatMessage,
        WorkspaceChatMessageRole, WorkspaceChatParticipant, WorkspaceChatParticipantMode,
        WorkspaceChatSession,
    },
};

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct SqliteStore {
    pool: Arc<SqlitePool>,
}

impl SqliteStore {
    pub async fn connect(database_url: &str) -> AppResult<Self> {
        let options = SqliteConnectOptions::from_str(database_url)
            .map_err(|error| AppError::validation(format!("invalid database url: {error}")))?
            .create_if_missing(true)
            .foreign_keys(true);

        let max_connections = if database_url.contains(":memory:") {
            1
        } else {
            5
        };
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;

        MIGRATOR.run(&pool).await?;

        Ok(Self {
            pool: Arc::new(pool),
        })
    }

    fn map_write_error(error: sqlx::Error, duplicate_hint: &str) -> AppError {
        if let sqlx::Error::Database(database_error) = &error {
            if database_error
                .message()
                .contains("UNIQUE constraint failed")
            {
                return AppError::conflict(duplicate_hint.to_string());
            }
        }
        AppError::from(error)
    }

    fn default_session_id(agent_id: &str) -> String {
        format!("{agent_id}:default")
    }

    async fn fetch_provider(&self, id: &str) -> AppResult<ProviderConfig> {
        let provider = sqlx::query_as::<_, ProviderRow>(
            r#"
            SELECT id, display_name, provider_kind, api_base, enabled
            FROM providers
            WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        let provider = provider.ok_or_else(|| AppError::not_found("provider not found"))?;
        self.provider_row_to_config(provider).await
    }

    async fn provider_row_to_config(&self, row: ProviderRow) -> AppResult<ProviderConfig> {
        let keys = sqlx::query_scalar::<_, String>(
            r#"
            SELECT api_key
            FROM provider_keys
            WHERE provider_id = ?
            ORDER BY sort_order ASC
            "#,
        )
        .bind(&row.id)
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(ProviderConfig {
            id: row.id,
            display_name: row.display_name,
            provider_kind: row.provider_kind,
            api_base: row.api_base,
            keys,
            enabled: row.enabled != 0,
        })
    }

    async fn fetch_model(&self, id: &str) -> AppResult<ModelConfig> {
        let row = sqlx::query_as::<_, ModelRow>(
            r#"
            SELECT
              id, name, provider_ref, custom_provider_json, model_id, category,
              capabilities_json, params_json, enabled
            FROM models
            WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        let row = row.ok_or_else(|| AppError::not_found("model not found"))?;
        self.model_row_to_config(row)
    }

    fn model_row_to_config(&self, row: ModelRow) -> AppResult<ModelConfig> {
        let custom_provider = match row.custom_provider_json {
            Some(value) => Some(serde_json::from_str(&value).map_err(|error| {
                AppError::internal(format!("invalid custom provider json: {error}"))
            })?),
            None => None,
        };

        let capabilities: ModelCapabilities = serde_json::from_str(&row.capabilities_json)
            .map_err(|error| AppError::internal(format!("invalid capabilities json: {error}")))?;

        let params: ModelParams = serde_json::from_str(&row.params_json)
            .map_err(|error| AppError::internal(format!("invalid params json: {error}")))?;

        let categories = parse_categories(&row.category)?;
        let category = categories
            .first()
            .cloned()
            .ok_or_else(|| AppError::internal("model categories cannot be empty"))?;

        Ok(ModelConfig {
            id: row.id,
            name: row.name,
            provider_ref: row.provider_ref,
            custom_provider,
            model_id: row.model_id,
            category,
            categories,
            capabilities,
            params,
            enabled: row.enabled != 0,
        })
    }

    async fn fetch_agent(&self, id: &str) -> AppResult<AgentConfig> {
        let row = sqlx::query_as::<_, AgentRow>(
            r#"
            SELECT
              id, name, persona, speech_rules, mode,
              component_asr_model_id, component_tts_model_id, component_vision_model_id,
              tool_planner_model_id, tool_executor_model_id,
              reply_model_id, decision_enabled, decision_model_id,
              component_asr_params_json, component_tts_params_json, component_vision_params_json,
              tool_planner_params_json, tool_executor_params_json, reply_params_json, decision_params_json
            FROM agents
            WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        let row = row.ok_or_else(|| AppError::not_found("agent not found"))?;
        self.agent_row_to_config(row)
    }

    fn agent_row_to_config(&self, row: AgentRow) -> AppResult<AgentConfig> {
        let component_asr_params = parse_slot_params(row.component_asr_params_json.as_deref())?;
        let component_tts_params = parse_slot_params(row.component_tts_params_json.as_deref())?;
        let component_vision_params =
            parse_slot_params(row.component_vision_params_json.as_deref())?;
        let tool_planner_params = parse_slot_params(row.tool_planner_params_json.as_deref())?;
        let tool_executor_params = parse_slot_params(row.tool_executor_params_json.as_deref())?;
        let reply_params = parse_slot_params(row.reply_params_json.as_deref())?;
        let decision_params = parse_slot_params(row.decision_params_json.as_deref())?;

        Ok(AgentConfig {
            id: row.id,
            name: row.name,
            persona: row.persona,
            speech_rules: row.speech_rules,
            mode: parse_mode(&row.mode)?,
            model_slots: AgentModelSlots {
                component: ComponentSlot {
                    asr_model_id: row.component_asr_model_id,
                    tts_model_id: row.component_tts_model_id,
                    vision_model_id: row.component_vision_model_id,
                },
                tool: ToolSlot {
                    planner_model_id: row.tool_planner_model_id,
                    executor_model_id: row.tool_executor_model_id,
                },
                reply: ReplySlot {
                    model_id: row.reply_model_id,
                },
                decision: DecisionSlot {
                    model_id: row.decision_model_id,
                    enabled: row.decision_enabled != 0,
                },
            },
            param_slots: AgentParamSlots {
                component: ComponentParamSlot {
                    asr: component_asr_params,
                    tts: component_tts_params,
                    vision: component_vision_params,
                },
                tool: ToolParamSlot {
                    planner: tool_planner_params,
                    executor: tool_executor_params,
                },
                reply: reply_params,
                decision: decision_params,
            },
        })
    }

    async fn ensure_default_chat_session(&self, agent_id: &str) -> AppResult<ChatSession> {
        let default_id = Self::default_session_id(agent_id);
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO agent_chat_sessions (id, agent_id, title, is_default)
            VALUES (?, ?, '默认会话', 1)
            "#,
        )
        .bind(&default_id)
        .bind(agent_id)
        .execute(self.pool.as_ref())
        .await?;

        self.fetch_chat_session(agent_id, &default_id).await
    }

    async fn fetch_chat_session(&self, agent_id: &str, session_id: &str) -> AppResult<ChatSession> {
        let row = sqlx::query_as::<_, ChatSessionRow>(
            r#"
            SELECT
              id, agent_id, title, is_default, is_pinned, is_archived, tags_json, created_at, updated_at
            FROM agent_chat_sessions
            WHERE id = ? AND agent_id = ?
            "#,
        )
        .bind(session_id)
        .bind(agent_id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        let row = row.ok_or_else(|| AppError::not_found("chat session not found"))?;
        let is_default = row.is_default != 0;
        let summary = self
            .fetch_chat_session_summary(agent_id, session_id, is_default)
            .await?;
        Ok(ChatSession {
            id: row.id,
            agent_id: row.agent_id,
            title: row.title,
            is_default,
            is_pinned: row.is_pinned != 0,
            is_archived: row.is_archived != 0,
            tags: parse_tags_json(row.tags_json.as_deref())?,
            created_at: row.created_at,
            updated_at: row.updated_at,
            message_count: summary.message_count,
            last_message_role: summary.last_message_role,
            last_message_preview: summary.last_message_preview,
        })
    }

    async fn fetch_chat_session_summary(
        &self,
        agent_id: &str,
        session_id: &str,
        is_default: bool,
    ) -> AppResult<ChatSessionSummary> {
        let message_count = if is_default {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(1) FROM agent_chat_messages WHERE agent_id = ? AND (session_id = ? OR session_id IS NULL)",
            )
            .bind(agent_id)
            .bind(session_id)
            .fetch_one(self.pool.as_ref())
            .await?
        } else {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(1) FROM agent_chat_messages WHERE agent_id = ? AND session_id = ?",
            )
            .bind(agent_id)
            .bind(session_id)
            .fetch_one(self.pool.as_ref())
            .await?
        };

        let last_message = if is_default {
            sqlx::query_as::<_, ChatSessionLastMessageRow>(
                r#"
                SELECT role, content
                FROM agent_chat_messages
                WHERE agent_id = ? AND (session_id = ? OR session_id IS NULL)
                ORDER BY rowid DESC
                LIMIT 1
                "#,
            )
            .bind(agent_id)
            .bind(session_id)
            .fetch_optional(self.pool.as_ref())
            .await?
        } else {
            sqlx::query_as::<_, ChatSessionLastMessageRow>(
                r#"
                SELECT role, content
                FROM agent_chat_messages
                WHERE agent_id = ? AND session_id = ?
                ORDER BY rowid DESC
                LIMIT 1
                "#,
            )
            .bind(agent_id)
            .bind(session_id)
            .fetch_optional(self.pool.as_ref())
            .await?
        };

        Ok(ChatSessionSummary {
            message_count,
            last_message_role: last_message.as_ref().map(|item| item.role.clone()),
            last_message_preview: last_message
                .as_ref()
                .map(|item| build_message_preview(&item.content))
                .filter(|item| !item.is_empty()),
        })
    }

    async fn touch_chat_session(&self, agent_id: &str, session_id: &str) -> AppResult<()> {
        sqlx::query(
            r#"
            UPDATE agent_chat_sessions
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND agent_id = ?
            "#,
        )
        .bind(session_id)
        .bind(agent_id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    async fn fetch_workspace_chat_participants(
        &self,
        session_id: &str,
    ) -> AppResult<Vec<WorkspaceChatParticipant>> {
        let rows = sqlx::query_as::<_, WorkspaceChatParticipantRow>(
            r#"
            SELECT agent_id, receive_mode, reply_mode, sort_order
            FROM workspace_chat_session_participants
            WHERE session_id = ?
            ORDER BY sort_order ASC, agent_id ASC
            "#,
        )
        .bind(session_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(WorkspaceChatParticipant {
                    agent_id: row.agent_id,
                    receive_mode: parse_workspace_participant_mode(&row.receive_mode)?,
                    reply_mode: parse_workspace_participant_mode(&row.reply_mode)?,
                    sort_order: row.sort_order as i32,
                })
            })
            .collect()
    }

    async fn fetch_workspace_chat_session_summary(
        &self,
        session_id: &str,
    ) -> AppResult<ChatSessionSummary> {
        let message_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(1) FROM workspace_chat_messages WHERE session_id = ?",
        )
        .bind(session_id)
        .fetch_one(self.pool.as_ref())
        .await?;

        let last_message = sqlx::query_as::<_, WorkspaceChatMessagePreviewRow>(
            r#"
            SELECT role, content
            FROM workspace_chat_messages
            WHERE session_id = ?
            ORDER BY rowid DESC
            LIMIT 1
            "#,
        )
        .bind(session_id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        Ok(ChatSessionSummary {
            message_count,
            last_message_role: last_message.as_ref().map(|item| item.role.clone()),
            last_message_preview: last_message
                .as_ref()
                .map(|item| build_message_preview(&item.content))
                .filter(|item| !item.is_empty()),
        })
    }

    async fn fetch_workspace_chat_session(
        &self,
        session_id: &str,
    ) -> AppResult<WorkspaceChatSession> {
        let row = sqlx::query_as::<_, WorkspaceChatSessionRow>(
            r#"
            SELECT id, title, is_pinned, is_archived, tags_json, created_at, updated_at
            FROM workspace_chat_sessions
            WHERE id = ?
            "#,
        )
        .bind(session_id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        let row = row.ok_or_else(|| AppError::not_found("workspace chat session not found"))?;
        let participants = self.fetch_workspace_chat_participants(session_id).await?;
        let summary = self.fetch_workspace_chat_session_summary(session_id).await?;
        Ok(WorkspaceChatSession {
            id: row.id,
            title: row.title,
            participants: participants.clone(),
            is_group: participants.len() > 1,
            is_pinned: row.is_pinned != 0,
            is_archived: row.is_archived != 0,
            tags: parse_tags_json(row.tags_json.as_deref())?,
            created_at: row.created_at,
            updated_at: row.updated_at,
            message_count: summary.message_count,
            last_message_role: summary.last_message_role,
            last_message_preview: summary.last_message_preview,
        })
    }

    async fn touch_workspace_chat_session(&self, session_id: &str) -> AppResult<()> {
        sqlx::query(
            r#"
            UPDATE workspace_chat_sessions
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(session_id)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }
}

#[derive(Debug, FromRow)]
struct ProviderRow {
    id: String,
    display_name: String,
    provider_kind: String,
    api_base: String,
    enabled: i64,
}

#[derive(Debug, FromRow)]
struct ModelRow {
    id: String,
    name: String,
    provider_ref: Option<String>,
    custom_provider_json: Option<String>,
    model_id: String,
    category: String,
    capabilities_json: String,
    params_json: String,
    enabled: i64,
}

#[derive(Debug, FromRow)]
struct AgentRow {
    id: String,
    name: String,
    persona: String,
    speech_rules: String,
    mode: String,
    component_asr_model_id: Option<String>,
    component_tts_model_id: Option<String>,
    component_vision_model_id: Option<String>,
    tool_planner_model_id: Option<String>,
    tool_executor_model_id: Option<String>,
    reply_model_id: String,
    decision_enabled: i64,
    decision_model_id: Option<String>,
    component_asr_params_json: Option<String>,
    component_tts_params_json: Option<String>,
    component_vision_params_json: Option<String>,
    tool_planner_params_json: Option<String>,
    tool_executor_params_json: Option<String>,
    reply_params_json: Option<String>,
    decision_params_json: Option<String>,
}

fn category_as_str(value: &ModelCategory) -> &'static str {
    match value {
        ModelCategory::Llm => "llm",
        ModelCategory::Vlm => "vlm",
        ModelCategory::Asr => "asr",
        ModelCategory::Tts => "tts",
    }
}

fn parse_category(value: &str) -> AppResult<ModelCategory> {
    match value {
        "llm" => Ok(ModelCategory::Llm),
        "vlm" => Ok(ModelCategory::Vlm),
        "asr" => Ok(ModelCategory::Asr),
        "tts" => Ok(ModelCategory::Tts),
        _ => Err(AppError::internal(format!(
            "invalid model category: {value}"
        ))),
    }
}

fn parse_categories(value: &str) -> AppResult<Vec<ModelCategory>> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::internal("model category cannot be empty"));
    }

    let raw_values = if trimmed.starts_with('[') {
        serde_json::from_str::<Vec<String>>(trimmed)
            .map_err(|error| AppError::internal(format!("invalid model categories json: {error}")))?
    } else {
        vec![trimmed.to_string()]
    };

    let mut seen = HashSet::<ModelCategory>::new();
    let mut categories = Vec::with_capacity(raw_values.len());
    for raw in raw_values {
        let category = parse_category(raw.trim())?;
        if seen.insert(category.clone()) {
            categories.push(category);
        }
    }

    if categories.is_empty() {
        return Err(AppError::internal("model categories cannot be empty"));
    }

    Ok(categories)
}

fn serialize_categories(primary: &ModelCategory, categories: &[ModelCategory]) -> AppResult<String> {
    let mut seen = HashSet::<ModelCategory>::new();
    let mut normalized = Vec::with_capacity(categories.len().max(1));

    if categories.is_empty() {
        normalized.push(primary.clone());
    } else {
        for category in categories.iter().cloned() {
            if seen.insert(category.clone()) {
                normalized.push(category);
            }
        }
    }

    if normalized.len() == 1 {
        return Ok(category_as_str(&normalized[0]).to_string());
    }

    let values = normalized.iter().map(category_as_str).collect::<Vec<_>>();
    serde_json::to_string(&values).map_err(|error| AppError::internal(error.to_string()))
}

fn mode_as_str(mode: &AgentMode) -> &'static str {
    match mode {
        AgentMode::Chat => "chat",
        AgentMode::Ambient => "ambient",
    }
}

fn parse_mode(value: &str) -> AppResult<AgentMode> {
    match value {
        "chat" => Ok(AgentMode::Chat),
        "ambient" => Ok(AgentMode::Ambient),
        _ => Err(AppError::internal(format!("invalid agent mode: {value}"))),
    }
}

fn chat_role_as_str(role: &ChatMessageRole) -> &'static str {
    match role {
        ChatMessageRole::System => "system",
        ChatMessageRole::User => "user",
        ChatMessageRole::Assistant => "assistant",
        ChatMessageRole::Tool => "tool",
    }
}

fn parse_chat_role(value: &str) -> AppResult<ChatMessageRole> {
    match value {
        "system" => Ok(ChatMessageRole::System),
        "user" => Ok(ChatMessageRole::User),
        "assistant" => Ok(ChatMessageRole::Assistant),
        "tool" => Ok(ChatMessageRole::Tool),
        _ => Err(AppError::internal(format!("invalid chat message role: {value}"))),
    }
}

fn workspace_chat_role_as_str(role: &WorkspaceChatMessageRole) -> &'static str {
    match role {
        WorkspaceChatMessageRole::System => "system",
        WorkspaceChatMessageRole::User => "user",
        WorkspaceChatMessageRole::Assistant => "assistant",
        WorkspaceChatMessageRole::Tool => "tool",
    }
}

fn parse_workspace_chat_role(value: &str) -> AppResult<WorkspaceChatMessageRole> {
    match value {
        "system" => Ok(WorkspaceChatMessageRole::System),
        "user" => Ok(WorkspaceChatMessageRole::User),
        "assistant" => Ok(WorkspaceChatMessageRole::Assistant),
        "tool" => Ok(WorkspaceChatMessageRole::Tool),
        _ => Err(AppError::internal(format!(
            "invalid workspace chat message role: {value}"
        ))),
    }
}

fn workspace_participant_mode_as_str(value: &WorkspaceChatParticipantMode) -> &'static str {
    match value {
        WorkspaceChatParticipantMode::All => "all",
        WorkspaceChatParticipantMode::Mention => "mention",
    }
}

fn parse_workspace_participant_mode(value: &str) -> AppResult<WorkspaceChatParticipantMode> {
    match value {
        "all" => Ok(WorkspaceChatParticipantMode::All),
        "mention" => Ok(WorkspaceChatParticipantMode::Mention),
        _ => Err(AppError::internal(format!(
            "invalid workspace participant mode: {value}"
        ))),
    }
}

fn slot_params_json(value: &SlotParams) -> AppResult<String> {
    serde_json::to_string(value).map_err(|error| AppError::internal(error.to_string()))
}

fn parse_slot_params(value: Option<&str>) -> AppResult<SlotParams> {
    let Some(raw) = value else {
        return Ok(SlotParams::default());
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(SlotParams::default());
    }

    serde_json::from_str(raw)
        .map_err(|error| AppError::internal(format!("invalid slot params json: {error}")))
}

fn sanitize_keys(keys: &[String]) -> Vec<String> {
    keys.iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn tags_to_json(tags: &[String]) -> AppResult<Option<String>> {
    if tags.is_empty() {
        return Ok(None);
    }
    serde_json::to_string(tags)
        .map(Some)
        .map_err(|error| AppError::internal(format!("invalid session tags json: {error}")))
}

fn parse_tags_json(value: Option<&str>) -> AppResult<Vec<String>> {
    let Some(raw) = value else {
        return Ok(Vec::new());
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(raw)
        .map_err(|error| AppError::internal(format!("invalid session tags json: {error}")))
}

fn visible_agents_to_json(agent_ids: &[String]) -> AppResult<Option<String>> {
    if agent_ids.is_empty() {
        return Ok(None);
    }
    serde_json::to_string(agent_ids)
        .map(Some)
        .map_err(|error| AppError::internal(format!("invalid visible agents json: {error}")))
}

fn parse_visible_agents_json(value: Option<&str>) -> AppResult<Vec<String>> {
    let Some(raw) = value else {
        return Ok(Vec::new());
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(raw)
        .map_err(|error| AppError::internal(format!("invalid visible agents json: {error}")))
}

fn build_message_preview(content: &str) -> String {
    const MAX_CHARS: usize = 80;
    let compact = content.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut output = String::new();
    for (index, ch) in compact.chars().enumerate() {
        if index >= MAX_CHARS {
            output.push_str("...");
            break;
        }
        output.push(ch);
    }
    output
}

#[async_trait]
impl ProviderRepository for SqliteStore {
    async fn list_providers(&self) -> AppResult<Vec<ProviderConfig>> {
        let rows = sqlx::query_as::<_, ProviderRow>(
            r#"
            SELECT id, display_name, provider_kind, api_base, enabled
            FROM providers
            ORDER BY created_at ASC, display_name ASC
            "#,
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut output = Vec::with_capacity(rows.len());
        for row in rows {
            output.push(self.provider_row_to_config(row).await?);
        }
        Ok(output)
    }

    async fn get_provider(&self, id: &str) -> AppResult<ProviderConfig> {
        self.fetch_provider(id).await
    }

    async fn create_provider(&self, input: CreateProviderRequest) -> AppResult<ProviderConfig> {
        let id = Uuid::new_v4().to_string();
        let keys = sanitize_keys(&input.keys);
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO providers (id, display_name, provider_kind, api_base, enabled)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(input.display_name)
        .bind(input.provider_kind)
        .bind(input.api_base)
        .bind(if input.enabled { 1 } else { 0 })
        .execute(&mut *tx)
        .await
        .map_err(|error| Self::map_write_error(error, "provider display name already exists"))?;

        for (index, key) in keys.into_iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO provider_keys (id, provider_id, api_key, sort_order)
                VALUES (?, ?, ?, ?)
                "#,
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&id)
            .bind(key)
            .bind(index as i64)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        self.fetch_provider(&id).await
    }

    async fn update_provider(
        &self,
        id: &str,
        input: UpdateProviderRequest,
    ) -> AppResult<ProviderConfig> {
        let exists = self.provider_exists(id).await?;
        if !exists {
            return Err(AppError::not_found("provider not found"));
        }

        let keys = sanitize_keys(&input.keys);
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            UPDATE providers
            SET display_name = ?, provider_kind = ?, api_base = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(input.display_name)
        .bind(input.provider_kind)
        .bind(input.api_base)
        .bind(if input.enabled { 1 } else { 0 })
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|error| Self::map_write_error(error, "provider display name already exists"))?;

        sqlx::query("DELETE FROM provider_keys WHERE provider_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        for (index, key) in keys.into_iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO provider_keys (id, provider_id, api_key, sort_order)
                VALUES (?, ?, ?, ?)
                "#,
            )
            .bind(Uuid::new_v4().to_string())
            .bind(id)
            .bind(key)
            .bind(index as i64)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        self.fetch_provider(id).await
    }

    async fn delete_provider(&self, id: &str) -> AppResult<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM provider_keys WHERE provider_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        let result = sqlx::query("DELETE FROM providers WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::not_found("provider not found"));
        }

        tx.commit().await?;
        Ok(())
    }

    async fn provider_exists(&self, id: &str) -> AppResult<bool> {
        let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM providers WHERE id = ?")
            .bind(id)
            .fetch_one(self.pool.as_ref())
            .await?;

        Ok(count > 0)
    }

    async fn is_provider_in_use(&self, id: &str) -> AppResult<bool> {
        let count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM models WHERE provider_ref = ?")
                .bind(id)
                .fetch_one(self.pool.as_ref())
                .await?;

        Ok(count > 0)
    }
}

#[async_trait]
impl ModelRepository for SqliteStore {
    async fn list_models(&self) -> AppResult<Vec<ModelConfig>> {
        let rows = sqlx::query_as::<_, ModelRow>(
            r#"
            SELECT
              id, name, provider_ref, custom_provider_json, model_id, category,
              capabilities_json, params_json, enabled
            FROM models
            ORDER BY created_at ASC, name ASC
            "#,
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        rows.into_iter()
            .map(|row| self.model_row_to_config(row))
            .collect()
    }

    async fn get_model(&self, id: &str) -> AppResult<ModelConfig> {
        self.fetch_model(id).await
    }

    async fn create_model(&self, input: CreateModelRequest) -> AppResult<ModelConfig> {
        let id = Uuid::new_v4().to_string();
        let categories = serialize_categories(&input.category, &input.categories)?;
        let capabilities_json = serde_json::to_string(&input.capabilities)
            .map_err(|error| AppError::internal(error.to_string()))?;
        let params_json = serde_json::to_string(&input.params)
            .map_err(|error| AppError::internal(error.to_string()))?;
        let custom_provider_json = match input.custom_provider {
            Some(value) => Some(
                serde_json::to_string(&value)
                    .map_err(|error| AppError::internal(error.to_string()))?,
            ),
            None => None,
        };

        sqlx::query(
            r#"
            INSERT INTO models (
              id, name, provider_ref, custom_provider_json, model_id, category,
              capabilities_json, params_json, enabled
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(input.name)
        .bind(input.provider_ref)
        .bind(custom_provider_json)
        .bind(input.model_id)
        .bind(categories)
        .bind(capabilities_json)
        .bind(params_json)
        .bind(if input.enabled { 1 } else { 0 })
        .execute(self.pool.as_ref())
        .await
        .map_err(|error| Self::map_write_error(error, "model name already exists"))?;

        self.fetch_model(&id).await
    }

    async fn update_model(&self, id: &str, input: UpdateModelRequest) -> AppResult<ModelConfig> {
        let exists = self.model_exists(id).await?;
        if !exists {
            return Err(AppError::not_found("model not found"));
        }

        let categories = serialize_categories(&input.category, &input.categories)?;
        let capabilities_json = serde_json::to_string(&input.capabilities)
            .map_err(|error| AppError::internal(error.to_string()))?;
        let params_json = serde_json::to_string(&input.params)
            .map_err(|error| AppError::internal(error.to_string()))?;
        let custom_provider_json = match input.custom_provider {
            Some(value) => Some(
                serde_json::to_string(&value)
                    .map_err(|error| AppError::internal(error.to_string()))?,
            ),
            None => None,
        };

        sqlx::query(
            r#"
            UPDATE models
            SET
              name = ?, provider_ref = ?, custom_provider_json = ?, model_id = ?, category = ?,
              capabilities_json = ?, params_json = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(input.name)
        .bind(input.provider_ref)
        .bind(custom_provider_json)
        .bind(input.model_id)
        .bind(categories)
        .bind(capabilities_json)
        .bind(params_json)
        .bind(if input.enabled { 1 } else { 0 })
        .bind(id)
        .execute(self.pool.as_ref())
        .await
        .map_err(|error| Self::map_write_error(error, "model name already exists"))?;

        self.fetch_model(id).await
    }

    async fn delete_model(&self, id: &str) -> AppResult<()> {
        let result = sqlx::query("DELETE FROM models WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::not_found("model not found"));
        }

        Ok(())
    }

    async fn model_exists(&self, id: &str) -> AppResult<bool> {
        let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM models WHERE id = ?")
            .bind(id)
            .fetch_one(self.pool.as_ref())
            .await?;

        Ok(count > 0)
    }

    async fn is_model_in_use(&self, id: &str) -> AppResult<bool> {
        let count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(1)
            FROM agents
            WHERE
              reply_model_id = ?
              OR decision_model_id = ?
              OR component_asr_model_id = ?
              OR component_tts_model_id = ?
              OR component_vision_model_id = ?
              OR tool_planner_model_id = ?
              OR tool_executor_model_id = ?
            "#,
        )
        .bind(id)
        .bind(id)
        .bind(id)
        .bind(id)
        .bind(id)
        .bind(id)
        .bind(id)
        .fetch_one(self.pool.as_ref())
        .await?;

        Ok(count > 0)
    }
}

#[async_trait]
impl AgentRepository for SqliteStore {
    async fn list_agents(&self) -> AppResult<Vec<AgentConfig>> {
        let rows = sqlx::query_as::<_, AgentRow>(
            r#"
            SELECT
              id, name, persona, speech_rules, mode,
              component_asr_model_id, component_tts_model_id, component_vision_model_id,
              tool_planner_model_id, tool_executor_model_id,
              reply_model_id, decision_enabled, decision_model_id,
              component_asr_params_json, component_tts_params_json, component_vision_params_json,
              tool_planner_params_json, tool_executor_params_json, reply_params_json, decision_params_json
            FROM agents
            ORDER BY created_at ASC, name ASC
            "#,
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        rows.into_iter()
            .map(|row| self.agent_row_to_config(row))
            .collect()
    }

    async fn get_agent(&self, id: &str) -> AppResult<AgentConfig> {
        self.fetch_agent(id).await
    }

    async fn create_agent(&self, input: CreateAgentRequest) -> AppResult<AgentConfig> {
        let id = Uuid::new_v4().to_string();
        let component_asr_params_json = slot_params_json(&input.param_slots.component.asr)?;
        let component_tts_params_json = slot_params_json(&input.param_slots.component.tts)?;
        let component_vision_params_json = slot_params_json(&input.param_slots.component.vision)?;
        let tool_planner_params_json = slot_params_json(&input.param_slots.tool.planner)?;
        let tool_executor_params_json = slot_params_json(&input.param_slots.tool.executor)?;
        let reply_params_json = slot_params_json(&input.param_slots.reply)?;
        let decision_params_json = slot_params_json(&input.param_slots.decision)?;

        sqlx::query(
            r#"
            INSERT INTO agents (
              id, name, persona, speech_rules, mode,
              component_asr_model_id, component_tts_model_id, component_vision_model_id,
              tool_planner_model_id, tool_executor_model_id,
              reply_model_id, decision_enabled, decision_model_id,
              component_asr_params_json, component_tts_params_json, component_vision_params_json,
              tool_planner_params_json, tool_executor_params_json, reply_params_json, decision_params_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(input.name)
        .bind(input.persona)
        .bind(input.speech_rules)
        .bind(mode_as_str(&input.mode))
        .bind(input.component_slot.asr_model_id)
        .bind(input.component_slot.tts_model_id)
        .bind(input.component_slot.vision_model_id)
        .bind(input.tool_slot.planner_model_id)
        .bind(input.tool_slot.executor_model_id)
        .bind(input.reply_model_id)
        .bind(if input.decision_slot.enabled { 1 } else { 0 })
        .bind(input.decision_slot.model_id)
        .bind(component_asr_params_json)
        .bind(component_tts_params_json)
        .bind(component_vision_params_json)
        .bind(tool_planner_params_json)
        .bind(tool_executor_params_json)
        .bind(reply_params_json)
        .bind(decision_params_json)
        .execute(self.pool.as_ref())
        .await
        .map_err(|error| Self::map_write_error(error, "agent name already exists"))?;

        self.fetch_agent(&id).await
    }

    async fn update_agent(&self, id: &str, input: UpdateAgentRequest) -> AppResult<AgentConfig> {
        let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM agents WHERE id = ?")
            .bind(id)
            .fetch_one(self.pool.as_ref())
            .await?;

        if exists == 0 {
            return Err(AppError::not_found("agent not found"));
        }

        let component_asr_params_json = slot_params_json(&input.param_slots.component.asr)?;
        let component_tts_params_json = slot_params_json(&input.param_slots.component.tts)?;
        let component_vision_params_json = slot_params_json(&input.param_slots.component.vision)?;
        let tool_planner_params_json = slot_params_json(&input.param_slots.tool.planner)?;
        let tool_executor_params_json = slot_params_json(&input.param_slots.tool.executor)?;
        let reply_params_json = slot_params_json(&input.param_slots.reply)?;
        let decision_params_json = slot_params_json(&input.param_slots.decision)?;

        sqlx::query(
            r#"
            UPDATE agents
            SET
              name = ?, persona = ?, speech_rules = ?, mode = ?,
              component_asr_model_id = ?, component_tts_model_id = ?, component_vision_model_id = ?,
              tool_planner_model_id = ?, tool_executor_model_id = ?,
              reply_model_id = ?, decision_enabled = ?, decision_model_id = ?,
              component_asr_params_json = ?, component_tts_params_json = ?, component_vision_params_json = ?,
              tool_planner_params_json = ?, tool_executor_params_json = ?, reply_params_json = ?, decision_params_json = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(input.name)
        .bind(input.persona)
        .bind(input.speech_rules)
        .bind(mode_as_str(&input.mode))
        .bind(input.component_slot.asr_model_id)
        .bind(input.component_slot.tts_model_id)
        .bind(input.component_slot.vision_model_id)
        .bind(input.tool_slot.planner_model_id)
        .bind(input.tool_slot.executor_model_id)
        .bind(input.reply_model_id)
        .bind(if input.decision_slot.enabled { 1 } else { 0 })
        .bind(input.decision_slot.model_id)
        .bind(component_asr_params_json)
        .bind(component_tts_params_json)
        .bind(component_vision_params_json)
        .bind(tool_planner_params_json)
        .bind(tool_executor_params_json)
        .bind(reply_params_json)
        .bind(decision_params_json)
        .bind(id)
        .execute(self.pool.as_ref())
        .await
        .map_err(|error| Self::map_write_error(error, "agent name already exists"))?;

        self.fetch_agent(id).await
    }

    async fn delete_agent(&self, id: &str) -> AppResult<()> {
        let result = sqlx::query("DELETE FROM agents WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::not_found("agent not found"));
        }

        Ok(())
    }
}

#[derive(Debug, FromRow)]
struct AgentChatMessageRow {
    role: String,
    content: String,
}

#[derive(Debug, FromRow)]
struct AgentChatMessageMetaRow {
    id: String,
    role: String,
}

#[derive(Debug, FromRow)]
struct ChatSessionRow {
    id: String,
    agent_id: String,
    title: String,
    is_default: i64,
    is_pinned: i64,
    is_archived: i64,
    tags_json: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, FromRow)]
struct ChatSessionLastMessageRow {
    role: String,
    content: String,
}

#[derive(Debug)]
struct ChatSessionSummary {
    message_count: i64,
    last_message_role: Option<String>,
    last_message_preview: Option<String>,
}

#[derive(Debug, FromRow)]
struct WorkspaceChatSessionRow {
    id: String,
    title: String,
    is_pinned: i64,
    is_archived: i64,
    tags_json: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, FromRow)]
struct WorkspaceChatParticipantRow {
    agent_id: String,
    receive_mode: String,
    reply_mode: String,
    sort_order: i64,
}

#[derive(Debug, FromRow)]
struct WorkspaceChatMessageRow {
    role: String,
    content: String,
    agent_id: Option<String>,
    visible_to_json: Option<String>,
    created_at: String,
}

#[derive(Debug, FromRow)]
struct WorkspaceChatMessagePreviewRow {
    role: String,
    content: String,
}

#[async_trait]
impl ChatRepository for SqliteStore {
    async fn list_agent_chat_sessions(&self, agent_id: &str) -> AppResult<Vec<ChatSession>> {
        self.ensure_default_chat_session(agent_id).await?;

        let rows = sqlx::query_as::<_, ChatSessionRow>(
            r#"
            SELECT
              id, agent_id, title, is_default, is_pinned, is_archived, tags_json, created_at, updated_at
            FROM agent_chat_sessions
            WHERE agent_id = ?
            ORDER BY is_archived ASC, is_pinned DESC, is_default DESC, updated_at DESC, created_at DESC
            "#,
        )
        .bind(agent_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut output = Vec::with_capacity(rows.len());
        for row in rows {
            let is_default = row.is_default != 0;
            let summary = self
                .fetch_chat_session_summary(agent_id, &row.id, is_default)
                .await?;
            output.push(ChatSession {
                id: row.id,
                agent_id: row.agent_id,
                title: row.title,
                is_default,
                is_pinned: row.is_pinned != 0,
                is_archived: row.is_archived != 0,
                tags: parse_tags_json(row.tags_json.as_deref())?,
                created_at: row.created_at,
                updated_at: row.updated_at,
                message_count: summary.message_count,
                last_message_role: summary.last_message_role,
                last_message_preview: summary.last_message_preview,
            });
        }
        Ok(output)
    }

    async fn create_agent_chat_session(&self, agent_id: &str, title: &str) -> AppResult<ChatSession> {
        self.ensure_default_chat_session(agent_id).await?;
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO agent_chat_sessions (id, agent_id, title, is_default)
            VALUES (?, ?, ?, 0)
            "#,
        )
        .bind(&id)
        .bind(agent_id)
        .bind(title)
        .execute(self.pool.as_ref())
        .await
        .map_err(|error| Self::map_write_error(error, "chat session title already exists"))?;

        self.fetch_chat_session(agent_id, &id).await
    }

    async fn rename_agent_chat_session(
        &self,
        agent_id: &str,
        session_id: &str,
        title: &str,
    ) -> AppResult<ChatSession> {
        let existing = self.fetch_chat_session(agent_id, session_id).await?;
        if existing.is_default {
            return Err(AppError::validation("default chat session cannot be renamed"));
        }

        sqlx::query(
            r#"
            UPDATE agent_chat_sessions
            SET title = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND agent_id = ?
            "#,
        )
        .bind(title)
        .bind(session_id)
        .bind(agent_id)
        .execute(self.pool.as_ref())
        .await
        .map_err(|error| Self::map_write_error(error, "chat session title already exists"))?;

        self.fetch_chat_session(agent_id, session_id).await
    }

    async fn duplicate_agent_chat_session(
        &self,
        agent_id: &str,
        source_session_id: &str,
        title: &str,
    ) -> AppResult<ChatSession> {
        self.ensure_default_chat_session(agent_id).await?;
        let source = self.fetch_chat_session(agent_id, source_session_id).await?;

        let source_messages = if source.is_default {
            sqlx::query_as::<_, AgentChatMessageRow>(
                r#"
                SELECT role, content
                FROM agent_chat_messages
                WHERE agent_id = ? AND (session_id = ? OR session_id IS NULL)
                ORDER BY rowid ASC
                "#,
            )
            .bind(agent_id)
            .bind(source_session_id)
            .fetch_all(self.pool.as_ref())
            .await?
        } else {
            sqlx::query_as::<_, AgentChatMessageRow>(
                r#"
                SELECT role, content
                FROM agent_chat_messages
                WHERE agent_id = ? AND session_id = ?
                ORDER BY rowid ASC
                "#,
            )
            .bind(agent_id)
            .bind(source_session_id)
            .fetch_all(self.pool.as_ref())
            .await?
        };

        let new_session_id = Uuid::new_v4().to_string();
        let copied_tags_json = tags_to_json(&source.tags)?;
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            INSERT INTO agent_chat_sessions (id, agent_id, title, is_default, is_pinned, is_archived, tags_json)
            VALUES (?, ?, ?, 0, 0, 0, ?)
            "#,
        )
        .bind(&new_session_id)
        .bind(agent_id)
        .bind(title)
        .bind(copied_tags_json)
        .execute(&mut *tx)
        .await
        .map_err(|error| Self::map_write_error(error, "chat session title already exists"))?;

        for message in source_messages {
            sqlx::query(
                r#"
                INSERT INTO agent_chat_messages (id, agent_id, session_id, role, content)
                VALUES (?, ?, ?, ?, ?)
                "#,
            )
            .bind(Uuid::new_v4().to_string())
            .bind(agent_id)
            .bind(&new_session_id)
            .bind(message.role)
            .bind(message.content)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        self.fetch_chat_session(agent_id, &new_session_id).await
    }

    async fn set_agent_chat_session_pinned(
        &self,
        agent_id: &str,
        session_id: &str,
        pinned: bool,
    ) -> AppResult<ChatSession> {
        self.fetch_chat_session(agent_id, session_id).await?;
        sqlx::query(
            r#"
            UPDATE agent_chat_sessions
            SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND agent_id = ?
            "#,
        )
        .bind(if pinned { 1 } else { 0 })
        .bind(session_id)
        .bind(agent_id)
        .execute(self.pool.as_ref())
        .await?;
        self.fetch_chat_session(agent_id, session_id).await
    }

    async fn set_agent_chat_session_archived(
        &self,
        agent_id: &str,
        session_id: &str,
        archived: bool,
    ) -> AppResult<ChatSession> {
        let existing = self.fetch_chat_session(agent_id, session_id).await?;
        if existing.is_default && archived {
            return Err(AppError::validation("default chat session cannot be archived"));
        }
        sqlx::query(
            r#"
            UPDATE agent_chat_sessions
            SET is_archived = ?, is_pinned = CASE WHEN ? = 1 THEN 0 ELSE is_pinned END, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND agent_id = ?
            "#,
        )
        .bind(if archived { 1 } else { 0 })
        .bind(if archived { 1 } else { 0 })
        .bind(session_id)
        .bind(agent_id)
        .execute(self.pool.as_ref())
        .await?;
        self.fetch_chat_session(agent_id, session_id).await
    }

    async fn set_agent_chat_session_tags(
        &self,
        agent_id: &str,
        session_id: &str,
        tags: &[String],
    ) -> AppResult<ChatSession> {
        self.fetch_chat_session(agent_id, session_id).await?;
        let tags_json = tags_to_json(tags)?;
        sqlx::query(
            r#"
            UPDATE agent_chat_sessions
            SET tags_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND agent_id = ?
            "#,
        )
        .bind(tags_json)
        .bind(session_id)
        .bind(agent_id)
        .execute(self.pool.as_ref())
        .await?;
        self.fetch_chat_session(agent_id, session_id).await
    }

    async fn delete_agent_chat_session(&self, agent_id: &str, session_id: &str) -> AppResult<()> {
        let existing = self.fetch_chat_session(agent_id, session_id).await?;
        if existing.is_default {
            return Err(AppError::validation("default chat session cannot be deleted"));
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM agent_chat_messages WHERE agent_id = ? AND session_id = ?")
            .bind(agent_id)
            .bind(session_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query("DELETE FROM agent_chat_sessions WHERE id = ? AND agent_id = ?")
            .bind(session_id)
            .bind(agent_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(())
    }

    async fn list_agent_chat_messages(&self, agent_id: &str) -> AppResult<Vec<ChatMessage>> {
        let default_session = self.ensure_default_chat_session(agent_id).await?;
        self.list_chat_session_messages(agent_id, &default_session.id).await
    }

    async fn list_chat_session_messages(
        &self,
        agent_id: &str,
        session_id: &str,
    ) -> AppResult<Vec<ChatMessage>> {
        let session = self.fetch_chat_session(agent_id, session_id).await?;
        let rows = if session.is_default {
            sqlx::query_as::<_, AgentChatMessageRow>(
                r#"
                SELECT role, content
                FROM agent_chat_messages
                WHERE agent_id = ? AND (session_id = ? OR session_id IS NULL)
                ORDER BY rowid ASC
                "#,
            )
            .bind(agent_id)
            .bind(session_id)
            .fetch_all(self.pool.as_ref())
            .await?
        } else {
            sqlx::query_as::<_, AgentChatMessageRow>(
                r#"
                SELECT role, content
                FROM agent_chat_messages
                WHERE agent_id = ? AND session_id = ?
                ORDER BY rowid ASC
                "#,
            )
            .bind(agent_id)
            .bind(session_id)
            .fetch_all(self.pool.as_ref())
            .await?
        };

        rows.into_iter()
            .map(|row| {
                Ok(ChatMessage {
                    role: parse_chat_role(&row.role)?,
                    content: row.content,
                })
            })
            .collect()
    }

    async fn append_agent_chat_message(
        &self,
        agent_id: &str,
        role: ChatMessageRole,
        content: String,
    ) -> AppResult<()> {
        let default_session = self.ensure_default_chat_session(agent_id).await?;
        self.append_chat_session_message(agent_id, &default_session.id, role, content)
            .await
    }

    async fn append_chat_session_message(
        &self,
        agent_id: &str,
        session_id: &str,
        role: ChatMessageRole,
        content: String,
    ) -> AppResult<()> {
        self.fetch_chat_session(agent_id, session_id).await?;
        sqlx::query(
            r#"
            INSERT INTO agent_chat_messages (id, agent_id, session_id, role, content)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(agent_id)
        .bind(session_id)
        .bind(chat_role_as_str(&role))
        .bind(content)
        .execute(self.pool.as_ref())
        .await?;
        self.touch_chat_session(agent_id, session_id).await?;

        Ok(())
    }

    async fn delete_last_chat_session_assistant_message(
        &self,
        agent_id: &str,
        session_id: &str,
    ) -> AppResult<bool> {
        let session = self.fetch_chat_session(agent_id, session_id).await?;
        let role = chat_role_as_str(&ChatMessageRole::Assistant);
        let message_id = if session.is_default {
            sqlx::query_scalar::<_, String>(
                r#"
                SELECT id
                FROM agent_chat_messages
                WHERE agent_id = ? AND (session_id = ? OR session_id IS NULL) AND role = ?
                ORDER BY rowid DESC
                LIMIT 1
                "#,
            )
            .bind(agent_id)
            .bind(session_id)
            .bind(role)
            .fetch_optional(self.pool.as_ref())
            .await?
        } else {
            sqlx::query_scalar::<_, String>(
                r#"
                SELECT id
                FROM agent_chat_messages
                WHERE agent_id = ? AND session_id = ? AND role = ?
                ORDER BY rowid DESC
                LIMIT 1
                "#,
            )
            .bind(agent_id)
            .bind(session_id)
            .bind(role)
            .fetch_optional(self.pool.as_ref())
            .await?
        };

        let Some(message_id) = message_id else {
            return Ok(false);
        };

        sqlx::query("DELETE FROM agent_chat_messages WHERE id = ? AND agent_id = ?")
            .bind(message_id)
            .bind(agent_id)
            .execute(self.pool.as_ref())
            .await?;
        self.touch_chat_session(agent_id, session_id).await?;
        Ok(true)
    }

    async fn pop_last_chat_session_turn(&self, agent_id: &str, session_id: &str) -> AppResult<i32> {
        let session = self.fetch_chat_session(agent_id, session_id).await?;
        let rows = if session.is_default {
            sqlx::query_as::<_, AgentChatMessageMetaRow>(
                r#"
                SELECT id, role
                FROM agent_chat_messages
                WHERE agent_id = ? AND (session_id = ? OR session_id IS NULL)
                ORDER BY rowid ASC
                "#,
            )
            .bind(agent_id)
            .bind(session_id)
            .fetch_all(self.pool.as_ref())
            .await?
        } else {
            sqlx::query_as::<_, AgentChatMessageMetaRow>(
                r#"
                SELECT id, role
                FROM agent_chat_messages
                WHERE agent_id = ? AND session_id = ?
                ORDER BY rowid ASC
                "#,
            )
            .bind(agent_id)
            .bind(session_id)
            .fetch_all(self.pool.as_ref())
            .await?
        };

        if rows.is_empty() {
            return Ok(0);
        }

        let mut delete_ids = Vec::<String>::new();
        if let Some(assistant_index) = rows
            .iter()
            .rposition(|row| row.role.eq_ignore_ascii_case("assistant"))
        {
            delete_ids.push(rows[assistant_index].id.clone());
            if let Some(user_index) = rows[..assistant_index]
                .iter()
                .rposition(|row| row.role.eq_ignore_ascii_case("user"))
            {
                delete_ids.push(rows[user_index].id.clone());
            }
        } else if let Some(user_index) = rows
            .iter()
            .rposition(|row| row.role.eq_ignore_ascii_case("user"))
        {
            delete_ids.push(rows[user_index].id.clone());
        }

        if delete_ids.is_empty() {
            return Ok(0);
        }

        let mut tx = self.pool.begin().await?;
        for id in &delete_ids {
            sqlx::query("DELETE FROM agent_chat_messages WHERE id = ? AND agent_id = ?")
                .bind(id)
                .bind(agent_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        self.touch_chat_session(agent_id, session_id).await?;
        Ok(delete_ids.len() as i32)
    }

    async fn clear_agent_chat_messages(&self, agent_id: &str) -> AppResult<()> {
        let default_session = self.ensure_default_chat_session(agent_id).await?;
        self.clear_chat_session_messages(agent_id, &default_session.id)
            .await
    }

    async fn clear_chat_session_messages(&self, agent_id: &str, session_id: &str) -> AppResult<()> {
        let session = self.fetch_chat_session(agent_id, session_id).await?;
        if session.is_default {
            sqlx::query(
                "DELETE FROM agent_chat_messages WHERE agent_id = ? AND (session_id = ? OR session_id IS NULL)",
            )
            .bind(agent_id)
            .bind(session_id)
            .execute(self.pool.as_ref())
            .await?;
        } else {
            sqlx::query("DELETE FROM agent_chat_messages WHERE agent_id = ? AND session_id = ?")
                .bind(agent_id)
                .bind(session_id)
                .execute(self.pool.as_ref())
                .await?;
        }
        self.touch_chat_session(agent_id, session_id).await?;
        Ok(())
    }

    async fn chat_counts(&self) -> AppResult<(i64, i64)> {
        let session_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM agent_chat_sessions")
            .fetch_one(self.pool.as_ref())
            .await?;
        let message_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM agent_chat_messages")
            .fetch_one(self.pool.as_ref())
            .await?;
        Ok((session_count, message_count))
    }
}

#[async_trait]
impl WorkspaceChatRepository for SqliteStore {
    async fn workspace_chat_counts(&self) -> AppResult<(i64, i64)> {
        let session_count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM workspace_chat_sessions")
                .fetch_one(self.pool.as_ref())
                .await?;
        let message_count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM workspace_chat_messages")
                .fetch_one(self.pool.as_ref())
                .await?;
        Ok((session_count, message_count))
    }

    async fn list_workspace_chat_sessions(&self) -> AppResult<Vec<WorkspaceChatSession>> {
        let rows = sqlx::query_as::<_, WorkspaceChatSessionRow>(
            r#"
            SELECT id, title, is_pinned, is_archived, tags_json, created_at, updated_at
            FROM workspace_chat_sessions
            ORDER BY is_archived ASC, is_pinned DESC, updated_at DESC, created_at DESC
            "#,
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut output = Vec::with_capacity(rows.len());
        for row in rows {
            let participants = self.fetch_workspace_chat_participants(&row.id).await?;
            let summary = self.fetch_workspace_chat_session_summary(&row.id).await?;
            output.push(WorkspaceChatSession {
                id: row.id,
                title: row.title,
                participants: participants.clone(),
                is_group: participants.len() > 1,
                is_pinned: row.is_pinned != 0,
                is_archived: row.is_archived != 0,
                tags: parse_tags_json(row.tags_json.as_deref())?,
                created_at: row.created_at,
                updated_at: row.updated_at,
                message_count: summary.message_count,
                last_message_role: summary.last_message_role,
                last_message_preview: summary.last_message_preview,
            });
        }
        Ok(output)
    }

    async fn get_workspace_chat_session(&self, session_id: &str) -> AppResult<WorkspaceChatSession> {
        self.fetch_workspace_chat_session(session_id).await
    }

    async fn create_workspace_chat_session(
        &self,
        title: &str,
        participants: &[WorkspaceChatParticipant],
    ) -> AppResult<WorkspaceChatSession> {
        let id = Uuid::new_v4().to_string();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            INSERT INTO workspace_chat_sessions (id, title)
            VALUES (?, ?)
            "#,
        )
        .bind(&id)
        .bind(title)
        .execute(&mut *tx)
        .await?;

        for participant in participants {
            sqlx::query(
                r#"
                INSERT INTO workspace_chat_session_participants (
                  session_id, agent_id, receive_mode, reply_mode, sort_order
                )
                VALUES (?, ?, ?, ?, ?)
                "#,
            )
            .bind(&id)
            .bind(&participant.agent_id)
            .bind(workspace_participant_mode_as_str(&participant.receive_mode))
            .bind(workspace_participant_mode_as_str(&participant.reply_mode))
            .bind(participant.sort_order)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        self.fetch_workspace_chat_session(&id).await
    }

    async fn update_workspace_chat_session(
        &self,
        session_id: &str,
        title: &str,
        participants: &[WorkspaceChatParticipant],
        pinned: bool,
        archived: bool,
        tags: &[String],
    ) -> AppResult<WorkspaceChatSession> {
        self.fetch_workspace_chat_session(session_id).await?;
        let tags_json = tags_to_json(tags)?;
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            UPDATE workspace_chat_sessions
            SET title = ?, is_pinned = ?, is_archived = ?, tags_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(title)
        .bind(if pinned { 1 } else { 0 })
        .bind(if archived { 1 } else { 0 })
        .bind(tags_json)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM workspace_chat_session_participants WHERE session_id = ?")
            .bind(session_id)
            .execute(&mut *tx)
            .await?;
        for participant in participants {
            sqlx::query(
                r#"
                INSERT INTO workspace_chat_session_participants (
                  session_id, agent_id, receive_mode, reply_mode, sort_order
                )
                VALUES (?, ?, ?, ?, ?)
                "#,
            )
            .bind(session_id)
            .bind(&participant.agent_id)
            .bind(workspace_participant_mode_as_str(&participant.receive_mode))
            .bind(workspace_participant_mode_as_str(&participant.reply_mode))
            .bind(participant.sort_order)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        self.fetch_workspace_chat_session(session_id).await
    }

    async fn delete_workspace_chat_session(&self, session_id: &str) -> AppResult<()> {
        self.fetch_workspace_chat_session(session_id).await?;
        sqlx::query("DELETE FROM workspace_chat_sessions WHERE id = ?")
            .bind(session_id)
            .execute(self.pool.as_ref())
            .await?;
        Ok(())
    }

    async fn list_workspace_chat_messages(
        &self,
        session_id: &str,
    ) -> AppResult<Vec<WorkspaceChatMessage>> {
        self.fetch_workspace_chat_session(session_id).await?;
        let rows = sqlx::query_as::<_, WorkspaceChatMessageRow>(
            r#"
            SELECT role, content, agent_id, visible_to_json, created_at
            FROM workspace_chat_messages
            WHERE session_id = ?
            ORDER BY rowid ASC
            "#,
        )
        .bind(session_id)
        .fetch_all(self.pool.as_ref())
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(WorkspaceChatMessage {
                    role: parse_workspace_chat_role(&row.role)?,
                    content: row.content,
                    agent_id: row.agent_id,
                    visible_to_agent_ids: parse_visible_agents_json(row.visible_to_json.as_deref())?,
                    created_at: row.created_at,
                })
            })
            .collect()
    }

    async fn clear_workspace_chat_messages(&self, session_id: &str) -> AppResult<()> {
        self.fetch_workspace_chat_session(session_id).await?;
        sqlx::query("DELETE FROM workspace_chat_messages WHERE session_id = ?")
            .bind(session_id)
            .execute(self.pool.as_ref())
            .await?;
        self.touch_workspace_chat_session(session_id).await?;
        Ok(())
    }

    async fn append_workspace_chat_message(
        &self,
        session_id: &str,
        role: WorkspaceChatMessageRole,
        content: String,
        agent_id: Option<&str>,
        visible_to_agent_ids: &[String],
    ) -> AppResult<WorkspaceChatMessage> {
        self.fetch_workspace_chat_session(session_id).await?;
        let message_id = Uuid::new_v4().to_string();
        let visible_to_json = visible_agents_to_json(visible_to_agent_ids)?;
        sqlx::query(
            r#"
            INSERT INTO workspace_chat_messages (id, session_id, role, content, agent_id, visible_to_json)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&message_id)
        .bind(session_id)
        .bind(workspace_chat_role_as_str(&role))
        .bind(&content)
        .bind(agent_id)
        .bind(visible_to_json)
        .execute(self.pool.as_ref())
        .await?;
        self.touch_workspace_chat_session(session_id).await?;

        let created_at = sqlx::query_scalar::<_, String>(
            "SELECT created_at FROM workspace_chat_messages WHERE id = ?",
        )
        .bind(&message_id)
        .fetch_one(self.pool.as_ref())
        .await?;
        Ok(WorkspaceChatMessage {
            role,
            content,
            agent_id: agent_id.map(str::to_string),
            visible_to_agent_ids: visible_to_agent_ids.to_vec(),
            created_at,
        })
    }
}
