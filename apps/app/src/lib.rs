use std::sync::Arc;

use girl_ai_agent_core::{
    AppResult, AppService, ChatMessage, ChatSession, ChatWithAgentRequest, ChatWithAgentResponse,
    ChatWithSessionRequest, ChatWithSessionResponse, CreateAgentRequest, CreateModelRequest,
    CreateProviderRequest, CreateWorkspaceChatSessionRequest, ErrorPayload,
    OpenAICompatChatGateway, ProbeModelConnectionRequest, ProbeModelConnectionResponse,
    ProbeProviderConnectionRequest, ProbeProviderConnectionResponse, RegenerateChatReplyRequest,
    RewriteChatUserMessageRequest, RewriteLastUserMessageRequest, SqliteStore,
    UndoLastChatTurnRequest, UndoLastChatTurnResponse, UpdateAgentRequest, UpdateModelRequest,
    UpdateProviderRequest, UpdateWorkspaceChatSessionRequest,
    WorkspaceChatMessage, WorkspaceChatSession,
};
use serde::Serialize;
use tauri::State;

type CommandResult<T> = Result<T, ErrorPayload>;

const APP_NAME: &str = "Girl-Ai-Agent";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const API_VERSION: &str = "1.0.0";
const CHAT_GATEWAY_KIND: &str = "openai_compat";

#[derive(Clone)]
struct AppState {
    service: AppService<SqliteStore>,
    chat_gateway: OpenAICompatChatGateway,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderPreset {
    id: &'static str,
    name: &'static str,
    api_base: &'static str,
    supports_multi_key: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppBootstrap {
    app_name: &'static str,
    app_version: &'static str,
    api_version: &'static str,
    provider_presets: Vec<ProviderPreset>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatusResponse {
    app_name: &'static str,
    app_version: &'static str,
    api_version: &'static str,
    chat_gateway_kind: &'static str,
    provider_count: i64,
    model_count: i64,
    agent_count: i64,
    session_count: i64,
    message_count: i64,
}

fn map_command_result<T>(result: AppResult<T>) -> CommandResult<T> {
    result.map_err(|error| error.payload())
}

fn database_url() -> String {
    std::env::var("GIRL_AI_AGENT_DB_URL").unwrap_or_else(|_| "sqlite://girl-ai-agent.db".to_string())
}

fn provider_presets() -> Vec<ProviderPreset> {
    vec![
        ProviderPreset {
            id: "openai",
            name: "OpenAI",
            api_base: "https://api.openai.com/v1",
            supports_multi_key: true,
        },
        ProviderPreset {
            id: "anthropic",
            name: "Anthropic",
            api_base: "https://api.anthropic.com/v1",
            supports_multi_key: true,
        },
        ProviderPreset {
            id: "openrouter",
            name: "OpenRouter",
            api_base: "https://openrouter.ai/api/v1",
            supports_multi_key: true,
        },
        ProviderPreset {
            id: "google",
            name: "Google Gemini",
            api_base: "https://generativelanguage.googleapis.com/v1beta",
            supports_multi_key: false,
        },
        ProviderPreset {
            id: "ollama",
            name: "Ollama (Local)",
            api_base: "http://127.0.0.1:11434/v1",
            supports_multi_key: false,
        },
        ProviderPreset {
            id: "lmstudio",
            name: "LM Studio (Local)",
            api_base: "http://127.0.0.1:1234/v1",
            supports_multi_key: false,
        },
    ]
}

fn build_bootstrap() -> AppBootstrap {
    AppBootstrap {
        app_name: APP_NAME,
        app_version: APP_VERSION,
        api_version: API_VERSION,
        provider_presets: provider_presets(),
    }
}

fn build_runtime_status(stats: girl_ai_agent_core::RuntimeStats) -> RuntimeStatusResponse {
    RuntimeStatusResponse {
        app_name: APP_NAME,
        app_version: APP_VERSION,
        api_version: API_VERSION,
        chat_gateway_kind: CHAT_GATEWAY_KIND,
        provider_count: stats.provider_count,
        model_count: stats.model_count,
        agent_count: stats.agent_count,
        session_count: stats.session_count,
        message_count: stats.message_count,
    }
}

#[tauri::command]
fn ping(message: String) -> String {
    format!("Girl-Ai-Agent backend received: {message}")
}

#[tauri::command]
async fn get_bootstrap_data(
    _state: State<'_, AppState>,
) -> CommandResult<AppBootstrap> {
    Ok(build_bootstrap())
}

#[tauri::command]
async fn get_runtime_status(state: State<'_, AppState>) -> CommandResult<RuntimeStatusResponse> {
    map_command_result(state.service.runtime_stats().await).map(build_runtime_status)
}

#[tauri::command]
async fn list_providers(
    state: State<'_, AppState>,
) -> CommandResult<Vec<girl_ai_agent_core::ProviderConfig>> {
    map_command_result(state.service.list_providers().await)
}

#[tauri::command]
async fn create_provider(
    state: State<'_, AppState>,
    input: CreateProviderRequest,
) -> CommandResult<girl_ai_agent_core::ProviderConfig> {
    map_command_result(state.service.create_provider(input).await)
}

#[tauri::command]
async fn update_provider(
    state: State<'_, AppState>,
    id: String,
    input: UpdateProviderRequest,
) -> CommandResult<girl_ai_agent_core::ProviderConfig> {
    map_command_result(state.service.update_provider(&id, input).await)
}

#[tauri::command]
async fn delete_provider(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    map_command_result(state.service.delete_provider(&id).await)
}

#[tauri::command]
async fn probe_provider_connection(
    state: State<'_, AppState>,
    input: ProbeProviderConnectionRequest,
) -> CommandResult<ProbeProviderConnectionResponse> {
    map_command_result(state.service.probe_provider_connection(input).await)
}

#[tauri::command]
async fn list_models(
    state: State<'_, AppState>,
) -> CommandResult<Vec<girl_ai_agent_core::ModelConfig>> {
    map_command_result(state.service.list_models().await)
}

#[tauri::command]
async fn create_model(
    state: State<'_, AppState>,
    input: CreateModelRequest,
) -> CommandResult<girl_ai_agent_core::ModelConfig> {
    map_command_result(state.service.create_model(input).await)
}

#[tauri::command]
async fn update_model(
    state: State<'_, AppState>,
    id: String,
    input: UpdateModelRequest,
) -> CommandResult<girl_ai_agent_core::ModelConfig> {
    map_command_result(state.service.update_model(&id, input).await)
}

#[tauri::command]
async fn delete_model(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    map_command_result(state.service.delete_model(&id).await)
}

#[tauri::command]
async fn probe_model_connection(
    state: State<'_, AppState>,
    input: ProbeModelConnectionRequest,
) -> CommandResult<ProbeModelConnectionResponse> {
    map_command_result(
        state
            .service
            .probe_model_connection(&state.chat_gateway, input)
            .await,
    )
}

#[tauri::command]
async fn list_agents(
    state: State<'_, AppState>,
) -> CommandResult<Vec<girl_ai_agent_core::AgentConfig>> {
    map_command_result(state.service.list_agents().await)
}

#[tauri::command]
async fn create_agent(
    state: State<'_, AppState>,
    input: CreateAgentRequest,
) -> CommandResult<girl_ai_agent_core::AgentConfig> {
    map_command_result(state.service.create_agent(input).await)
}

#[tauri::command]
async fn update_agent(
    state: State<'_, AppState>,
    id: String,
    input: UpdateAgentRequest,
) -> CommandResult<girl_ai_agent_core::AgentConfig> {
    map_command_result(state.service.update_agent(&id, input).await)
}

#[tauri::command]
async fn delete_agent(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    map_command_result(state.service.delete_agent(&id).await)
}

#[tauri::command]
async fn list_workspace_chat_sessions(
    state: State<'_, AppState>,
) -> CommandResult<Vec<WorkspaceChatSession>> {
    map_command_result(state.service.list_workspace_chat_sessions().await)
}

#[tauri::command]
async fn create_workspace_chat_session(
    state: State<'_, AppState>,
    input: CreateWorkspaceChatSessionRequest,
) -> CommandResult<WorkspaceChatSession> {
    map_command_result(state.service.create_workspace_chat_session(input).await)
}

#[tauri::command]
async fn update_workspace_chat_session(
    state: State<'_, AppState>,
    session_id: String,
    input: UpdateWorkspaceChatSessionRequest,
) -> CommandResult<WorkspaceChatSession> {
    map_command_result(
        state
            .service
            .update_workspace_chat_session(&session_id, input)
            .await,
    )
}

#[tauri::command]
async fn delete_workspace_chat_session(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<()> {
    map_command_result(state.service.delete_workspace_chat_session(&session_id).await)
}

#[tauri::command]
async fn list_workspace_chat_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<Vec<WorkspaceChatMessage>> {
    map_command_result(state.service.list_workspace_chat_messages(&session_id).await)
}

#[tauri::command]
async fn clear_workspace_chat_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<()> {
    map_command_result(state.service.clear_workspace_chat_messages(&session_id).await)
}

#[tauri::command]
async fn chat_with_session(
    state: State<'_, AppState>,
    input: ChatWithSessionRequest,
) -> CommandResult<ChatWithSessionResponse> {
    map_command_result(
        state
            .service
            .chat_with_session(&state.chat_gateway, input)
            .await,
    )
}

#[tauri::command]
async fn chat_with_agent(
    state: State<'_, AppState>,
    input: ChatWithAgentRequest,
) -> CommandResult<ChatWithAgentResponse> {
    map_command_result(
        state
            .service
            .chat_with_agent(&state.chat_gateway, input)
            .await,
    )
}

#[tauri::command]
async fn regenerate_chat_reply(
    state: State<'_, AppState>,
    input: RegenerateChatReplyRequest,
) -> CommandResult<ChatWithAgentResponse> {
    map_command_result(
        state
            .service
            .regenerate_chat_reply(&state.chat_gateway, input)
            .await,
    )
}

#[tauri::command]
async fn undo_last_chat_turn(
    state: State<'_, AppState>,
    input: UndoLastChatTurnRequest,
) -> CommandResult<UndoLastChatTurnResponse> {
    map_command_result(state.service.undo_last_chat_turn(input).await)
}

#[tauri::command]
async fn rewrite_last_user_message(
    state: State<'_, AppState>,
    input: RewriteLastUserMessageRequest,
) -> CommandResult<ChatWithAgentResponse> {
    map_command_result(
        state
            .service
            .rewrite_last_user_message(&state.chat_gateway, input)
            .await,
    )
}

#[tauri::command]
async fn rewrite_chat_user_message(
    state: State<'_, AppState>,
    input: RewriteChatUserMessageRequest,
) -> CommandResult<ChatWithAgentResponse> {
    map_command_result(
        state
            .service
            .rewrite_chat_user_message(&state.chat_gateway, input)
            .await,
    )
}

#[tauri::command]
async fn list_agent_chat_messages(
    state: State<'_, AppState>,
    agent_id: String,
) -> CommandResult<Vec<ChatMessage>> {
    map_command_result(state.service.list_agent_chat_messages(&agent_id).await)
}

#[tauri::command]
async fn clear_agent_chat_messages(
    state: State<'_, AppState>,
    agent_id: String,
) -> CommandResult<()> {
    map_command_result(state.service.clear_agent_chat_messages(&agent_id).await)
}

#[tauri::command]
async fn list_agent_chat_sessions(
    state: State<'_, AppState>,
    agent_id: String,
) -> CommandResult<Vec<ChatSession>> {
    map_command_result(state.service.list_agent_chat_sessions(&agent_id).await)
}

#[tauri::command]
async fn create_agent_chat_session(
    state: State<'_, AppState>,
    agent_id: String,
    title: String,
) -> CommandResult<ChatSession> {
    map_command_result(
        state
            .service
            .create_agent_chat_session(&agent_id, &title)
            .await,
    )
}

#[tauri::command]
async fn rename_agent_chat_session(
    state: State<'_, AppState>,
    agent_id: String,
    session_id: String,
    title: String,
) -> CommandResult<ChatSession> {
    map_command_result(
        state
            .service
            .rename_agent_chat_session(&agent_id, &session_id, &title)
            .await,
    )
}

#[tauri::command]
async fn duplicate_agent_chat_session(
    state: State<'_, AppState>,
    agent_id: String,
    source_session_id: String,
    title: String,
) -> CommandResult<ChatSession> {
    map_command_result(
        state
            .service
            .duplicate_agent_chat_session(&agent_id, &source_session_id, &title)
            .await,
    )
}

#[tauri::command]
async fn set_agent_chat_session_pinned(
    state: State<'_, AppState>,
    agent_id: String,
    session_id: String,
    pinned: bool,
) -> CommandResult<ChatSession> {
    map_command_result(
        state
            .service
            .set_agent_chat_session_pinned(&agent_id, &session_id, pinned)
            .await,
    )
}

#[tauri::command]
async fn set_agent_chat_session_archived(
    state: State<'_, AppState>,
    agent_id: String,
    session_id: String,
    archived: bool,
) -> CommandResult<ChatSession> {
    map_command_result(
        state
            .service
            .set_agent_chat_session_archived(&agent_id, &session_id, archived)
            .await,
    )
}

#[tauri::command]
async fn set_agent_chat_session_tags(
    state: State<'_, AppState>,
    agent_id: String,
    session_id: String,
    tags: Vec<String>,
) -> CommandResult<ChatSession> {
    map_command_result(
        state
            .service
            .set_agent_chat_session_tags(&agent_id, &session_id, &tags)
            .await,
    )
}

#[tauri::command]
async fn delete_agent_chat_session(
    state: State<'_, AppState>,
    agent_id: String,
    session_id: String,
) -> CommandResult<()> {
    map_command_result(
        state
            .service
            .delete_agent_chat_session(&agent_id, &session_id)
            .await,
    )
}

#[tauri::command]
async fn list_chat_session_messages(
    state: State<'_, AppState>,
    agent_id: String,
    session_id: String,
) -> CommandResult<Vec<ChatMessage>> {
    map_command_result(
        state
            .service
            .list_chat_session_messages(&agent_id, &session_id)
            .await,
    )
}

#[tauri::command]
async fn clear_chat_session_messages(
    state: State<'_, AppState>,
    agent_id: String,
    session_id: String,
) -> CommandResult<()> {
    map_command_result(
        state
            .service
            .clear_chat_session_messages(&agent_id, &session_id)
            .await,
    )
}

pub fn run() {
    let store = tauri::async_runtime::block_on(SqliteStore::connect(&database_url()))
        .expect("failed to initialize sqlite store");
    let service = AppService::new(Arc::new(store));

    tauri::Builder::default()
        .manage(AppState {
            service,
            chat_gateway: OpenAICompatChatGateway::new(),
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            get_bootstrap_data,
            get_runtime_status,
            list_providers,
            create_provider,
            update_provider,
            delete_provider,
            probe_provider_connection,
            list_models,
            create_model,
            update_model,
            delete_model,
            probe_model_connection,
            list_agents,
            create_agent,
            update_agent,
            delete_agent,
            list_workspace_chat_sessions,
            create_workspace_chat_session,
            update_workspace_chat_session,
            delete_workspace_chat_session,
            list_workspace_chat_messages,
            clear_workspace_chat_messages,
            chat_with_session,
            chat_with_agent,
            regenerate_chat_reply,
            undo_last_chat_turn,
            rewrite_last_user_message,
            rewrite_chat_user_message,
            list_agent_chat_messages,
            clear_agent_chat_messages,
            list_agent_chat_sessions,
            create_agent_chat_session,
            rename_agent_chat_session,
            duplicate_agent_chat_session,
            set_agent_chat_session_pinned,
            set_agent_chat_session_archived,
            set_agent_chat_session_tags,
            delete_agent_chat_session,
            list_chat_session_messages,
            clear_chat_session_messages
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Girl-Ai-Agent");
}

