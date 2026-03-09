use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPreset {
    pub id: String,
    pub name: String,
    pub api_base: String,
    pub supports_multi_key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBootstrap {
    pub app_name: String,
    pub app_version: String,
    pub api_version: String,
    pub provider_presets: Vec<ProviderPreset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatusResponse {
    pub app_name: String,
    pub app_version: String,
    pub api_version: String,
    pub chat_gateway_kind: String,
    pub provider_count: i64,
    pub model_count: i64,
    pub agent_count: i64,
    pub session_count: i64,
    pub message_count: i64,
}
