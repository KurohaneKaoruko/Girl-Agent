use girl_ai_agent_app_domain::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum NetworkTransportKind {
    HttpServer,
    HttpClient,
    WebSocketServer,
    WebSocketClient,
}

impl NetworkTransportKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::HttpServer => "http_server",
            Self::HttpClient => "http_client",
            Self::WebSocketServer => "websocket_server",
            Self::WebSocketClient => "websocket_client",
        }
    }

    pub fn from_str(value: &str) -> AppResult<Self> {
        match value {
            "http_server" => Ok(Self::HttpServer),
            "http_client" => Ok(Self::HttpClient),
            "websocket_server" => Ok(Self::WebSocketServer),
            "websocket_client" => Ok(Self::WebSocketClient),
            _ => Err(AppError::validation(format!(
                "invalid transportKind: {value}"
            ))),
        }
    }

    pub fn is_server(self) -> bool {
        matches!(self, Self::HttpServer | Self::WebSocketServer)
    }

    pub fn is_client(self) -> bool {
        matches!(self, Self::HttpClient | Self::WebSocketClient)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum NetworkSessionMode {
    Shared,
    ExternalSession,
}

impl NetworkSessionMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shared => "shared",
            Self::ExternalSession => "external_session",
        }
    }

    pub fn from_str(value: &str) -> AppResult<Self> {
        match value {
            "shared" => Ok(Self::Shared),
            "external_session" => Ok(Self::ExternalSession),
            _ => Err(AppError::validation(format!(
                "invalid sessionMode: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkBindingConfig {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub transport_kind: NetworkTransportKind,
    pub bind_host: Option<String>,
    pub bind_port: Option<u16>,
    pub target_url: Option<String>,
    pub agent_id: String,
    pub session_mode: NetworkSessionMode,
    #[serde(default)]
    pub metadata: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNetworkBindingRequest {
    pub name: String,
    pub enabled: bool,
    pub transport_kind: NetworkTransportKind,
    pub bind_host: Option<String>,
    pub bind_port: Option<u16>,
    pub target_url: Option<String>,
    pub agent_id: String,
    pub session_mode: NetworkSessionMode,
    #[serde(default = "default_metadata")]
    pub metadata: Value,
}

pub type UpdateNetworkBindingRequest = CreateNetworkBindingRequest;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkBindingRuntimeState {
    Stopped,
    Starting,
    Connecting,
    Running,
    Error,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkBindingRuntimeStatus {
    pub binding_id: String,
    pub name: String,
    pub enabled: bool,
    pub transport_kind: NetworkTransportKind,
    pub agent_id: String,
    pub state: NetworkBindingRuntimeState,
    pub running: bool,
    pub detail: String,
    pub last_error: Option<String>,
    pub last_activity_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpenRequest {
    pub request_id: String,
    pub external_session_id: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCloseRequest {
    pub request_id: String,
    pub external_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageCreateRequest {
    pub request_id: String,
    pub external_session_id: Option<String>,
    pub input: String,
    pub system: Option<String>,
    #[serde(default = "default_metadata")]
    pub context: Value,
    #[serde(default = "default_metadata")]
    pub metadata: Value,
    #[serde(default)]
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpenedEvent {
    pub request_id: String,
    pub external_session_id: String,
    pub internal_session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionClosedEvent {
    pub request_id: String,
    pub external_session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageChunkEvent {
    pub request_id: String,
    pub external_session_id: String,
    pub chunk: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageCompletedEvent {
    pub request_id: String,
    pub external_session_id: String,
    pub internal_session_id: String,
    pub model_ref_id: String,
    pub model_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingErrorEvent {
    pub request_id: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BindingClientRequest {
    SessionOpen(SessionOpenRequest),
    SessionClose(SessionCloseRequest),
    MessageCreate(MessageCreateRequest),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BindingServerEvent {
    SessionOpened(SessionOpenedEvent),
    SessionClosed(SessionClosedEvent),
    MessageChunk(MessageChunkEvent),
    MessageCompleted(MessageCompletedEvent),
    Error(BindingErrorEvent),
}

pub fn default_metadata() -> Value {
    Value::Object(Default::default())
}
