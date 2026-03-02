use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{get, put},
    Json, Router,
};
use girlagent_core::error::ErrorPayload;
use girlagent_core::{
    AppError, AppService, CreateAgentRequest, CreateModelRequest, CreateProviderRequest,
    SqliteStore, UpdateAgentRequest, UpdateModelRequest, UpdateProviderRequest,
};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    service: AppService<SqliteStore>,
    bearer_token: String,
}

type ApiResponse<T> = Result<Json<T>, (StatusCode, Json<ErrorPayload>)>;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_url =
        std::env::var("GIRLAGENT_DB_URL").unwrap_or_else(|_| "sqlite://girlagent.db".to_string());
    let bind_addr = std::env::var("GIRLAGENT_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
    let token = std::env::var("GIRLAGENT_TOKEN").unwrap_or_else(|_| {
        let generated = Uuid::new_v4().to_string();
        eprintln!("GIRLAGENT_TOKEN not set, generated one-time token: {generated}");
        generated
    });

    let store = SqliteStore::connect(&db_url).await?;
    let state = AppState {
        service: AppService::new(Arc::new(store), "GirlAgent", "0.1.0"),
        bearer_token: token,
    };

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    println!("GirlAgent headless listening at http://{bind_addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

fn build_router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/api/bootstrap", get(get_bootstrap))
        .route("/api/providers", get(list_providers).post(create_provider))
        .route(
            "/api/providers/{id}",
            put(update_provider).delete(delete_provider),
        )
        .route("/api/models", get(list_models).post(create_model))
        .route("/api/models/{id}", put(update_model).delete(delete_model))
        .route("/api/agents", get(list_agents).post(create_agent))
        .route("/api/agents/{id}", put(update_agent).delete(delete_agent))
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

async fn get_bootstrap(State(state): State<AppState>) -> ApiResponse<girlagent_core::BootstrapResponse> {
    state
        .service
        .bootstrap()
        .await
        .map(Json)
        .map_err(map_error)
}

async fn list_providers(State(state): State<AppState>) -> ApiResponse<Vec<girlagent_core::ProviderConfig>> {
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

async fn list_models(State(state): State<AppState>) -> ApiResponse<Vec<girlagent_core::ModelConfig>> {
    state.service.list_models().await.map(Json).map_err(map_error)
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

async fn list_agents(State(state): State<AppState>) -> ApiResponse<Vec<girlagent_core::AgentConfig>> {
    state.service.list_agents().await.map(Json).map_err(map_error)
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
