use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub display_name: String,
    pub provider_kind: String,
    pub api_base: String,
    pub keys: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ModelCategory {
    Llm,
    Vlm,
    Asr,
    Tts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    pub input_modes: Vec<String>,
    pub output_modes: Vec<String>,
    pub supports_function_call: bool,
    pub supports_streaming: bool,
    pub max_context_window: Option<i32>,
}

impl Default for ModelCapabilities {
    fn default() -> Self {
        Self {
            input_modes: vec!["text".to_string()],
            output_modes: vec!["text".to_string()],
            supports_function_call: false,
            supports_streaming: true,
            max_context_window: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelParams {
    pub temperature: f64,
    pub max_tokens: i32,
    pub top_p: f64,
    pub frequency_penalty: f64,
}

impl Default for ModelParams {
    fn default() -> Self {
        Self {
            temperature: 0.8,
            max_tokens: 2048,
            top_p: 1.0,
            frequency_penalty: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProvider {
    pub api_base: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub id: String,
    pub name: String,
    pub provider_ref: Option<String>,
    pub custom_provider: Option<CustomProvider>,
    pub model_id: String,
    pub category: ModelCategory,
    #[serde(default)]
    pub categories: Vec<ModelCategory>,
    pub capabilities: ModelCapabilities,
    pub params: ModelParams,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentMode {
    Chat,
    Ambient,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComponentSlot {
    pub asr_model_id: Option<String>,
    pub tts_model_id: Option<String>,
    pub vision_model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolSlot {
    pub planner_model_id: Option<String>,
    pub executor_model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplySlot {
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionSlot {
    pub model_id: Option<String>,
    pub enabled: bool,
}

impl Default for DecisionSlot {
    fn default() -> Self {
        Self {
            model_id: None,
            enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlotParams {
    pub temperature: Option<f64>,
    pub max_tokens: Option<i32>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComponentParamSlot {
    pub asr: SlotParams,
    pub tts: SlotParams,
    pub vision: SlotParams,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolParamSlot {
    pub planner: SlotParams,
    pub executor: SlotParams,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentParamSlots {
    pub component: ComponentParamSlot,
    pub tool: ToolParamSlot,
    pub reply: SlotParams,
    pub decision: SlotParams,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelSlots {
    pub component: ComponentSlot,
    pub tool: ToolSlot,
    pub reply: ReplySlot,
    pub decision: DecisionSlot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub persona: String,
    pub speech_rules: String,
    pub mode: AgentMode,
    pub model_slots: AgentModelSlots,
    pub param_slots: AgentParamSlots,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub is_default: bool,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: i64,
    pub last_message_role: Option<String>,
    pub last_message_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceChatParticipantMode {
    All,
    Mention,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceChatMessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChatParticipant {
    pub agent_id: String,
    pub receive_mode: WorkspaceChatParticipantMode,
    pub reply_mode: WorkspaceChatParticipantMode,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChatSession {
    pub id: String,
    pub title: String,
    pub participants: Vec<WorkspaceChatParticipant>,
    pub is_group: bool,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: i64,
    pub last_message_role: Option<String>,
    pub last_message_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChatMessage {
    pub role: WorkspaceChatMessageRole,
    pub content: String,
    pub agent_id: Option<String>,
    pub visible_to_agent_ids: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChatReply {
    pub agent_id: String,
    pub agent_name: String,
    pub model_ref_id: String,
    pub model_id: String,
    pub message: String,
}
