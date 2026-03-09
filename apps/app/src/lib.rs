use girl_ai_agent_app_contracts::{AppBootstrap, RuntimeStatusResponse};
use girl_ai_agent_app_domain::{
    database_url_from_env, connect_runtime, AgentConfig, AppDomainRuntime, AppError, AppResult,
    ChatMessage, ChatSession, ChatWithAgentRequest, ChatWithAgentResponse, ChatWithSessionRequest,
    ChatWithSessionResponse, CreateAgentRequest, CreateModelRequest, CreateProviderRequest,
    CreateWorkspaceChatSessionRequest, ErrorPayload, ModelConfig, ProbeModelConnectionRequest,
    ProbeModelConnectionResponse, ProbeProviderConnectionRequest,
    ProbeProviderConnectionResponse, ProviderConfig, RegenerateChatReplyRequest,
    RewriteChatUserMessageRequest, RewriteLastUserMessageRequest, UndoLastChatTurnRequest,
    UndoLastChatTurnResponse, UpdateAgentRequest, UpdateModelRequest, UpdateProviderRequest,
    UpdateWorkspaceChatSessionRequest, WorkspaceChatMessage, WorkspaceChatSession,
};
use girl_ai_agent_app_host_core::{build_bootstrap, build_runtime_status};
use girl_ai_agent_network_binding::{
    CreateNetworkBindingRequest, NetworkBindingConfig, NetworkBindingManager,
    NetworkBindingRuntimeStatus, NetworkBindingStore, UpdateNetworkBindingRequest,
};
use tauri::State;

type CommandResult<T> = Result<T, ErrorPayload>;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone)]
struct AppState {
    runtime: AppDomainRuntime,
    network_store: NetworkBindingStore,
    network_manager: NetworkBindingManager,
}

fn map_command_result<T>(result: AppResult<T>) -> CommandResult<T> {
    result.map_err(|error| error.payload())
}

#[tauri::command]
fn ping(message: String) -> String {
    format!("Girl-Ai-Agent backend received: {message}")
}

#[tauri::command]
async fn get_bootstrap_data(
    _state: State<'_, AppState>,
) -> CommandResult<AppBootstrap> {
    Ok(build_bootstrap(APP_VERSION))
}

#[tauri::command]
async fn get_runtime_status(state: State<'_, AppState>) -> CommandResult<RuntimeStatusResponse> {
    map_command_result(state.runtime.runtime_stats().await)
        .map(|stats| build_runtime_status(stats, APP_VERSION))
}

#[tauri::command]
async fn list_providers(
    state: State<'_, AppState>,
) -> CommandResult<Vec<ProviderConfig>> {
    map_command_result(state.runtime.list_providers().await)
}

#[tauri::command]
async fn create_provider(
    state: State<'_, AppState>,
    input: CreateProviderRequest,
) -> CommandResult<ProviderConfig> {
    map_command_result(state.runtime.create_provider(input).await)
}

#[tauri::command]
async fn update_provider(
    state: State<'_, AppState>,
    id: String,
    input: UpdateProviderRequest,
) -> CommandResult<ProviderConfig> {
    map_command_result(state.runtime.update_provider(&id, input).await)
}

#[tauri::command]
async fn delete_provider(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    map_command_result(state.runtime.delete_provider(&id).await)
}

#[tauri::command]
async fn probe_provider_connection(
    state: State<'_, AppState>,
    input: ProbeProviderConnectionRequest,
) -> CommandResult<ProbeProviderConnectionResponse> {
    map_command_result(state.runtime.probe_provider_connection(input).await)
}

#[tauri::command]
async fn list_models(
    state: State<'_, AppState>,
) -> CommandResult<Vec<ModelConfig>> {
    map_command_result(state.runtime.list_models().await)
}

#[tauri::command]
async fn create_model(
    state: State<'_, AppState>,
    input: CreateModelRequest,
) -> CommandResult<ModelConfig> {
    map_command_result(state.runtime.create_model(input).await)
}

#[tauri::command]
async fn update_model(
    state: State<'_, AppState>,
    id: String,
    input: UpdateModelRequest,
) -> CommandResult<ModelConfig> {
    map_command_result(state.runtime.update_model(&id, input).await)
}

#[tauri::command]
async fn delete_model(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    map_command_result(state.runtime.delete_model(&id).await)
}

#[tauri::command]
async fn probe_model_connection(
    state: State<'_, AppState>,
    input: ProbeModelConnectionRequest,
) -> CommandResult<ProbeModelConnectionResponse> {
    map_command_result(
        state
            .runtime
            .probe_model_connection(input)
            .await,
    )
}

#[tauri::command]
async fn list_agents(
    state: State<'_, AppState>,
) -> CommandResult<Vec<AgentConfig>> {
    map_command_result(state.runtime.list_agents().await)
}

#[tauri::command]
async fn create_agent(
    state: State<'_, AppState>,
    input: CreateAgentRequest,
) -> CommandResult<AgentConfig> {
    map_command_result(state.runtime.create_agent(input).await)
}

#[tauri::command]
async fn update_agent(
    state: State<'_, AppState>,
    id: String,
    input: UpdateAgentRequest,
) -> CommandResult<AgentConfig> {
    map_command_result(state.runtime.update_agent(&id, input).await)
}

#[tauri::command]
async fn delete_agent(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    if map_command_result(state.network_store.is_agent_in_use(&id).await)? {
        return Err(AppError::reference_in_use(
            "agent is referenced by a network binding",
        )
        .payload());
    }
    map_command_result(state.runtime.delete_agent(&id).await)
}

#[tauri::command]
async fn list_network_bindings(
    state: State<'_, AppState>,
) -> CommandResult<Vec<NetworkBindingConfig>> {
    map_command_result(state.network_store.list_bindings().await)
}

#[tauri::command]
async fn create_network_binding(
    state: State<'_, AppState>,
    input: CreateNetworkBindingRequest,
) -> CommandResult<NetworkBindingConfig> {
    let binding = map_command_result(state.network_store.create_binding(input).await)?;
    if let Err(error) = state.network_manager.sync().await {
        eprintln!("failed to sync network bindings after create: {error}");
    }
    Ok(binding)
}

#[tauri::command]
async fn update_network_binding(
    state: State<'_, AppState>,
    id: String,
    input: UpdateNetworkBindingRequest,
) -> CommandResult<NetworkBindingConfig> {
    let binding = map_command_result(state.network_store.update_binding(&id, input).await)?;
    if let Err(error) = state.network_manager.sync().await {
        eprintln!("failed to sync network bindings after update: {error}");
    }
    Ok(binding)
}

#[tauri::command]
async fn delete_network_binding(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    map_command_result(state.network_store.delete_binding(&id).await)?;
    if let Err(error) = state.network_manager.sync().await {
        eprintln!("failed to sync network bindings after delete: {error}");
    }
    Ok(())
}

#[tauri::command]
async fn list_network_binding_runtime_statuses(
    state: State<'_, AppState>,
) -> CommandResult<Vec<NetworkBindingRuntimeStatus>> {
    map_command_result(state.network_manager.list_runtime_statuses().await)
}

#[tauri::command]
async fn restart_network_binding(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<NetworkBindingRuntimeStatus> {
    map_command_result(state.network_manager.restart_binding(&id).await)
}

#[tauri::command]
async fn list_workspace_chat_sessions(
    state: State<'_, AppState>,
) -> CommandResult<Vec<WorkspaceChatSession>> {
    map_command_result(state.runtime.list_workspace_chat_sessions().await)
}

#[tauri::command]
async fn create_workspace_chat_session(
    state: State<'_, AppState>,
    input: CreateWorkspaceChatSessionRequest,
) -> CommandResult<WorkspaceChatSession> {
    map_command_result(state.runtime.create_workspace_chat_session(input).await)
}

#[tauri::command]
async fn update_workspace_chat_session(
    state: State<'_, AppState>,
    session_id: String,
    input: UpdateWorkspaceChatSessionRequest,
) -> CommandResult<WorkspaceChatSession> {
    map_command_result(
        state
            .runtime
            .update_workspace_chat_session(&session_id, input)
            .await,
    )
}

#[tauri::command]
async fn delete_workspace_chat_session(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<()> {
    map_command_result(state.runtime.delete_workspace_chat_session(&session_id).await)
}

#[tauri::command]
async fn list_workspace_chat_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<Vec<WorkspaceChatMessage>> {
    map_command_result(state.runtime.list_workspace_chat_messages(&session_id).await)
}

#[tauri::command]
async fn clear_workspace_chat_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<()> {
    map_command_result(state.runtime.clear_workspace_chat_messages(&session_id).await)
}

#[tauri::command]
async fn chat_with_session(
    state: State<'_, AppState>,
    input: ChatWithSessionRequest,
) -> CommandResult<ChatWithSessionResponse> {
    map_command_result(
        state
            .runtime
            .chat_with_session(input)
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
            .runtime
            .chat_with_agent(input)
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
            .runtime
            .regenerate_chat_reply(input)
            .await,
    )
}

#[tauri::command]
async fn undo_last_chat_turn(
    state: State<'_, AppState>,
    input: UndoLastChatTurnRequest,
) -> CommandResult<UndoLastChatTurnResponse> {
    map_command_result(state.runtime.undo_last_chat_turn(input).await)
}

#[tauri::command]
async fn rewrite_last_user_message(
    state: State<'_, AppState>,
    input: RewriteLastUserMessageRequest,
) -> CommandResult<ChatWithAgentResponse> {
    map_command_result(
        state
            .runtime
            .rewrite_last_user_message(input)
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
            .runtime
            .rewrite_chat_user_message(input)
            .await,
    )
}

#[tauri::command]
async fn list_agent_chat_messages(
    state: State<'_, AppState>,
    agent_id: String,
) -> CommandResult<Vec<ChatMessage>> {
    map_command_result(state.runtime.list_agent_chat_messages(&agent_id).await)
}

#[tauri::command]
async fn clear_agent_chat_messages(
    state: State<'_, AppState>,
    agent_id: String,
) -> CommandResult<()> {
    map_command_result(state.runtime.clear_agent_chat_messages(&agent_id).await)
}

#[tauri::command]
async fn list_agent_chat_sessions(
    state: State<'_, AppState>,
    agent_id: String,
) -> CommandResult<Vec<ChatSession>> {
    map_command_result(state.runtime.list_agent_chat_sessions(&agent_id).await)
}

#[tauri::command]
async fn create_agent_chat_session(
    state: State<'_, AppState>,
    agent_id: String,
    title: String,
) -> CommandResult<ChatSession> {
    map_command_result(
        state
            .runtime
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
            .runtime
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
            .runtime
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
            .runtime
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
            .runtime
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
            .runtime
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
            .runtime
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
            .runtime
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
            .runtime
            .clear_chat_session_messages(&agent_id, &session_id)
            .await,
    )
}

pub fn run() {
    let database_url = database_url_from_env();
    let runtime = tauri::async_runtime::block_on(connect_runtime(&database_url))
        .expect("failed to initialize app domain runtime");
    let network_store = tauri::async_runtime::block_on(NetworkBindingStore::connect(&database_url))
        .expect("failed to initialize network binding store");
    let network_manager = NetworkBindingManager::new(
        network_store.clone(),
        runtime.clone(),
    );
    tauri::async_runtime::block_on(network_manager.sync())
        .expect("failed to start network bindings");

    tauri::Builder::default()
        .manage(AppState {
            runtime,
            network_store,
            network_manager,
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
            list_network_bindings,
            create_network_binding,
            update_network_binding,
            delete_network_binding,
            list_network_binding_runtime_statuses,
            restart_network_binding,
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



