use std::{convert::Infallible, time::Duration};

use async_stream::stream;
use axum::{
    extract::{Path, State},
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::{sse::{Event, KeepAlive, Sse}, Response},
    routing::{get, post, put},
    Json, Router,
};
use girl_ai_agent_app_contracts::{AppBootstrap, RuntimeStatusResponse};
use girl_ai_agent_app_domain::{
    database_url_from_env, connect_runtime, AgentConfig, AppDomainRuntime, AppError, ChatMessage,
    ChatSession,
    ChatWithAgentRequest, ChatWithAgentResponse, ChatWithSessionRequest, ChatWithSessionResponse,
    CreateAgentRequest, CreateChatSessionRequest, CreateModelRequest, CreateProviderRequest,
    CreateWorkspaceChatSessionRequest, DuplicateChatSessionRequest, ErrorPayload, ModelConfig,
    ProbeModelConnectionRequest, ProbeModelConnectionResponse, ProbeProviderConnectionRequest,
    ProbeProviderConnectionResponse, ProviderConfig,
    RegenerateChatReplyRequest, RenameChatSessionRequest, RewriteChatUserMessageRequest,
    RewriteLastUserMessageRequest, SetChatSessionArchivedRequest, SetChatSessionPinnedRequest,
    SetChatSessionTagsRequest, UndoLastChatTurnRequest, UndoLastChatTurnResponse,
    UpdateAgentRequest, UpdateModelRequest, UpdateProviderRequest,
    UpdateWorkspaceChatSessionRequest, WorkspaceChatMessage, WorkspaceChatSession,
};
use girl_ai_agent_app_host_core::{build_bootstrap, build_runtime_status};
use girl_ai_agent_network_binding::{
    CreateNetworkBindingRequest, NetworkBindingConfig, NetworkBindingManager,
    NetworkBindingRuntimeStatus, NetworkBindingStore, UpdateNetworkBindingRequest,
};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone)]
struct AppState {
    runtime: AppDomainRuntime,
    bearer_token: String,
    network_store: NetworkBindingStore,
    network_manager: NetworkBindingManager,
}

type ApiResponse<T> = Result<Json<T>, (StatusCode, Json<ErrorPayload>)>;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSessionIdPayload {
    session_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateWorkspaceSessionPayload {
    session_id: String,
    input: UpdateWorkspaceChatSessionRequest,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceIdPayload {
    id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProviderPayload {
    id: String,
    input: UpdateProviderRequest,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateModelPayload {
    id: String,
    input: UpdateModelRequest,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAgentPayload {
    id: String,
    input: UpdateAgentRequest,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_url = database_url_from_env();
    let bind_addr =
        std::env::var("GIRL_AI_AGENT_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
    let token = std::env::var("GIRL_AI_AGENT_TOKEN").unwrap_or_else(|_| {
        let generated = Uuid::new_v4().to_string();
        eprintln!("GIRL_AI_AGENT_TOKEN not set, generated one-time token: {generated}");
        generated
    });

    let runtime = connect_runtime(&db_url).await?;
    let network_store = NetworkBindingStore::connect(&db_url).await?;
    let network_manager =
        NetworkBindingManager::new(network_store.clone(), runtime.clone());
    network_manager.sync().await?;
    let state = AppState {
        runtime,
        bearer_token: token,
        network_store,
        network_manager,
    };

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    println!("Girl-Ai-Agent headless listening at http://{bind_addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

fn build_router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/api/bootstrap", get(get_bootstrap))
        .route("/api/runtime/status", get(get_runtime_status))
        .route("/api/runtime/provider-probe", post(probe_provider_connection))
        .route("/api/runtime/model-probe", post(probe_model_connection))
        .route("/api/providers", get(list_providers).post(create_provider))
        .route(
            "/api/providers/{id}",
            put(update_provider).delete(delete_provider),
        )
        .route("/api/providers/update", post(update_provider_by_body))
        .route("/api/providers/delete", post(delete_provider_by_body))
        .route("/api/models", get(list_models).post(create_model))
        .route("/api/models/{id}", put(update_model).delete(delete_model))
        .route("/api/models/update", post(update_model_by_body))
        .route("/api/models/delete", post(delete_model_by_body))
        .route("/api/agents", get(list_agents).post(create_agent))
        .route("/api/agents/{id}", put(update_agent).delete(delete_agent))
        .route("/api/agents/update", post(update_agent_by_body))
        .route("/api/agents/delete", post(delete_agent_by_body))
        .route(
            "/api/network-bindings",
            get(list_network_bindings).post(create_network_binding),
        )
        .route(
            "/api/network-bindings/{id}",
            put(update_network_binding).delete(delete_network_binding),
        )
        .route(
            "/api/runtime/network-bindings",
            get(list_network_binding_runtime_statuses),
        )
        .route(
            "/api/runtime/network-bindings/{id}/restart",
            post(restart_network_binding),
        )
        .route(
            "/api/workspace/sessions",
            get(list_workspace_chat_sessions).post(create_workspace_chat_session),
        )
        .route(
            "/api/workspace/sessions/{session_id}",
            put(update_workspace_chat_session).delete(delete_workspace_chat_session),
        )
        .route(
            "/api/workspace/session/{session_id}",
            put(update_workspace_chat_session).delete(delete_workspace_chat_session),
        )
        .route(
            "/api/workspace/sessions/{session_id}/messages",
            get(list_workspace_chat_messages).delete(clear_workspace_chat_messages),
        )
        .route(
            "/api/workspace/messages/{session_id}",
            get(list_workspace_chat_messages).delete(clear_workspace_chat_messages),
        )
        .route("/api/workspace/chat", post(chat_with_session))
        .route("/api/workspace/chat/stream", post(chat_with_session_stream))
        .route(
            "/api/workspace/messages/list",
            post(list_workspace_chat_messages_by_body),
        )
        .route(
            "/api/workspace/messages/clear",
            post(clear_workspace_chat_messages_by_body),
        )
        .route(
            "/api/workspace/session/update",
            post(update_workspace_chat_session_by_body),
        )
        .route(
            "/api/workspace/session/delete",
            post(delete_workspace_chat_session_by_body),
        )
        .route(
            "/api/agents/{id}/chat/sessions",
            get(list_agent_chat_sessions).post(create_agent_chat_session),
        )
        .route(
            "/api/agents/{id}/chat/sessions/{session_id}",
            put(rename_agent_chat_session).delete(delete_agent_chat_session),
        )
        .route(
            "/api/agents/{id}/chat/sessions/{session_id}/duplicate",
            post(duplicate_agent_chat_session),
        )
        .route(
            "/api/agents/{id}/chat/sessions/{session_id}/pin",
            put(set_agent_chat_session_pinned),
        )
        .route(
            "/api/agents/{id}/chat/sessions/{session_id}/archive",
            put(set_agent_chat_session_archived),
        )
        .route(
            "/api/agents/{id}/chat/sessions/{session_id}/tags",
            put(set_agent_chat_session_tags),
        )
        .route(
            "/api/agents/{id}/chat/sessions/{session_id}/messages",
            get(list_chat_session_messages).delete(clear_chat_session_messages),
        )
        .route(
            "/api/agents/{id}/chat/messages",
            get(list_agent_chat_messages).delete(clear_agent_chat_messages),
        )
        .route("/api/chat", post(chat_with_agent))
        .route("/api/chat/undo", post(undo_last_chat_turn))
        .route("/api/chat/rewrite-user-message", post(rewrite_chat_user_message))
        .route("/api/chat/rewrite-last-user", post(rewrite_last_user_message))
        .route("/api/chat/stream", post(chat_with_agent_stream))
        .route("/api/chat/regenerate", post(regenerate_chat_reply))
        .route(
            "/api/chat/regenerate/stream",
            post(regenerate_chat_reply_stream),
        )
        .layer(middleware::from_fn_with_state(state.clone(), require_auth));

    Router::new()
        .route("/health", get(health))
        .merge(protected)
        .with_state(state)
        .layer(CorsLayer::permissive())
}

async fn require_auth(
    State(state): State<AppState>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, (StatusCode, Json<ErrorPayload>)> {
    let authorization = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();

    let expected = format!("Bearer {}", state.bearer_token);
    if authorization != expected {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(AppError::unauthorized("missing or invalid bearer token").payload()),
        ));
    }

    Ok(next.run(request).await)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

fn map_error(error: AppError) -> (StatusCode, Json<ErrorPayload>) {
    let payload = error.payload();
    let status = match payload.code.as_str() {
        "VALIDATION_ERROR" => StatusCode::BAD_REQUEST,
        "NOT_FOUND" => StatusCode::NOT_FOUND,
        "CONFLICT" => StatusCode::CONFLICT,
        "REFERENCE_IN_USE" => StatusCode::CONFLICT,
        "UNAUTHORIZED" => StatusCode::UNAUTHORIZED,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(payload))
}

async fn get_bootstrap(
    State(state): State<AppState>,
) -> ApiResponse<AppBootstrap> {
    let _ = state;
    Ok(Json(build_bootstrap(APP_VERSION)))
}

async fn get_runtime_status(State(state): State<AppState>) -> ApiResponse<RuntimeStatusResponse> {
    state
        .runtime
        .runtime_stats()
        .await
        .map(|stats| build_runtime_status(stats, APP_VERSION))
        .map(Json)
        .map_err(map_error)
}

async fn list_providers(
    State(state): State<AppState>,
) -> ApiResponse<Vec<ProviderConfig>> {
    state
        .runtime
        .list_providers()
        .await
        .map(Json)
        .map_err(map_error)
}

async fn create_provider(
    State(state): State<AppState>,
    Json(input): Json<CreateProviderRequest>,
) -> ApiResponse<ProviderConfig> {
    state
        .runtime
        .create_provider(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateProviderRequest>,
) -> ApiResponse<ProviderConfig> {
    state
        .runtime
        .update_provider(&id, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_provider_by_body(
    State(state): State<AppState>,
    Json(payload): Json<UpdateProviderPayload>,
) -> ApiResponse<ProviderConfig> {
    state
        .runtime
        .update_provider(&payload.id, payload.input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn delete_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .runtime
        .delete_provider(&id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn delete_provider_by_body(
    State(state): State<AppState>,
    Json(payload): Json<ResourceIdPayload>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .runtime
        .delete_provider(&payload.id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn probe_provider_connection(
    State(state): State<AppState>,
    Json(input): Json<ProbeProviderConnectionRequest>,
) -> ApiResponse<ProbeProviderConnectionResponse> {
    state
        .runtime
        .probe_provider_connection(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn list_models(
    State(state): State<AppState>,
) -> ApiResponse<Vec<ModelConfig>> {
    state
        .runtime
        .list_models()
        .await
        .map(Json)
        .map_err(map_error)
}

async fn create_model(
    State(state): State<AppState>,
    Json(input): Json<CreateModelRequest>,
) -> ApiResponse<ModelConfig> {
    state
        .runtime
        .create_model(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_model(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateModelRequest>,
) -> ApiResponse<ModelConfig> {
    state
        .runtime
        .update_model(&id, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_model_by_body(
    State(state): State<AppState>,
    Json(payload): Json<UpdateModelPayload>,
) -> ApiResponse<ModelConfig> {
    state
        .runtime
        .update_model(&payload.id, payload.input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn delete_model(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .runtime
        .delete_model(&id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn delete_model_by_body(
    State(state): State<AppState>,
    Json(payload): Json<ResourceIdPayload>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .runtime
        .delete_model(&payload.id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn probe_model_connection(
    State(state): State<AppState>,
    Json(input): Json<ProbeModelConnectionRequest>,
) -> ApiResponse<ProbeModelConnectionResponse> {
    state
        .runtime
        .probe_model_connection(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn list_agents(
    State(state): State<AppState>,
) -> ApiResponse<Vec<AgentConfig>> {
    state
        .runtime
        .list_agents()
        .await
        .map(Json)
        .map_err(map_error)
}

async fn create_agent(
    State(state): State<AppState>,
    Json(input): Json<CreateAgentRequest>,
) -> ApiResponse<AgentConfig> {
    state
        .runtime
        .create_agent(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateAgentRequest>,
) -> ApiResponse<AgentConfig> {
    state
        .runtime
        .update_agent(&id, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_agent_by_body(
    State(state): State<AppState>,
    Json(payload): Json<UpdateAgentPayload>,
) -> ApiResponse<AgentConfig> {
    state
        .runtime
        .update_agent(&payload.id, payload.input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn delete_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    if state
        .network_store
        .is_agent_in_use(&id)
        .await
        .map_err(map_error)?
    {
        return Err(map_error(AppError::reference_in_use(
            "agent is referenced by a network binding",
        )));
    }
    state
        .runtime
        .delete_agent(&id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn delete_agent_by_body(
    State(state): State<AppState>,
    Json(payload): Json<ResourceIdPayload>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    if state
        .network_store
        .is_agent_in_use(&payload.id)
        .await
        .map_err(map_error)?
    {
        return Err(map_error(AppError::reference_in_use(
            "agent is referenced by a network binding",
        )));
    }
    state
        .runtime
        .delete_agent(&payload.id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn list_network_bindings(
    State(state): State<AppState>,
) -> ApiResponse<Vec<NetworkBindingConfig>> {
    state
        .network_store
        .list_bindings()
        .await
        .map(Json)
        .map_err(map_error)
}

async fn create_network_binding(
    State(state): State<AppState>,
    Json(input): Json<CreateNetworkBindingRequest>,
) -> ApiResponse<NetworkBindingConfig> {
    let binding = state
        .network_store
        .create_binding(input)
        .await
        .map_err(map_error)?;
    if let Err(error) = state.network_manager.sync().await {
        eprintln!("failed to sync network bindings after create: {error}");
    }
    Ok(Json(binding))
}

async fn update_network_binding(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateNetworkBindingRequest>,
) -> ApiResponse<NetworkBindingConfig> {
    let binding = state
        .network_store
        .update_binding(&id, input)
        .await
        .map_err(map_error)?;
    if let Err(error) = state.network_manager.sync().await {
        eprintln!("failed to sync network bindings after update: {error}");
    }
    Ok(Json(binding))
}

async fn delete_network_binding(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .network_store
        .delete_binding(&id)
        .await
        .map_err(map_error)?;
    if let Err(error) = state.network_manager.sync().await {
        eprintln!("failed to sync network bindings after delete: {error}");
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_network_binding_runtime_statuses(
    State(state): State<AppState>,
) -> ApiResponse<Vec<NetworkBindingRuntimeStatus>> {
    state
        .network_manager
        .list_runtime_statuses()
        .await
        .map(Json)
        .map_err(map_error)
}

async fn restart_network_binding(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResponse<NetworkBindingRuntimeStatus> {
    state
        .network_manager
        .restart_binding(&id)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn list_agent_chat_messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResponse<Vec<ChatMessage>> {
    state
        .runtime
        .list_agent_chat_messages(&id)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn clear_agent_chat_messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .runtime
        .clear_agent_chat_messages(&id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn list_workspace_chat_sessions(
    State(state): State<AppState>,
) -> ApiResponse<Vec<WorkspaceChatSession>> {
    state
        .runtime
        .list_workspace_chat_sessions()
        .await
        .map(Json)
        .map_err(map_error)
}

async fn create_workspace_chat_session(
    State(state): State<AppState>,
    Json(input): Json<CreateWorkspaceChatSessionRequest>,
) -> ApiResponse<WorkspaceChatSession> {
    state
        .runtime
        .create_workspace_chat_session(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_workspace_chat_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(input): Json<UpdateWorkspaceChatSessionRequest>,
) -> ApiResponse<WorkspaceChatSession> {
    state
        .runtime
        .update_workspace_chat_session(&session_id, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_workspace_chat_session_by_body(
    State(state): State<AppState>,
    Json(payload): Json<UpdateWorkspaceSessionPayload>,
) -> ApiResponse<WorkspaceChatSession> {
    state
        .runtime
        .update_workspace_chat_session(&payload.session_id, payload.input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn delete_workspace_chat_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .runtime
        .delete_workspace_chat_session(&session_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn delete_workspace_chat_session_by_body(
    State(state): State<AppState>,
    Json(payload): Json<WorkspaceSessionIdPayload>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .runtime
        .delete_workspace_chat_session(&payload.session_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn list_workspace_chat_messages(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> ApiResponse<Vec<WorkspaceChatMessage>> {
    state
        .runtime
        .list_workspace_chat_messages(&session_id)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn clear_workspace_chat_messages(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .runtime
        .clear_workspace_chat_messages(&session_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn list_workspace_chat_messages_by_body(
    State(state): State<AppState>,
    Json(payload): Json<WorkspaceSessionIdPayload>,
) -> ApiResponse<Vec<WorkspaceChatMessage>> {
    state
        .runtime
        .list_workspace_chat_messages(&payload.session_id)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn clear_workspace_chat_messages_by_body(
    State(state): State<AppState>,
    Json(payload): Json<WorkspaceSessionIdPayload>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .runtime
        .clear_workspace_chat_messages(&payload.session_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn list_agent_chat_sessions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResponse<Vec<ChatSession>> {
    state
        .runtime
        .list_agent_chat_sessions(&id)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn create_agent_chat_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<CreateChatSessionRequest>,
) -> ApiResponse<ChatSession> {
    state
        .runtime
        .create_agent_chat_session(&id, &input.title)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn rename_agent_chat_session(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
    Json(input): Json<RenameChatSessionRequest>,
) -> ApiResponse<ChatSession> {
    state
        .runtime
        .rename_agent_chat_session(&id, &session_id, &input.title)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn delete_agent_chat_session(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .runtime
        .delete_agent_chat_session(&id, &session_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn duplicate_agent_chat_session(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
    Json(input): Json<DuplicateChatSessionRequest>,
) -> ApiResponse<ChatSession> {
    state
        .runtime
        .duplicate_agent_chat_session(&id, &session_id, &input.title)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn set_agent_chat_session_pinned(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
    Json(input): Json<SetChatSessionPinnedRequest>,
) -> ApiResponse<ChatSession> {
    state
        .runtime
        .set_agent_chat_session_pinned(&id, &session_id, input.pinned)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn set_agent_chat_session_archived(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
    Json(input): Json<SetChatSessionArchivedRequest>,
) -> ApiResponse<ChatSession> {
    state
        .runtime
        .set_agent_chat_session_archived(&id, &session_id, input.archived)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn set_agent_chat_session_tags(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
    Json(input): Json<SetChatSessionTagsRequest>,
) -> ApiResponse<ChatSession> {
    state
        .runtime
        .set_agent_chat_session_tags(&id, &session_id, &input.tags)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn list_chat_session_messages(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
) -> ApiResponse<Vec<ChatMessage>> {
    state
        .runtime
        .list_chat_session_messages(&id, &session_id)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn clear_chat_session_messages(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .runtime
        .clear_chat_session_messages(&id, &session_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn chat_with_agent(
    State(state): State<AppState>,
    Json(input): Json<ChatWithAgentRequest>,
) -> ApiResponse<ChatWithAgentResponse> {
    state
        .runtime
        .chat_with_agent(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn chat_with_session(
    State(state): State<AppState>,
    Json(input): Json<ChatWithSessionRequest>,
) -> ApiResponse<ChatWithSessionResponse> {
    state
        .runtime
        .chat_with_session(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn chat_with_session_stream(
    State(state): State<AppState>,
    Json(input): Json<ChatWithSessionRequest>,
) -> Result<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<ErrorPayload>)>
{
    let result = state
        .runtime
        .chat_with_session(input)
        .await
        .map_err(map_error)?;

    let start_payload = serde_json::json!({
        "sessionId": result.session_id,
    })
    .to_string();
    let done_payload = serde_json::to_string(&result)
        .map_err(|error| map_error(AppError::internal(error.to_string())))?;

    let stream = stream! {
        yield Ok(Event::default().event("start").data(start_payload));
        for reply in &result.replies {
            let reply_start_payload = serde_json::json!({
                "agentId": reply.agent_id,
                "agentName": reply.agent_name,
                "modelRefId": reply.model_ref_id,
                "modelId": reply.model_id,
            })
            .to_string();
            yield Ok(Event::default().event("reply_start").data(reply_start_payload));
            for chunk in split_stream_chunks(&reply.message, 24) {
                yield Ok(Event::default().event("delta").data(serde_json::json!({
                    "agentId": reply.agent_id,
                    "text": chunk
                }).to_string()));
                tokio::time::sleep(Duration::from_millis(8)).await;
            }
        }
        yield Ok(Event::default().event("done").data(done_payload));
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("ping")))
}

async fn undo_last_chat_turn(
    State(state): State<AppState>,
    Json(input): Json<UndoLastChatTurnRequest>,
) -> ApiResponse<UndoLastChatTurnResponse> {
    state
        .runtime
        .undo_last_chat_turn(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn rewrite_last_user_message(
    State(state): State<AppState>,
    Json(input): Json<RewriteLastUserMessageRequest>,
) -> ApiResponse<ChatWithAgentResponse> {
    state
        .runtime
        .rewrite_last_user_message(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn rewrite_chat_user_message(
    State(state): State<AppState>,
    Json(input): Json<RewriteChatUserMessageRequest>,
) -> ApiResponse<ChatWithAgentResponse> {
    state
        .runtime
        .rewrite_chat_user_message(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn regenerate_chat_reply(
    State(state): State<AppState>,
    Json(input): Json<RegenerateChatReplyRequest>,
) -> ApiResponse<ChatWithAgentResponse> {
    state
        .runtime
        .regenerate_chat_reply(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn chat_with_agent_stream(
    State(state): State<AppState>,
    Json(input): Json<ChatWithAgentRequest>,
) -> Result<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<ErrorPayload>)>
{
    let result = state
        .runtime
        .chat_with_agent(input)
        .await
        .map_err(map_error)?;

    let start_payload = serde_json::json!({
        "agentId": result.agent_id,
        "sessionId": result.session_id,
        "modelRefId": result.model_ref_id,
        "modelId": result.model_id,
    })
    .to_string();

    let full_text = result.message.clone();
    let chunks = split_stream_chunks(&full_text, 24);
    let done_payload = serde_json::to_string(&result)
        .map_err(|error| map_error(AppError::internal(error.to_string())))?;

    let stream = stream! {
        yield Ok(Event::default().event("start").data(start_payload));
        for chunk in chunks {
            yield Ok(Event::default().event("delta").data(serde_json::json!({ "text": chunk }).to_string()));
            tokio::time::sleep(Duration::from_millis(8)).await;
        }
        yield Ok(Event::default().event("done").data(done_payload));
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("ping")))
}

async fn regenerate_chat_reply_stream(
    State(state): State<AppState>,
    Json(input): Json<RegenerateChatReplyRequest>,
) -> Result<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<ErrorPayload>)>
{
    let result = state
        .runtime
        .regenerate_chat_reply(input)
        .await
        .map_err(map_error)?;

    let start_payload = serde_json::json!({
        "agentId": result.agent_id,
        "sessionId": result.session_id,
        "modelRefId": result.model_ref_id,
        "modelId": result.model_id,
    })
    .to_string();

    let full_text = result.message.clone();
    let chunks = split_stream_chunks(&full_text, 24);
    let done_payload = serde_json::to_string(&result)
        .map_err(|error| map_error(AppError::internal(error.to_string())))?;

    let stream = stream! {
        yield Ok(Event::default().event("start").data(start_payload));
        for chunk in chunks {
            yield Ok(Event::default().event("delta").data(serde_json::json!({ "text": chunk }).to_string()));
            tokio::time::sleep(Duration::from_millis(8)).await;
        }
        yield Ok(Event::default().event("done").data(done_payload));
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("ping")))
}

fn split_stream_chunks(text: &str, chunk_size: usize) -> Vec<String> {
    if text.is_empty() || chunk_size == 0 {
        return Vec::new();
    }
    let mut output = Vec::<String>::new();
    let mut current = String::new();
    let mut current_len = 0usize;
    for ch in text.chars() {
        current.push(ch);
        current_len += 1;
        if current_len >= chunk_size {
            output.push(current);
            current = String::new();
            current_len = 0;
        }
    }
    if !current.is_empty() {
        output.push(current);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::split_stream_chunks;

    #[test]
    fn split_chunks_by_max_char_count() {
        let chunks = split_stream_chunks("abcdefghijkl", 5);
        assert_eq!(chunks, vec!["abcde", "fghij", "kl"]);
    }

    #[test]
    fn split_chunks_supports_unicode() {
        let source = "你好世界abc";
        let chunks = split_stream_chunks(source, 2);
        assert_eq!(chunks.concat(), source);
        assert!(chunks.iter().all(|item| item.chars().count() <= 2));
    }

    #[test]
    fn split_chunks_returns_empty_for_empty_text_or_zero_size() {
        assert!(split_stream_chunks("", 8).is_empty());
        assert!(split_stream_chunks("abc", 0).is_empty());
    }
}








