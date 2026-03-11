use async_trait::async_trait;

use crate::{
    dto::{
        ChatMessage, ChatMessageRole, CreateAgentRequest, CreateModelRequest, CreateProviderRequest,
        UpdateAgentRequest, UpdateModelRequest, UpdateProviderRequest,
    },
    error::AppResult,
    types::{
        AgentConfig, ChatSession, ModelConfig, ProviderConfig, WorkspaceChatMessage,
        WorkspaceChatMessageRole, WorkspaceChatParticipant, WorkspaceChatSession,
    },
};

#[async_trait]
pub trait ProviderRepository: Send + Sync {
    async fn list_providers(&self) -> AppResult<Vec<ProviderConfig>>;
    async fn get_provider(&self, id: &str) -> AppResult<ProviderConfig>;
    async fn create_provider(&self, input: CreateProviderRequest) -> AppResult<ProviderConfig>;
    async fn update_provider(
        &self,
        id: &str,
        input: UpdateProviderRequest,
    ) -> AppResult<ProviderConfig>;
    async fn delete_provider(&self, id: &str) -> AppResult<()>;
    async fn provider_exists(&self, id: &str) -> AppResult<bool>;
    async fn is_provider_in_use(&self, id: &str) -> AppResult<bool>;
}

#[async_trait]
pub trait ModelRepository: Send + Sync {
    async fn list_models(&self) -> AppResult<Vec<ModelConfig>>;
    async fn get_model(&self, id: &str) -> AppResult<ModelConfig>;
    async fn create_model(&self, input: CreateModelRequest) -> AppResult<ModelConfig>;
    async fn update_model(&self, id: &str, input: UpdateModelRequest) -> AppResult<ModelConfig>;
    async fn delete_model(&self, id: &str) -> AppResult<()>;
    async fn model_exists(&self, id: &str) -> AppResult<bool>;
    async fn is_model_in_use(&self, id: &str) -> AppResult<bool>;
}

#[async_trait]
pub trait AgentRepository: Send + Sync {
    async fn list_agents(&self) -> AppResult<Vec<AgentConfig>>;
    async fn get_agent(&self, id: &str) -> AppResult<AgentConfig>;
    async fn create_agent(&self, input: CreateAgentRequest) -> AppResult<AgentConfig>;
    async fn update_agent(&self, id: &str, input: UpdateAgentRequest) -> AppResult<AgentConfig>;
    async fn delete_agent(&self, id: &str) -> AppResult<()>;
}

#[async_trait]
pub trait ChatRepository: Send + Sync {
    async fn list_agent_chat_sessions(&self, agent_id: &str) -> AppResult<Vec<ChatSession>>;
    async fn create_agent_chat_session(&self, agent_id: &str, title: &str) -> AppResult<ChatSession>;
    async fn rename_agent_chat_session(
        &self,
        agent_id: &str,
        session_id: &str,
        title: &str,
    ) -> AppResult<ChatSession>;
    async fn duplicate_agent_chat_session(
        &self,
        agent_id: &str,
        source_session_id: &str,
        title: &str,
    ) -> AppResult<ChatSession>;
    async fn set_agent_chat_session_pinned(
        &self,
        agent_id: &str,
        session_id: &str,
        pinned: bool,
    ) -> AppResult<ChatSession>;
    async fn set_agent_chat_session_archived(
        &self,
        agent_id: &str,
        session_id: &str,
        archived: bool,
    ) -> AppResult<ChatSession>;
    async fn set_agent_chat_session_tags(
        &self,
        agent_id: &str,
        session_id: &str,
        tags: &[String],
    ) -> AppResult<ChatSession>;
    async fn delete_agent_chat_session(&self, agent_id: &str, session_id: &str) -> AppResult<()>;

    async fn list_agent_chat_messages(&self, agent_id: &str) -> AppResult<Vec<ChatMessage>>;
    async fn list_chat_session_messages(
        &self,
        agent_id: &str,
        session_id: &str,
    ) -> AppResult<Vec<ChatMessage>>;
    async fn append_agent_chat_message(
        &self,
        agent_id: &str,
        role: ChatMessageRole,
        content: String,
    ) -> AppResult<()>;
    async fn append_chat_session_message(
        &self,
        agent_id: &str,
        session_id: &str,
        role: ChatMessageRole,
        content: String,
    ) -> AppResult<()>;
    async fn delete_last_chat_session_assistant_message(
        &self,
        agent_id: &str,
        session_id: &str,
    ) -> AppResult<bool>;
    async fn pop_last_chat_session_turn(&self, agent_id: &str, session_id: &str) -> AppResult<i32>;
    async fn clear_agent_chat_messages(&self, agent_id: &str) -> AppResult<()>;
    async fn clear_chat_session_messages(&self, agent_id: &str, session_id: &str) -> AppResult<()>;
    async fn chat_counts(&self) -> AppResult<(i64, i64)>;
}

#[async_trait]
pub trait WorkspaceChatRepository: Send + Sync {
    async fn workspace_chat_counts(&self) -> AppResult<(i64, i64)>;
    async fn list_workspace_chat_sessions(&self) -> AppResult<Vec<WorkspaceChatSession>>;
    async fn get_workspace_chat_session(&self, session_id: &str) -> AppResult<WorkspaceChatSession>;
    async fn create_workspace_chat_session(
        &self,
        title: &str,
        participants: &[WorkspaceChatParticipant],
    ) -> AppResult<WorkspaceChatSession>;
    async fn update_workspace_chat_session(
        &self,
        session_id: &str,
        title: &str,
        participants: &[WorkspaceChatParticipant],
        pinned: bool,
        archived: bool,
        tags: &[String],
    ) -> AppResult<WorkspaceChatSession>;
    async fn delete_workspace_chat_session(&self, session_id: &str) -> AppResult<()>;
    async fn list_workspace_chat_messages(
        &self,
        session_id: &str,
    ) -> AppResult<Vec<WorkspaceChatMessage>>;
    async fn clear_workspace_chat_messages(&self, session_id: &str) -> AppResult<()>;
    async fn append_workspace_chat_message(
        &self,
        session_id: &str,
        role: WorkspaceChatMessageRole,
        content: String,
        agent_id: Option<&str>,
        visible_to_agent_ids: &[String],
    ) -> AppResult<WorkspaceChatMessage>;
}
