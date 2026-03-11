use serde::{Deserialize, Serialize};

use crate::types::{
    AgentMode, AgentParamSlots, ComponentSlot, CustomProvider, DecisionSlot, ModelCapabilities,
    ModelCategory, ModelParams, ToolSlot, WorkspaceChatParticipant, WorkspaceChatReply,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProviderRequest {
    pub display_name: String,
    pub provider_kind: String,
    pub api_base: String,
    pub keys: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProviderRequest {
    pub display_name: String,
    pub provider_kind: String,
    pub api_base: String,
    pub keys: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateModelRequest {
    pub name: String,
    pub provider_ref: Option<String>,
    pub custom_provider: Option<CustomProvider>,
    pub model_id: String,
    pub category: ModelCategory,
    #[serde(default)]
    pub categories: Vec<ModelCategory>,
    #[serde(default)]
    pub capabilities: ModelCapabilities,
    #[serde(default)]
    pub params: ModelParams,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModelRequest {
    pub name: String,
    pub provider_ref: Option<String>,
    pub custom_provider: Option<CustomProvider>,
    pub model_id: String,
    pub category: ModelCategory,
    #[serde(default)]
    pub categories: Vec<ModelCategory>,
    #[serde(default)]
    pub capabilities: ModelCapabilities,
    #[serde(default)]
    pub params: ModelParams,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRequest {
    pub name: String,
    pub persona: String,
    pub speech_rules: String,
    pub mode: AgentMode,
    #[serde(default)]
    pub component_slot: ComponentSlot,
    #[serde(default)]
    pub tool_slot: ToolSlot,
    pub reply_model_id: String,
    #[serde(default)]
    pub decision_slot: DecisionSlot,
    #[serde(default)]
    pub param_slots: AgentParamSlots,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentRequest {
    pub name: String,
    pub persona: String,
    pub speech_rules: String,
    pub mode: AgentMode,
    #[serde(default)]
    pub component_slot: ComponentSlot,
    #[serde(default)]
    pub tool_slot: ToolSlot,
    pub reply_model_id: String,
    #[serde(default)]
    pub decision_slot: DecisionSlot,
    #[serde(default)]
    pub param_slots: AgentParamSlots,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChatMessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: ChatMessageRole,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatWithAgentRequest {
    pub agent_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub user_message: String,
    #[serde(default)]
    pub history: Vec<ChatMessage>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i32>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegenerateChatReplyRequest {
    pub agent_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub replace_last_assistant: bool,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i32>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoLastChatTurnRequest {
    pub agent_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteLastUserMessageRequest {
    pub agent_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub user_message: String,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i32>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteChatUserMessageRequest {
    pub agent_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub target_user_offset: i32,
    pub user_message: String,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i32>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatWithAgentResponse {
    pub agent_id: String,
    pub session_id: String,
    pub model_ref_id: String,
    pub model_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoLastChatTurnResponse {
    pub agent_id: String,
    pub session_id: String,
    pub removed_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatSessionRequest {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameChatSessionRequest {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateChatSessionRequest {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetChatSessionPinnedRequest {
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetChatSessionArchivedRequest {
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetChatSessionTagsRequest {
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStats {
    pub provider_count: i64,
    pub model_count: i64,
    pub agent_count: i64,
    pub session_count: i64,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceChatSessionRequest {
    pub title: String,
    #[serde(default)]
    pub participants: Vec<WorkspaceChatParticipant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkspaceChatSessionRequest {
    pub title: String,
    #[serde(default)]
    pub participants: Vec<WorkspaceChatParticipant>,
    pub is_pinned: bool,
    pub is_archived: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatWithSessionRequest {
    pub session_id: String,
    pub user_message: String,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i32>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatWithSessionResponse {
    pub session_id: String,
    #[serde(default)]
    pub replies: Vec<WorkspaceChatReply>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeProviderConnectionRequest {
    pub provider_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeProviderConnectionResponse {
    pub provider_id: String,
    pub reachable: bool,
    pub latency_ms: i64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeModelConnectionRequest {
    pub model_ref_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeModelConnectionResponse {
    pub model_ref_id: String,
    pub model_id: String,
    pub reachable: bool,
    pub latency_ms: i64,
    pub detail: String,
}
