use std::{convert::Infallible, sync::Arc, time::Duration};

use async_stream::stream;
use axum::{
    extract::{Path, State},
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::{sse::{Event, KeepAlive, Sse}, Response},
    routing::{get, post, put},
    Json, Router,
};
use girlagent_core::error::ErrorPayload;
use girlagent_core::{
    AppError, AppService, ChatWithAgentRequest, ChatWithAgentResponse, ChatWithSessionRequest,
    ChatWithSessionResponse, CreateAgentRequest, CreateChatSessionRequest, CreateModelRequest,
    CreateProviderRequest, CreateWorkspaceChatSessionRequest, DuplicateChatSessionRequest,
    OpenAICompatChatGateway, ProbeModelConnectionRequest, ProbeModelConnectionResponse,
    ProbeProviderConnectionRequest, ProbeProviderConnectionResponse, RegenerateChatReplyRequest,
    RenameChatSessionRequest, RewriteChatUserMessageRequest, RewriteLastUserMessageRequest,
    RuntimeStatusResponse, SetChatSessionArchivedRequest, SetChatSessionPinnedRequest,
    SetChatSessionTagsRequest, SqliteStore, UndoLastChatTurnRequest, UndoLastChatTurnResponse,
    UpdateAgentRequest, UpdateModelRequest, UpdateProviderRequest,
    UpdateWorkspaceChatSessionRequest,
};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    service: AppService<SqliteStore>,
    chat_gateway: OpenAICompatChatGateway,
    bearer_token: String,
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
    let db_url =
        std::env::var("GIRLAGENT_DB_URL").unwrap_or_else(|_| "sqlite://girlagent.db".to_string());
    let bind_addr =
        std::env::var("GIRLAGENT_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
    let token = std::env::var("GIRLAGENT_TOKEN").unwrap_or_else(|_| {
        let generated = Uuid::new_v4().to_string();
        eprintln!("GIRLAGENT_TOKEN not set, generated one-time token: {generated}");
        generated
    });

    let store = SqliteStore::connect(&db_url).await?;
    let state = AppState {
        service: AppService::new(Arc::new(store), "Girl-AI-Agent", "0.1.0"),
        chat_gateway: OpenAICompatChatGateway::new(),
        bearer_token: token,
    };

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    println!("Girl-AI-Agent headless listening at http://{bind_addr}");
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
) -> ApiResponse<girlagent_core::BootstrapResponse> {
    state.service.bootstrap().await.map(Json).map_err(map_error)
}

async fn get_runtime_status(State(state): State<AppState>) -> ApiResponse<RuntimeStatusResponse> {
    state.service.runtime_status().await.map(Json).map_err(map_error)
}

async fn list_providers(
    State(state): State<AppState>,
) -> ApiResponse<Vec<girlagent_core::ProviderConfig>> {
    state
        .service
        .list_providers()
        .await
        .map(Json)
        .map_err(map_error)
}

async fn create_provider(
    State(state): State<AppState>,
    Json(input): Json<CreateProviderRequest>,
) -> ApiResponse<girlagent_core::ProviderConfig> {
    state
        .service
        .create_provider(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateProviderRequest>,
) -> ApiResponse<girlagent_core::ProviderConfig> {
    state
        .service
        .update_provider(&id, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_provider_by_body(
    State(state): State<AppState>,
    Json(payload): Json<UpdateProviderPayload>,
) -> ApiResponse<girlagent_core::ProviderConfig> {
    state
        .service
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
        .service
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
        .service
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
        .service
        .probe_provider_connection(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn list_models(
    State(state): State<AppState>,
) -> ApiResponse<Vec<girlagent_core::ModelConfig>> {
    state
        .service
        .list_models()
        .await
        .map(Json)
        .map_err(map_error)
}

async fn create_model(
    State(state): State<AppState>,
    Json(input): Json<CreateModelRequest>,
) -> ApiResponse<girlagent_core::ModelConfig> {
    state
        .service
        .create_model(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_model(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateModelRequest>,
) -> ApiResponse<girlagent_core::ModelConfig> {
    state
        .service
        .update_model(&id, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_model_by_body(
    State(state): State<AppState>,
    Json(payload): Json<UpdateModelPayload>,
) -> ApiResponse<girlagent_core::ModelConfig> {
    state
        .service
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
        .service
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
        .service
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
        .service
        .probe_model_connection(&state.chat_gateway, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn list_agents(
    State(state): State<AppState>,
) -> ApiResponse<Vec<girlagent_core::AgentConfig>> {
    state
        .service
        .list_agents()
        .await
        .map(Json)
        .map_err(map_error)
}

async fn create_agent(
    State(state): State<AppState>,
    Json(input): Json<CreateAgentRequest>,
) -> ApiResponse<girlagent_core::AgentConfig> {
    state
        .service
        .create_agent(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateAgentRequest>,
) -> ApiResponse<girlagent_core::AgentConfig> {
    state
        .service
        .update_agent(&id, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_agent_by_body(
    State(state): State<AppState>,
    Json(payload): Json<UpdateAgentPayload>,
) -> ApiResponse<girlagent_core::AgentConfig> {
    state
        .service
        .update_agent(&payload.id, payload.input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn delete_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .service
        .delete_agent(&id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn delete_agent_by_body(
    State(state): State<AppState>,
    Json(payload): Json<ResourceIdPayload>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    state
        .service
        .delete_agent(&payload.id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn list_agent_chat_messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResponse<Vec<girlagent_core::ChatMessage>> {
    state
        .service
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
        .service
        .clear_agent_chat_messages(&id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn list_workspace_chat_sessions(
    State(state): State<AppState>,
) -> ApiResponse<Vec<girlagent_core::WorkspaceChatSession>> {
    state
        .service
        .list_workspace_chat_sessions()
        .await
        .map(Json)
        .map_err(map_error)
}

async fn create_workspace_chat_session(
    State(state): State<AppState>,
    Json(input): Json<CreateWorkspaceChatSessionRequest>,
) -> ApiResponse<girlagent_core::WorkspaceChatSession> {
    state
        .service
        .create_workspace_chat_session(input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_workspace_chat_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(input): Json<UpdateWorkspaceChatSessionRequest>,
) -> ApiResponse<girlagent_core::WorkspaceChatSession> {
    state
        .service
        .update_workspace_chat_session(&session_id, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn update_workspace_chat_session_by_body(
    State(state): State<AppState>,
    Json(payload): Json<UpdateWorkspaceSessionPayload>,
) -> ApiResponse<girlagent_core::WorkspaceChatSession> {
    state
        .service
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
        .service
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
        .service
        .delete_workspace_chat_session(&payload.session_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn list_workspace_chat_messages(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> ApiResponse<Vec<girlagent_core::WorkspaceChatMessage>> {
    state
        .service
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
        .service
        .clear_workspace_chat_messages(&session_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn list_workspace_chat_messages_by_body(
    State(state): State<AppState>,
    Json(payload): Json<WorkspaceSessionIdPayload>,
) -> ApiResponse<Vec<girlagent_core::WorkspaceChatMessage>> {
    state
        .service
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
        .service
        .clear_workspace_chat_messages(&payload.session_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn list_agent_chat_sessions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResponse<Vec<girlagent_core::ChatSession>> {
    state
        .service
        .list_agent_chat_sessions(&id)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn create_agent_chat_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<CreateChatSessionRequest>,
) -> ApiResponse<girlagent_core::ChatSession> {
    state
        .service
        .create_agent_chat_session(&id, &input.title)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn rename_agent_chat_session(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
    Json(input): Json<RenameChatSessionRequest>,
) -> ApiResponse<girlagent_core::ChatSession> {
    state
        .service
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
        .service
        .delete_agent_chat_session(&id, &session_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(map_error)
}

async fn duplicate_agent_chat_session(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
    Json(input): Json<DuplicateChatSessionRequest>,
) -> ApiResponse<girlagent_core::ChatSession> {
    state
        .service
        .duplicate_agent_chat_session(&id, &session_id, &input.title)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn set_agent_chat_session_pinned(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
    Json(input): Json<SetChatSessionPinnedRequest>,
) -> ApiResponse<girlagent_core::ChatSession> {
    state
        .service
        .set_agent_chat_session_pinned(&id, &session_id, input.pinned)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn set_agent_chat_session_archived(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
    Json(input): Json<SetChatSessionArchivedRequest>,
) -> ApiResponse<girlagent_core::ChatSession> {
    state
        .service
        .set_agent_chat_session_archived(&id, &session_id, input.archived)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn set_agent_chat_session_tags(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
    Json(input): Json<SetChatSessionTagsRequest>,
) -> ApiResponse<girlagent_core::ChatSession> {
    state
        .service
        .set_agent_chat_session_tags(&id, &session_id, &input.tags)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn list_chat_session_messages(
    State(state): State<AppState>,
    Path((id, session_id)): Path<(String, String)>,
) -> ApiResponse<Vec<girlagent_core::ChatMessage>> {
    state
        .service
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
        .service
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
        .service
        .chat_with_agent(&state.chat_gateway, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn chat_with_session(
    State(state): State<AppState>,
    Json(input): Json<ChatWithSessionRequest>,
) -> ApiResponse<ChatWithSessionResponse> {
    state
        .service
        .chat_with_session(&state.chat_gateway, input)
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
        .service
        .chat_with_session(&state.chat_gateway, input)
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
        .service
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
        .service
        .rewrite_last_user_message(&state.chat_gateway, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn rewrite_chat_user_message(
    State(state): State<AppState>,
    Json(input): Json<RewriteChatUserMessageRequest>,
) -> ApiResponse<ChatWithAgentResponse> {
    state
        .service
        .rewrite_chat_user_message(&state.chat_gateway, input)
        .await
        .map(Json)
        .map_err(map_error)
}

async fn regenerate_chat_reply(
    State(state): State<AppState>,
    Json(input): Json<RegenerateChatReplyRequest>,
) -> ApiResponse<ChatWithAgentResponse> {
    state
        .service
        .regenerate_chat_reply(&state.chat_gateway, input)
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
        .service
        .chat_with_agent(&state.chat_gateway, input)
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
        .service
        .regenerate_chat_reply(&state.chat_gateway, input)
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
