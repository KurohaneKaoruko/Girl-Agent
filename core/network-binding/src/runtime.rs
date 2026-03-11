use std::{
    collections::{HashMap, HashSet},
    convert::Infallible,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use async_stream::stream;
use axum::{
    extract::{
        ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade},
        State,
    },
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use girl_ai_agent_app_domain::{
    AppDomainRuntime, ErrorPayload, AppError, AppResult, ChatWithAgentRequest,
};
use tokio::{net::TcpListener, sync::RwLock, task::JoinHandle};
use tokio_tungstenite::{connect_async, tungstenite::Message as TungsteniteMessage};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

use crate::{
    store::NetworkBindingStore,
    types::{
        BindingClientRequest, BindingErrorEvent, BindingServerEvent, MessageChunkEvent,
        MessageCompletedEvent, MessageCreateRequest, NetworkBindingConfig,
        NetworkBindingRuntimeState, NetworkBindingRuntimeStatus, NetworkSessionMode,
        NetworkTransportKind, SessionCloseRequest, SessionClosedEvent, SessionOpenRequest,
        SessionOpenedEvent,
    },
};

type ApiResponse<T> = Result<Json<T>, (StatusCode, Json<ErrorPayload>)>;

#[derive(Clone)]
pub struct NetworkBindingSessionService {
    store: NetworkBindingStore,
    runtime: AppDomainRuntime,
}

#[derive(Clone)]
pub struct NetworkBindingManager {
    store: NetworkBindingStore,
    session_service: NetworkBindingSessionService,
    statuses: Arc<RwLock<HashMap<String, NetworkBindingRuntimeStatus>>>,
    handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

#[derive(Clone)]
struct BindingHttpState {
    binding: NetworkBindingConfig,
    session_service: NetworkBindingSessionService,
    manager: NetworkBindingManager,
}

impl NetworkBindingSessionService {
    pub fn new(
        store: NetworkBindingStore,
        runtime: AppDomainRuntime,
    ) -> Self {
        Self { store, runtime }
    }

    pub async fn handle_client_request(
        &self,
        binding: &NetworkBindingConfig,
        request: BindingClientRequest,
    ) -> AppResult<Vec<BindingServerEvent>> {
        match request {
            BindingClientRequest::SessionOpen(input) => {
                let event = self.open_session(binding, input).await?;
                Ok(vec![BindingServerEvent::SessionOpened(event)])
            }
            BindingClientRequest::SessionClose(input) => {
                let event = self.close_session(binding, input).await?;
                Ok(vec![BindingServerEvent::SessionClosed(event)])
            }
            BindingClientRequest::MessageCreate(input) => self.send_message(binding, input).await,
        }
    }

    async fn open_session(
        &self,
        binding: &NetworkBindingConfig,
        input: SessionOpenRequest,
    ) -> AppResult<SessionOpenedEvent> {
        let external_session_id = self.normalize_external_session_id(binding, input.external_session_id)?;
        let internal_session_id = self
            .resolve_internal_session_id(binding, &external_session_id)
            .await?;
        Ok(SessionOpenedEvent {
            request_id: normalize_request_id(&input.request_id),
            external_session_id,
            internal_session_id,
        })
    }

    async fn close_session(
        &self,
        binding: &NetworkBindingConfig,
        input: SessionCloseRequest,
    ) -> AppResult<SessionClosedEvent> {
        let external_session_id = self.normalize_external_session_id(binding, input.external_session_id)?;
        self.store
            .delete_binding_session(&binding.id, &external_session_id)
            .await?;
        Ok(SessionClosedEvent {
            request_id: normalize_request_id(&input.request_id),
            external_session_id,
        })
    }

    async fn send_message(
        &self,
        binding: &NetworkBindingConfig,
        input: MessageCreateRequest,
    ) -> AppResult<Vec<BindingServerEvent>> {
        let request_id = normalize_request_id(&input.request_id);
        let external_session_id = self.normalize_external_session_id(binding, input.external_session_id)?;
        let internal_session_id = self
            .resolve_internal_session_id(binding, &external_session_id)
            .await?;
        let prompt = compose_user_message(&input.input, input.system.as_deref(), &input.context, &input.metadata);
        let response = self
            .runtime
            .chat_with_agent(ChatWithAgentRequest {
                agent_id: binding.agent_id.clone(),
                session_id: Some(internal_session_id.clone()),
                user_message: prompt,
                history: Vec::new(),
                temperature: None,
                max_tokens: None,
                top_p: None,
                frequency_penalty: None,
            })
            .await?;

        let mut events = Vec::new();
        if input.stream {
            for chunk in split_message_chunks(&response.message, 48) {
                events.push(BindingServerEvent::MessageChunk(MessageChunkEvent {
                    request_id: request_id.clone(),
                    external_session_id: external_session_id.clone(),
                    chunk,
                }));
            }
        }

        events.push(BindingServerEvent::MessageCompleted(MessageCompletedEvent {
            request_id,
            external_session_id,
            internal_session_id,
            model_ref_id: response.model_ref_id,
            model_id: response.model_id,
            message: response.message,
        }));
        Ok(events)
    }

    async fn resolve_internal_session_id(
        &self,
        binding: &NetworkBindingConfig,
        external_session_id: &str,
    ) -> AppResult<String> {
        if let Some(existing) = self
            .store
            .get_binding_session(&binding.id, external_session_id)
            .await?
        {
            return Ok(existing);
        }

        let session = self
            .runtime
            .create_agent_chat_session(
                &binding.agent_id,
                &format!("{} / {}", binding.name, external_session_id),
            )
            .await?;
        self.store
            .upsert_binding_session(&binding.id, external_session_id, &session.id)
            .await?;
        Ok(session.id)
    }

    fn normalize_external_session_id(
        &self,
        binding: &NetworkBindingConfig,
        external_session_id: Option<String>,
    ) -> AppResult<String> {
        let trimmed = external_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        match binding.session_mode {
            NetworkSessionMode::Shared => Ok(trimmed.unwrap_or_else(|| "shared".to_string())),
            NetworkSessionMode::ExternalSession => Ok(trimmed.unwrap_or_else(|| {
                format!("session-{}", Uuid::new_v4().simple())
            })),
        }
    }
}

impl NetworkBindingManager {
    pub fn new(
        store: NetworkBindingStore,
        runtime: AppDomainRuntime,
    ) -> Self {
        Self {
            session_service: NetworkBindingSessionService::new(
                store.clone(),
                runtime,
            ),
            store,
            statuses: Arc::new(RwLock::new(HashMap::new())),
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn sync(&self) -> AppResult<()> {
        let bindings = self.store.list_bindings().await?;
        let binding_ids = bindings
            .iter()
            .map(|binding| binding.id.clone())
            .collect::<HashSet<_>>();
        let existing_ids = self
            .handles
            .lock()
            .expect("network binding handles poisoned")
            .keys()
            .cloned()
            .collect::<Vec<_>>();

        for binding_id in existing_ids {
            if !binding_ids.contains(&binding_id) {
                self.stop_binding(&binding_id).await;
            }
        }

        for binding in bindings {
            self.stop_binding(&binding.id).await;
            if binding.enabled {
                self.start_binding(binding).await;
            } else {
                self.set_status(default_status(&binding, NetworkBindingRuntimeState::Stopped, "binding disabled", None))
                    .await;
            }
        }

        Ok(())
    }

    pub async fn restart_binding(
        &self,
        binding_id: &str,
    ) -> AppResult<NetworkBindingRuntimeStatus> {
        let binding = self.store.get_binding(binding_id).await?;
        self.stop_binding(&binding.id).await;
        if binding.enabled {
            self.start_binding(binding.clone()).await;
        } else {
            self.set_status(default_status(&binding, NetworkBindingRuntimeState::Stopped, "binding disabled", None))
                .await;
        }
        Ok(self.status_for(&binding).await)
    }

    pub async fn list_runtime_statuses(&self) -> AppResult<Vec<NetworkBindingRuntimeStatus>> {
        let bindings = self.store.list_bindings().await?;
        let statuses = self.statuses.read().await;
        Ok(bindings
            .iter()
            .map(|binding| {
                statuses
                    .get(&binding.id)
                    .cloned()
                    .unwrap_or_else(|| {
                        default_status(
                            binding,
                            NetworkBindingRuntimeState::Stopped,
                            if binding.enabled {
                                "binding not started"
                            } else {
                                "binding disabled"
                            },
                            None,
                        )
                    })
            })
            .collect())
    }

    async fn start_binding(&self, binding: NetworkBindingConfig) {
        self.set_status(default_status(&binding, NetworkBindingRuntimeState::Starting, "starting", None))
            .await;

        match binding.transport_kind {
            NetworkTransportKind::HttpServer => self.spawn_http_server(binding).await,
            NetworkTransportKind::WebSocketServer => self.spawn_websocket_server(binding).await,
            NetworkTransportKind::WebSocketClient => self.spawn_websocket_client(binding).await,
            NetworkTransportKind::HttpClient => {
                self.set_status(default_status(
                    &binding,
                    NetworkBindingRuntimeState::Unsupported,
                    "http_client is reserved in v1",
                    None,
                ))
                .await;
            }
        }
    }

    async fn stop_binding(&self, binding_id: &str) {
        if let Some(handle) = self
            .handles
            .lock()
            .expect("network binding handles poisoned")
            .remove(binding_id)
        {
            handle.abort();
        }
    }

    async fn status_for(&self, binding: &NetworkBindingConfig) -> NetworkBindingRuntimeStatus {
        self.statuses
            .read()
            .await
            .get(&binding.id)
            .cloned()
            .unwrap_or_else(|| default_status(binding, NetworkBindingRuntimeState::Stopped, "binding disabled", None))
    }

    async fn set_status(&self, status: NetworkBindingRuntimeStatus) {
        self.statuses
            .write()
            .await
            .insert(status.binding_id.clone(), status);
    }

    async fn mark_running(&self, binding: &NetworkBindingConfig, detail: String) {
        let mut next = self.status_for(binding).await;
        next.state = NetworkBindingRuntimeState::Running;
        next.running = true;
        next.detail = detail;
        next.last_error = None;
        self.set_status(next).await;
    }

    async fn mark_connecting(&self, binding: &NetworkBindingConfig, detail: String) {
        let mut next = self.status_for(binding).await;
        next.state = NetworkBindingRuntimeState::Connecting;
        next.running = false;
        next.detail = detail;
        self.set_status(next).await;
    }

    async fn mark_error(&self, binding: &NetworkBindingConfig, message: impl Into<String>) {
        let detail = message.into();
        let mut next = self.status_for(binding).await;
        next.state = NetworkBindingRuntimeState::Error;
        next.running = false;
        next.last_error = Some(detail.clone());
        next.detail = detail;
        self.set_status(next).await;
    }

    async fn touch_activity(&self, binding: &NetworkBindingConfig) {
        let mut next = self.status_for(binding).await;
        next.last_activity_at_ms = Some(now_ms());
        self.set_status(next).await;
    }

    async fn spawn_http_server(&self, binding: NetworkBindingConfig) {
        let binding_id = binding.id.clone();
        let manager = self.clone();
        let state = BindingHttpState {
            binding: binding.clone(),
            session_service: self.session_service.clone(),
            manager: self.clone(),
        };
        let bind_addr = format!(
            "{}:{}",
            binding.bind_host.as_deref().unwrap_or("127.0.0.1"),
            binding.bind_port.unwrap_or(0)
        );
        let handle = tokio::spawn(async move {
            let listener = match TcpListener::bind(&bind_addr).await {
                Ok(listener) => listener,
                Err(error) => {
                    manager
                        .mark_error(&binding, format!("failed to bind {bind_addr}: {error}"))
                        .await;
                    return;
                }
            };

            manager
                .mark_running(&binding, format!("listening on http://{bind_addr}"))
                .await;
            let app = build_http_router(state);
            if let Err(error) = axum::serve(listener, app).await {
                manager
                    .mark_error(&binding, format!("http server stopped: {error}"))
                    .await;
            }
        });
        self.handles
            .lock()
            .expect("network binding handles poisoned")
            .insert(binding_id, handle);
    }

    async fn spawn_websocket_server(&self, binding: NetworkBindingConfig) {
        let binding_id = binding.id.clone();
        let manager = self.clone();
        let state = BindingHttpState {
            binding: binding.clone(),
            session_service: self.session_service.clone(),
            manager: self.clone(),
        };
        let bind_addr = format!(
            "{}:{}",
            binding.bind_host.as_deref().unwrap_or("127.0.0.1"),
            binding.bind_port.unwrap_or(0)
        );
        let handle = tokio::spawn(async move {
            let listener = match TcpListener::bind(&bind_addr).await {
                Ok(listener) => listener,
                Err(error) => {
                    manager
                        .mark_error(&binding, format!("failed to bind {bind_addr}: {error}"))
                        .await;
                    return;
                }
            };

            manager
                .mark_running(&binding, format!("listening on ws://{bind_addr}/v1/ws"))
                .await;
            let app = build_websocket_router(state);
            if let Err(error) = axum::serve(listener, app).await {
                manager
                    .mark_error(&binding, format!("websocket server stopped: {error}"))
                    .await;
            }
        });
        self.handles
            .lock()
            .expect("network binding handles poisoned")
            .insert(binding_id, handle);
    }

    async fn spawn_websocket_client(&self, binding: NetworkBindingConfig) {
        let binding_id = binding.id.clone();
        let manager = self.clone();
        let session_service = self.session_service.clone();
        let handle = tokio::spawn(async move {
            let target_url = binding.target_url.clone().unwrap_or_default();
            loop {
                manager
                    .mark_connecting(&binding, format!("connecting to {target_url}"))
                    .await;
                match connect_async(&target_url).await {
                    Ok((stream, _response)) => {
                        manager
                            .mark_running(&binding, format!("connected to {target_url}"))
                            .await;
                        let (mut writer, mut reader) = stream.split();
                        while let Some(message) = reader.next().await {
                            let message = match message {
                                Ok(message) => message,
                                Err(error) => {
                                    manager
                                        .mark_error(&binding, format!("websocket read failed: {error}"))
                                        .await;
                                    break;
                                }
                            };
                            if let Some(request) = parse_tungstenite_request(message, &manager, &binding).await {
                                match session_service.handle_client_request(&binding, request).await {
                                    Ok(events) => {
                                        for event in events {
                                            manager.touch_activity(&binding).await;
                                            if writer
                                                .send(TungsteniteMessage::Text(serialize_event(&event).into()))
                                                .await
                                                .is_err()
                                            {
                                                manager
                                                    .mark_error(&binding, "websocket write failed")
                                                    .await;
                                                break;
                                            }
                                        }
                                    }
                                    Err(error) => {
                                        let event = BindingServerEvent::Error(error_to_binding_event("", error));
                                        let _ = writer
                                            .send(TungsteniteMessage::Text(serialize_event(&event).into()))
                                            .await;
                                    }
                                }
                            }
                        }
                    }
                    Err(error) => {
                        manager
                            .mark_error(&binding, format!("websocket connect failed: {error}"))
                            .await;
                    }
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });
        self.handles
            .lock()
            .expect("network binding handles poisoned")
            .insert(binding_id, handle);
    }
}

fn build_http_router(state: BindingHttpState) -> Router {
    Router::new()
        .route("/health", get(binding_health))
        .route("/v1/session/open", post(binding_session_open))
        .route("/v1/session/close", post(binding_session_close))
        .route("/v1/message", post(binding_message))
        .with_state(state)
        .layer(CorsLayer::permissive())
}

fn build_websocket_router(state: BindingHttpState) -> Router {
    Router::new()
        .route("/health", get(binding_health))
        .route("/v1/ws", get(binding_websocket_upgrade))
        .with_state(state)
        .layer(CorsLayer::permissive())
}

async fn binding_health(State(state): State<BindingHttpState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "bindingId": state.binding.id,
        "name": state.binding.name,
        "transportKind": state.binding.transport_kind,
        "agentId": state.binding.agent_id,
    }))
}

async fn binding_session_open(
    State(state): State<BindingHttpState>,
    Json(input): Json<SessionOpenRequest>,
) -> ApiResponse<BindingServerEvent> {
    let events = state
        .session_service
        .handle_client_request(&state.binding, BindingClientRequest::SessionOpen(input))
        .await
        .map_err(map_error)?;
    state.manager.touch_activity(&state.binding).await;
    Ok(Json(events.into_iter().next().unwrap_or_else(|| {
        BindingServerEvent::Error(BindingErrorEvent {
            request_id: String::new(),
            code: "INTERNAL_ERROR".to_string(),
            message: "missing session_open response".to_string(),
        })
    })))
}

async fn binding_session_close(
    State(state): State<BindingHttpState>,
    Json(input): Json<SessionCloseRequest>,
) -> ApiResponse<BindingServerEvent> {
    let events = state
        .session_service
        .handle_client_request(&state.binding, BindingClientRequest::SessionClose(input))
        .await
        .map_err(map_error)?;
    state.manager.touch_activity(&state.binding).await;
    Ok(Json(events.into_iter().next().unwrap_or_else(|| {
        BindingServerEvent::Error(BindingErrorEvent {
            request_id: String::new(),
            code: "INTERNAL_ERROR".to_string(),
            message: "missing session_close response".to_string(),
        })
    })))
}

async fn binding_message(
    State(state): State<BindingHttpState>,
    Json(input): Json<MessageCreateRequest>,
) -> Result<Response, (StatusCode, Json<ErrorPayload>)> {
    let stream_response = input.stream;
    let events = state
        .session_service
        .handle_client_request(&state.binding, BindingClientRequest::MessageCreate(input))
        .await
        .map_err(map_error)?;
    state.manager.touch_activity(&state.binding).await;

    if !stream_response {
        let event = events.into_iter().last().unwrap_or_else(|| {
            BindingServerEvent::Error(BindingErrorEvent {
                request_id: String::new(),
                code: "INTERNAL_ERROR".to_string(),
                message: "missing message response".to_string(),
            })
        });
        return Ok(Json(event).into_response());
    }

    Ok(sse_response(events))
}

async fn binding_websocket_upgrade(
    State(state): State<BindingHttpState>,
    websocket: WebSocketUpgrade,
) -> Response {
    websocket.on_upgrade(move |socket| run_binding_websocket(socket, state))
}

async fn run_binding_websocket(mut socket: WebSocket, state: BindingHttpState) {
    while let Some(result) = socket.next().await {
        let message = match result {
            Ok(message) => message,
            Err(error) => {
                state
                    .manager
                    .mark_error(&state.binding, format!("websocket receive failed: {error}"))
                    .await;
                return;
            }
        };

        let request = match parse_axum_request(message) {
            Ok(Some(request)) => request,
            Ok(None) => continue,
            Err(error) => {
                let event = BindingServerEvent::Error(error_to_binding_event("", error));
                let _ = socket
                    .send(AxumWsMessage::Text(serialize_event(&event)))
                    .await;
                continue;
            }
        };

        match state
            .session_service
            .handle_client_request(&state.binding, request)
            .await
        {
            Ok(events) => {
                state.manager.touch_activity(&state.binding).await;
                for event in events {
                    if socket
                        .send(AxumWsMessage::Text(serialize_event(&event)))
                        .await
                        .is_err()
                    {
                        state
                            .manager
                            .mark_error(&state.binding, "websocket send failed")
                            .await;
                        return;
                    }
                }
            }
            Err(error) => {
                let event = BindingServerEvent::Error(error_to_binding_event("", error));
                let _ = socket
                    .send(AxumWsMessage::Text(serialize_event(&event)))
                    .await;
            }
        }
    }
}

fn sse_response(events: Vec<BindingServerEvent>) -> Response {
    let stream = stream! {
        for event in events {
            yield Ok::<Event, Infallible>(
                Event::default()
                    .event(binding_event_name(&event))
                    .data(serialize_event(&event))
            );
        }
    };

    Sse::new(stream)
        .keep_alive(KeepAlive::default().interval(Duration::from_secs(15)))
        .into_response()
}

fn compose_user_message(
    input: &str,
    system: Option<&str>,
    context: &serde_json::Value,
    metadata: &serde_json::Value,
) -> String {
    let mut sections = Vec::new();
    if let Some(system) = system.map(str::trim).filter(|value| !value.is_empty()) {
        sections.push(format!("System:\n{system}"));
    }
    if !context.is_null() && context != &serde_json::json!({}) {
        sections.push(format!("Context:\n{}", context));
    }
    if !metadata.is_null() && metadata != &serde_json::json!({}) {
        sections.push(format!("Metadata:\n{}", metadata));
    }
    sections.push(format!("Input:\n{}", input.trim()));
    sections.join("\n\n")
}

fn split_message_chunks(message: &str, chunk_size: usize) -> Vec<String> {
    if chunk_size == 0 || message.is_empty() {
        return Vec::new();
    }
    let mut current = String::new();
    let mut chunks = Vec::new();
    for ch in message.chars() {
        current.push(ch);
        if current.chars().count() >= chunk_size {
            chunks.push(current);
            current = String::new();
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn binding_event_name(event: &BindingServerEvent) -> &'static str {
    match event {
        BindingServerEvent::SessionOpened(_) => "session_opened",
        BindingServerEvent::SessionClosed(_) => "session_closed",
        BindingServerEvent::MessageChunk(_) => "message_chunk",
        BindingServerEvent::MessageCompleted(_) => "message_completed",
        BindingServerEvent::Error(_) => "error",
    }
}

fn serialize_event(event: &BindingServerEvent) -> String {
    serde_json::to_string(event).unwrap_or_else(|_| {
        "{\"type\":\"error\",\"requestId\":\"\",\"code\":\"INTERNAL_ERROR\",\"message\":\"failed to serialize event\"}"
            .to_string()
    })
}

fn parse_axum_request(message: AxumWsMessage) -> AppResult<Option<BindingClientRequest>> {
    match message {
        AxumWsMessage::Text(payload) => parse_request_text(&payload).map(Some),
        AxumWsMessage::Binary(_) => Err(AppError::validation("binary websocket frames are not supported")),
        AxumWsMessage::Ping(_) | AxumWsMessage::Pong(_) => Ok(None),
        AxumWsMessage::Close(_) => Ok(None),
    }
}

async fn parse_tungstenite_request(
    message: TungsteniteMessage,
    manager: &NetworkBindingManager,
    binding: &NetworkBindingConfig,
) -> Option<BindingClientRequest> {
    match message {
        TungsteniteMessage::Text(payload) => match parse_request_text(&payload) {
            Ok(request) => Some(request),
            Err(error) => {
                manager.mark_error(binding, error.to_string()).await;
                None
            }
        },
        TungsteniteMessage::Binary(_) => {
            manager
                .mark_error(binding, "binary websocket frames are not supported")
                .await;
            None
        }
        TungsteniteMessage::Ping(_)
        | TungsteniteMessage::Pong(_)
        | TungsteniteMessage::Frame(_)
        | TungsteniteMessage::Close(_) => None,
    }
}

fn parse_request_text(payload: &str) -> AppResult<BindingClientRequest> {
    serde_json::from_str(payload)
        .map_err(|error| AppError::validation(format!("invalid binding request: {error}")))
}

fn normalize_request_id(request_id: &str) -> String {
    let trimmed = request_id.trim();
    if trimmed.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        trimmed.to_string()
    }
}

fn error_to_binding_event(request_id: &str, error: AppError) -> BindingErrorEvent {
    let payload = error.payload();
    BindingErrorEvent {
        request_id: request_id.to_string(),
        code: payload.code,
        message: payload.message,
    }
}

fn map_error(error: AppError) -> (StatusCode, Json<ErrorPayload>) {
    let payload = error.payload();
    let status = match payload.code.as_str() {
        "VALIDATION_ERROR" => StatusCode::UNPROCESSABLE_ENTITY,
        "NOT_FOUND" => StatusCode::NOT_FOUND,
        "CONFLICT" | "REFERENCE_IN_USE" => StatusCode::CONFLICT,
        "UNAUTHORIZED" => StatusCode::UNAUTHORIZED,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(payload))
}

fn default_status(
    binding: &NetworkBindingConfig,
    state: NetworkBindingRuntimeState,
    detail: impl Into<String>,
    last_error: Option<String>,
) -> NetworkBindingRuntimeStatus {
    NetworkBindingRuntimeStatus {
        binding_id: binding.id.clone(),
        name: binding.name.clone(),
        enabled: binding.enabled,
        transport_kind: binding.transport_kind,
        agent_id: binding.agent_id.clone(),
        running: state == NetworkBindingRuntimeState::Running,
        state,
        detail: detail.into(),
        last_error,
        last_activity_at_ms: None,
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
