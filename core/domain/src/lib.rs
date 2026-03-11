pub mod dto;
pub mod error;
pub mod repository;
pub mod runtime;
pub mod service;
pub mod sqlite;
pub mod types;

pub use dto::*;
pub use error::{AppError, AppResult, ErrorPayload};
pub use repository::*;
pub use runtime::{
    ChatCompletionGateway, CompletionRequest, CompletionResponse, OpenAICompatChatGateway,
};
pub use service::AppService;
pub use sqlite::SqliteStore;
pub use types::*;

pub fn database_url_from_env() -> String {
    std::env::var("GIRL_AI_AGENT_DB_URL").unwrap_or_else(|_| "sqlite://girl-ai-agent.db".to_string())
}

#[derive(Clone)]
pub struct AppDomainRuntime {
    service: AppService<SqliteStore>,
    chat_gateway: OpenAICompatChatGateway,
}

impl AppDomainRuntime {
    pub async fn runtime_stats(&self) -> AppResult<RuntimeStats> {
        self.service.runtime_stats().await
    }

    pub async fn list_providers(&self) -> AppResult<Vec<ProviderConfig>> {
        self.service.list_providers().await
    }

    pub async fn create_provider(&self, input: CreateProviderRequest) -> AppResult<ProviderConfig> {
        self.service.create_provider(input).await
    }

    pub async fn update_provider(
        &self,
        id: &str,
        input: UpdateProviderRequest,
    ) -> AppResult<ProviderConfig> {
        self.service.update_provider(id, input).await
    }

    pub async fn delete_provider(&self, id: &str) -> AppResult<()> {
        self.service.delete_provider(id).await
    }

    pub async fn probe_provider_connection(
        &self,
        input: ProbeProviderConnectionRequest,
    ) -> AppResult<ProbeProviderConnectionResponse> {
        self.service.probe_provider_connection(input).await
    }

    pub async fn list_models(&self) -> AppResult<Vec<ModelConfig>> {
        self.service.list_models().await
    }

    pub async fn create_model(&self, input: CreateModelRequest) -> AppResult<ModelConfig> {
        self.service.create_model(input).await
    }

    pub async fn update_model(&self, id: &str, input: UpdateModelRequest) -> AppResult<ModelConfig> {
        self.service.update_model(id, input).await
    }

    pub async fn delete_model(&self, id: &str) -> AppResult<()> {
        self.service.delete_model(id).await
    }

    pub async fn probe_model_connection(
        &self,
        input: ProbeModelConnectionRequest,
    ) -> AppResult<ProbeModelConnectionResponse> {
        self.service
            .probe_model_connection(&self.chat_gateway, input)
            .await
    }

    pub async fn list_agents(&self) -> AppResult<Vec<AgentConfig>> {
        self.service.list_agents().await
    }

    pub async fn create_agent(&self, input: CreateAgentRequest) -> AppResult<AgentConfig> {
        self.service.create_agent(input).await
    }

    pub async fn update_agent(&self, id: &str, input: UpdateAgentRequest) -> AppResult<AgentConfig> {
        self.service.update_agent(id, input).await
    }

    pub async fn delete_agent(&self, id: &str) -> AppResult<()> {
        self.service.delete_agent(id).await
    }

    pub async fn list_workspace_chat_sessions(&self) -> AppResult<Vec<WorkspaceChatSession>> {
        self.service.list_workspace_chat_sessions().await
    }

    pub async fn create_workspace_chat_session(
        &self,
        input: CreateWorkspaceChatSessionRequest,
    ) -> AppResult<WorkspaceChatSession> {
        self.service.create_workspace_chat_session(input).await
    }

    pub async fn update_workspace_chat_session(
        &self,
        session_id: &str,
        input: UpdateWorkspaceChatSessionRequest,
    ) -> AppResult<WorkspaceChatSession> {
        self.service
            .update_workspace_chat_session(session_id, input)
            .await
    }

    pub async fn delete_workspace_chat_session(&self, session_id: &str) -> AppResult<()> {
        self.service.delete_workspace_chat_session(session_id).await
    }

    pub async fn list_workspace_chat_messages(
        &self,
        session_id: &str,
    ) -> AppResult<Vec<WorkspaceChatMessage>> {
        self.service.list_workspace_chat_messages(session_id).await
    }

    pub async fn clear_workspace_chat_messages(&self, session_id: &str) -> AppResult<()> {
        self.service.clear_workspace_chat_messages(session_id).await
    }

    pub async fn chat_with_session(
        &self,
        input: ChatWithSessionRequest,
    ) -> AppResult<ChatWithSessionResponse> {
        self.service.chat_with_session(&self.chat_gateway, input).await
    }

    pub async fn chat_with_agent(
        &self,
        input: ChatWithAgentRequest,
    ) -> AppResult<ChatWithAgentResponse> {
        self.service.chat_with_agent(&self.chat_gateway, input).await
    }

    pub async fn regenerate_chat_reply(
        &self,
        input: RegenerateChatReplyRequest,
    ) -> AppResult<ChatWithAgentResponse> {
        self.service
            .regenerate_chat_reply(&self.chat_gateway, input)
            .await
    }

    pub async fn undo_last_chat_turn(
        &self,
        input: UndoLastChatTurnRequest,
    ) -> AppResult<UndoLastChatTurnResponse> {
        self.service.undo_last_chat_turn(input).await
    }

    pub async fn rewrite_last_user_message(
        &self,
        input: RewriteLastUserMessageRequest,
    ) -> AppResult<ChatWithAgentResponse> {
        self.service
            .rewrite_last_user_message(&self.chat_gateway, input)
            .await
    }

    pub async fn rewrite_chat_user_message(
        &self,
        input: RewriteChatUserMessageRequest,
    ) -> AppResult<ChatWithAgentResponse> {
        self.service
            .rewrite_chat_user_message(&self.chat_gateway, input)
            .await
    }

    pub async fn list_agent_chat_messages(&self, agent_id: &str) -> AppResult<Vec<ChatMessage>> {
        self.service.list_agent_chat_messages(agent_id).await
    }

    pub async fn clear_agent_chat_messages(&self, agent_id: &str) -> AppResult<()> {
        self.service.clear_agent_chat_messages(agent_id).await
    }

    pub async fn list_agent_chat_sessions(&self, agent_id: &str) -> AppResult<Vec<ChatSession>> {
        self.service.list_agent_chat_sessions(agent_id).await
    }

    pub async fn create_agent_chat_session(
        &self,
        agent_id: &str,
        title: &str,
    ) -> AppResult<ChatSession> {
        self.service.create_agent_chat_session(agent_id, title).await
    }

    pub async fn rename_agent_chat_session(
        &self,
        agent_id: &str,
        session_id: &str,
        title: &str,
    ) -> AppResult<ChatSession> {
        self.service
            .rename_agent_chat_session(agent_id, session_id, title)
            .await
    }

    pub async fn duplicate_agent_chat_session(
        &self,
        agent_id: &str,
        source_session_id: &str,
        title: &str,
    ) -> AppResult<ChatSession> {
        self.service
            .duplicate_agent_chat_session(agent_id, source_session_id, title)
            .await
    }

    pub async fn set_agent_chat_session_pinned(
        &self,
        agent_id: &str,
        session_id: &str,
        pinned: bool,
    ) -> AppResult<ChatSession> {
        self.service
            .set_agent_chat_session_pinned(agent_id, session_id, pinned)
            .await
    }

    pub async fn set_agent_chat_session_archived(
        &self,
        agent_id: &str,
        session_id: &str,
        archived: bool,
    ) -> AppResult<ChatSession> {
        self.service
            .set_agent_chat_session_archived(agent_id, session_id, archived)
            .await
    }

    pub async fn set_agent_chat_session_tags(
        &self,
        agent_id: &str,
        session_id: &str,
        tags: &[String],
    ) -> AppResult<ChatSession> {
        self.service
            .set_agent_chat_session_tags(agent_id, session_id, tags)
            .await
    }

    pub async fn delete_agent_chat_session(
        &self,
        agent_id: &str,
        session_id: &str,
    ) -> AppResult<()> {
        self.service
            .delete_agent_chat_session(agent_id, session_id)
            .await
    }

    pub async fn list_chat_session_messages(
        &self,
        agent_id: &str,
        session_id: &str,
    ) -> AppResult<Vec<ChatMessage>> {
        self.service
            .list_chat_session_messages(agent_id, session_id)
            .await
    }

    pub async fn clear_chat_session_messages(
        &self,
        agent_id: &str,
        session_id: &str,
    ) -> AppResult<()> {
        self.service
            .clear_chat_session_messages(agent_id, session_id)
            .await
    }
}

pub async fn connect_runtime(database_url: &str) -> AppResult<AppDomainRuntime> {
    let store = SqliteStore::connect(database_url).await?;
    let service = AppService::new(std::sync::Arc::new(store));
    let chat_gateway = OpenAICompatChatGateway::new();

    Ok(AppDomainRuntime {
        service,
        chat_gateway,
    })
}

#[cfg(test)]
mod tests {
    use super::connect_runtime;

    #[tokio::test]
    async fn connect_runtime_supports_memory_database() {
        let runtime = connect_runtime("sqlite::memory:").await.expect("runtime should initialize");
        let stats = runtime
            .runtime_stats()
            .await
            .expect("runtime stats should be readable");

        assert_eq!(stats.provider_count, 0);
        assert_eq!(stats.agent_count, 0);
        assert_eq!(stats.session_count, 0);
    }
}
