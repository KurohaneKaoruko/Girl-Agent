use std::sync::Arc;

use girlagent_core::{
    AppService, AppResult, CreateAgentRequest, CreateModelRequest, CreateProviderRequest,
    ErrorPayload, SqliteStore, UpdateAgentRequest, UpdateModelRequest, UpdateProviderRequest,
};
use tauri::State;

type CommandResult<T> = Result<T, ErrorPayload>;

#[derive(Clone)]
struct AppState {
    service: AppService<SqliteStore>,
}

fn map_command_result<T>(result: AppResult<T>) -> CommandResult<T> {
    result.map_err(|error| error.payload())
}

fn database_url() -> String {
    std::env::var("GIRLAGENT_DB_URL").unwrap_or_else(|_| "sqlite://girlagent.db".to_string())
}

#[tauri::command]
fn ping(message: String) -> String {
    format!("少女智能体 backend received: {message}")
}

#[tauri::command]
async fn get_bootstrap_data(state: State<'_, AppState>) -> CommandResult<girlagent_core::BootstrapResponse> {
    map_command_result(state.service.bootstrap().await)
}

#[tauri::command]
async fn list_providers(state: State<'_, AppState>) -> CommandResult<Vec<girlagent_core::ProviderConfig>> {
    map_command_result(state.service.list_providers().await)
}

#[tauri::command]
async fn create_provider(
    state: State<'_, AppState>,
    input: CreateProviderRequest,
) -> CommandResult<girlagent_core::ProviderConfig> {
    map_command_result(state.service.create_provider(input).await)
}

#[tauri::command]
async fn update_provider(
    state: State<'_, AppState>,
    id: String,
    input: UpdateProviderRequest,
) -> CommandResult<girlagent_core::ProviderConfig> {
    map_command_result(state.service.update_provider(&id, input).await)
}

#[tauri::command]
async fn delete_provider(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    map_command_result(state.service.delete_provider(&id).await)
}

#[tauri::command]
async fn list_models(state: State<'_, AppState>) -> CommandResult<Vec<girlagent_core::ModelConfig>> {
    map_command_result(state.service.list_models().await)
}

#[tauri::command]
async fn create_model(
    state: State<'_, AppState>,
    input: CreateModelRequest,
) -> CommandResult<girlagent_core::ModelConfig> {
    map_command_result(state.service.create_model(input).await)
}

#[tauri::command]
async fn update_model(
    state: State<'_, AppState>,
    id: String,
    input: UpdateModelRequest,
) -> CommandResult<girlagent_core::ModelConfig> {
    map_command_result(state.service.update_model(&id, input).await)
}

#[tauri::command]
async fn delete_model(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    map_command_result(state.service.delete_model(&id).await)
}

#[tauri::command]
async fn list_agents(state: State<'_, AppState>) -> CommandResult<Vec<girlagent_core::AgentConfig>> {
    map_command_result(state.service.list_agents().await)
}

#[tauri::command]
async fn create_agent(
    state: State<'_, AppState>,
    input: CreateAgentRequest,
) -> CommandResult<girlagent_core::AgentConfig> {
    map_command_result(state.service.create_agent(input).await)
}

#[tauri::command]
async fn update_agent(
    state: State<'_, AppState>,
    id: String,
    input: UpdateAgentRequest,
) -> CommandResult<girlagent_core::AgentConfig> {
    map_command_result(state.service.update_agent(&id, input).await)
}

#[tauri::command]
async fn delete_agent(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    map_command_result(state.service.delete_agent(&id).await)
}

pub fn run() {
    let store = tauri::async_runtime::block_on(SqliteStore::connect(&database_url()))
        .expect("failed to initialize sqlite store");
    let service = AppService::new(Arc::new(store), "少女智能体", "0.1.0");

    tauri::Builder::default()
        .manage(AppState { service })
        .invoke_handler(tauri::generate_handler![
            ping,
            get_bootstrap_data,
            list_providers,
            create_provider,
            update_provider,
            delete_provider,
            list_models,
            create_model,
            update_model,
            delete_model,
            list_agents,
            create_agent,
            update_agent,
            delete_agent
        ])
        .run(tauri::generate_context!())
        .expect("failed to run GirlAgent");
}
