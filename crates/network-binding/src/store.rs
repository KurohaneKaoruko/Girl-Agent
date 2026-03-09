use std::{str::FromStr, sync::Arc};

use girl_ai_agent_app_domain::{AppError, AppResult};
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    FromRow, SqlitePool,
};
use url::Url;
use uuid::Uuid;

use crate::types::{
    CreateNetworkBindingRequest, NetworkBindingConfig, NetworkSessionMode, NetworkTransportKind,
    UpdateNetworkBindingRequest,
};

#[derive(Clone)]
pub struct NetworkBindingStore {
    pool: Arc<SqlitePool>,
}

#[derive(Debug, FromRow)]
struct NetworkBindingRow {
    id: String,
    name: String,
    enabled: i64,
    transport_kind: String,
    bind_host: Option<String>,
    bind_port: Option<i64>,
    target_url: Option<String>,
    agent_id: String,
    session_mode: String,
    metadata_json: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, FromRow)]
struct BindingSessionRow {
    internal_session_id: String,
}

impl NetworkBindingStore {
    pub async fn connect(database_url: &str) -> AppResult<Self> {
        let options = SqliteConnectOptions::from_str(database_url)
            .map_err(|error| AppError::validation(format!("invalid database url: {error}")))?
            .create_if_missing(true)
            .foreign_keys(true);

        let max_connections = if database_url.contains(":memory:") {
            1
        } else {
            5
        };

        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;

        let store = Self {
            pool: Arc::new(pool),
        };
        store.initialize().await?;
        Ok(store)
    }

    async fn initialize(&self) -> AppResult<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS network_bindings (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              enabled INTEGER NOT NULL,
              transport_kind TEXT NOT NULL,
              bind_host TEXT,
              bind_port INTEGER,
              target_url TEXT,
              agent_id TEXT NOT NULL,
              session_mode TEXT NOT NULL,
              metadata_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
              updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
            "#,
        )
        .execute(self.pool.as_ref())
        .await?;

        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS idx_network_bindings_server_addr
            ON network_bindings(bind_host, bind_port)
            WHERE bind_host IS NOT NULL
              AND bind_port IS NOT NULL
              AND transport_kind IN ('http_server', 'websocket_server')
            "#,
        )
        .execute(self.pool.as_ref())
        .await?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_network_bindings_agent_id
            ON network_bindings(agent_id)
            "#,
        )
        .execute(self.pool.as_ref())
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS network_binding_sessions (
              binding_id TEXT NOT NULL,
              external_session_id TEXT NOT NULL,
              internal_session_id TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
              updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
              PRIMARY KEY(binding_id, external_session_id)
            )
            "#,
        )
        .execute(self.pool.as_ref())
        .await?;

        Ok(())
    }

    pub async fn list_bindings(&self) -> AppResult<Vec<NetworkBindingConfig>> {
        let rows = sqlx::query_as::<_, NetworkBindingRow>(
            r#"
            SELECT
              id, name, enabled, transport_kind, bind_host, bind_port, target_url,
              agent_id, session_mode, metadata_json, created_at, updated_at
            FROM network_bindings
            ORDER BY created_at ASC, id ASC
            "#,
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        rows.into_iter().map(map_row).collect()
    }

    pub async fn get_binding(&self, id: &str) -> AppResult<NetworkBindingConfig> {
        let row = sqlx::query_as::<_, NetworkBindingRow>(
            r#"
            SELECT
              id, name, enabled, transport_kind, bind_host, bind_port, target_url,
              agent_id, session_mode, metadata_json, created_at, updated_at
            FROM network_bindings
            WHERE id = ?
            "#,
        )
        .bind(id.trim())
        .fetch_optional(self.pool.as_ref())
        .await?;

        let row = row.ok_or_else(|| AppError::not_found("network binding not found"))?;
        map_row(row)
    }

    pub async fn create_binding(
        &self,
        input: CreateNetworkBindingRequest,
    ) -> AppResult<NetworkBindingConfig> {
        let normalized = self.normalize_and_validate_create(input).await?;
        let id = slugify_id(&normalized.name);

        sqlx::query(
            r#"
            INSERT INTO network_bindings (
              id, name, enabled, transport_kind, bind_host, bind_port, target_url,
              agent_id, session_mode, metadata_json, created_at, updated_at
            )
            VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'),
              STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
            )
            "#,
        )
        .bind(&id)
        .bind(&normalized.name)
        .bind(bool_to_i64(normalized.enabled))
        .bind(normalized.transport_kind.as_str())
        .bind(normalized.bind_host.as_deref())
        .bind(normalized.bind_port.map(i64::from))
        .bind(normalized.target_url.as_deref())
        .bind(&normalized.agent_id)
        .bind(normalized.session_mode.as_str())
        .bind(serde_json::to_string(&normalized.metadata).map_err(|error| {
            AppError::internal(format!("failed to encode network binding metadata: {error}"))
        })?)
        .execute(self.pool.as_ref())
        .await
        .map_err(map_write_error)?;

        self.get_binding(&id).await
    }

    pub async fn update_binding(
        &self,
        id: &str,
        input: UpdateNetworkBindingRequest,
    ) -> AppResult<NetworkBindingConfig> {
        let id = id.trim();
        if id.is_empty() {
            return Err(AppError::validation("network binding id is required"));
        }
        self.get_binding(id).await?;

        let normalized = self.normalize_and_validate_update(id, input).await?;

        sqlx::query(
            r#"
            UPDATE network_bindings
            SET
              name = ?,
              enabled = ?,
              transport_kind = ?,
              bind_host = ?,
              bind_port = ?,
              target_url = ?,
              agent_id = ?,
              session_mode = ?,
              metadata_json = ?,
              updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?
            "#,
        )
        .bind(&normalized.name)
        .bind(bool_to_i64(normalized.enabled))
        .bind(normalized.transport_kind.as_str())
        .bind(normalized.bind_host.as_deref())
        .bind(normalized.bind_port.map(i64::from))
        .bind(normalized.target_url.as_deref())
        .bind(&normalized.agent_id)
        .bind(normalized.session_mode.as_str())
        .bind(serde_json::to_string(&normalized.metadata).map_err(|error| {
            AppError::internal(format!("failed to encode network binding metadata: {error}"))
        })?)
        .bind(id)
        .execute(self.pool.as_ref())
        .await
        .map_err(map_write_error)?;

        self.get_binding(id).await
    }

    pub async fn delete_binding(&self, id: &str) -> AppResult<()> {
        let id = id.trim();
        if id.is_empty() {
            return Err(AppError::validation("network binding id is required"));
        }

        sqlx::query("DELETE FROM network_binding_sessions WHERE binding_id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;

        let result = sqlx::query("DELETE FROM network_bindings WHERE id = ?")
            .bind(id)
            .execute(self.pool.as_ref())
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::not_found("network binding not found"));
        }

        Ok(())
    }

    pub async fn is_agent_in_use(&self, agent_id: &str) -> AppResult<bool> {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(1) FROM network_bindings WHERE agent_id = ?",
        )
        .bind(agent_id.trim())
        .fetch_one(self.pool.as_ref())
        .await?;

        Ok(count > 0)
    }

    pub async fn get_binding_session(
        &self,
        binding_id: &str,
        external_session_id: &str,
    ) -> AppResult<Option<String>> {
        let row = sqlx::query_as::<_, BindingSessionRow>(
            r#"
            SELECT internal_session_id
            FROM network_binding_sessions
            WHERE binding_id = ? AND external_session_id = ?
            "#,
        )
        .bind(binding_id.trim())
        .bind(external_session_id.trim())
        .fetch_optional(self.pool.as_ref())
        .await?;

        Ok(row.map(|entry| entry.internal_session_id))
    }

    pub async fn upsert_binding_session(
        &self,
        binding_id: &str,
        external_session_id: &str,
        internal_session_id: &str,
    ) -> AppResult<()> {
        sqlx::query(
            r#"
            INSERT INTO network_binding_sessions (
              binding_id, external_session_id, internal_session_id, created_at, updated_at
            )
            VALUES (?, ?, ?, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'), STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
            ON CONFLICT(binding_id, external_session_id)
            DO UPDATE SET
              internal_session_id = excluded.internal_session_id,
              updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
            "#,
        )
        .bind(binding_id.trim())
        .bind(external_session_id.trim())
        .bind(internal_session_id.trim())
        .execute(self.pool.as_ref())
        .await?;

        Ok(())
    }

    pub async fn delete_binding_session(
        &self,
        binding_id: &str,
        external_session_id: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "DELETE FROM network_binding_sessions WHERE binding_id = ? AND external_session_id = ?",
        )
        .bind(binding_id.trim())
        .bind(external_session_id.trim())
        .execute(self.pool.as_ref())
        .await?;

        Ok(())
    }

    async fn normalize_and_validate_create(
        &self,
        input: CreateNetworkBindingRequest,
    ) -> AppResult<CreateNetworkBindingRequest> {
        let normalized = normalize_binding_input(input)?;
        validate_binding_input(self.pool.as_ref(), None, &normalized).await?;
        Ok(normalized)
    }

    async fn normalize_and_validate_update(
        &self,
        id: &str,
        input: UpdateNetworkBindingRequest,
    ) -> AppResult<UpdateNetworkBindingRequest> {
        let normalized = normalize_binding_input(input)?;
        validate_binding_input(self.pool.as_ref(), Some(id), &normalized).await?;
        Ok(normalized)
    }
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn slugify_id(name: &str) -> String {
    let mut slug = name
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch.to_ascii_lowercase() } else { '-' })
        .collect::<String>();
    slug = slug
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        format!("binding-{}", Uuid::new_v4().simple())
    } else {
        format!("{slug}-{}", Uuid::new_v4().simple())
    }
}

fn map_row(row: NetworkBindingRow) -> AppResult<NetworkBindingConfig> {
    Ok(NetworkBindingConfig {
        id: row.id,
        name: row.name,
        enabled: row.enabled != 0,
        transport_kind: NetworkTransportKind::from_str(&row.transport_kind)?,
        bind_host: row.bind_host,
        bind_port: row.bind_port.map(to_port).transpose()?,
        target_url: row.target_url,
        agent_id: row.agent_id,
        session_mode: NetworkSessionMode::from_str(&row.session_mode)?,
        metadata: serde_json::from_str(&row.metadata_json).map_err(|error| {
            AppError::internal(format!("invalid network binding metadata json: {error}"))
        })?,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn to_port(value: i64) -> AppResult<u16> {
    u16::try_from(value).map_err(|_| AppError::internal("invalid network binding port".to_string()))
}

fn map_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database_error) = &error {
        if database_error.message().contains("UNIQUE constraint failed") {
            return AppError::conflict("network binding address already exists".to_string());
        }
    }
    AppError::from(error)
}

fn normalize_binding_input<T>(mut input: T) -> AppResult<T>
where
    T: BindingInputMut,
{
    *input.name_mut() = input.name().trim().to_string();
    *input.agent_id_mut() = input.agent_id().trim().to_string();
    trim_optional(input.bind_host_mut());
    trim_optional(input.target_url_mut());

    let metadata = input.metadata_mut();
    if metadata.is_null() {
        *metadata = Value::Object(Default::default());
    }

    Ok(input)
}

async fn validate_binding_input<T>(
    pool: &SqlitePool,
    current_id: Option<&str>,
    input: &T,
) -> AppResult<()>
where
    T: BindingInputRef,
{
    if input.name().is_empty() {
        return Err(AppError::validation("network binding name is required"));
    }
    if input.agent_id().is_empty() {
        return Err(AppError::validation("agentId is required"));
    }

    let agent_exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM agents WHERE id = ?")
        .bind(input.agent_id())
        .fetch_one(pool)
        .await?;
    if agent_exists == 0 {
        return Err(AppError::validation("agentId does not exist"));
    }

    let transport = input.transport_kind();
    if transport.is_server() {
        let bind_host = input
            .bind_host()
            .ok_or_else(|| AppError::validation("bindHost is required for server bindings"))?;
        if bind_host.trim().is_empty() {
            return Err(AppError::validation("bindHost is required for server bindings"));
        }
        let bind_port = input
            .bind_port()
            .ok_or_else(|| AppError::validation("bindPort is required for server bindings"))?;
        if bind_port == 0 {
            return Err(AppError::validation("bindPort must be greater than 0"));
        }
    }

    if transport.is_client() {
        let target_url = input
            .target_url()
            .ok_or_else(|| AppError::validation("targetUrl is required for client bindings"))?;
        Url::parse(target_url.trim())
            .map_err(|error| AppError::validation(format!("invalid targetUrl: {error}")))?;
    }

    if let Some(bind_port) = input.bind_port() {
        if bind_port == 0 {
            return Err(AppError::validation("bindPort must be greater than 0"));
        }
    }

    if let Some(target_url) = input.target_url() {
        if !target_url.trim().is_empty() {
            Url::parse(target_url.trim())
                .map_err(|error| AppError::validation(format!("invalid targetUrl: {error}")))?;
        }
    }

    if transport.is_server() {
        let mut query = String::from(
            "SELECT COUNT(1) FROM network_bindings WHERE bind_host = ? AND bind_port = ? AND transport_kind IN ('http_server', 'websocket_server')",
        );
        if current_id.is_some() {
            query.push_str(" AND id <> ?");
        }
        let mut request = sqlx::query_scalar::<_, i64>(&query)
            .bind(input.bind_host())
            .bind(input.bind_port().map(i64::from));
        if let Some(current_id) = current_id {
            request = request.bind(current_id);
        }
        let count = request.fetch_one(pool).await?;
        if count > 0 {
            return Err(AppError::conflict(
                "network binding address already exists".to_string(),
            ));
        }
    }

    Ok(())
}

fn trim_optional(value: &mut Option<String>) {
    *value = value
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string);
}

trait BindingInputRef {
    fn name(&self) -> &str;
    fn agent_id(&self) -> &str;
    fn transport_kind(&self) -> NetworkTransportKind;
    fn bind_host(&self) -> Option<&str>;
    fn bind_port(&self) -> Option<u16>;
    fn target_url(&self) -> Option<&str>;
}

trait BindingInputMut: BindingInputRef {
    fn name_mut(&mut self) -> &mut String;
    fn agent_id_mut(&mut self) -> &mut String;
    fn bind_host_mut(&mut self) -> &mut Option<String>;
    fn target_url_mut(&mut self) -> &mut Option<String>;
    fn metadata_mut(&mut self) -> &mut Value;
}

impl BindingInputRef for CreateNetworkBindingRequest {
    fn name(&self) -> &str {
        &self.name
    }

    fn agent_id(&self) -> &str {
        &self.agent_id
    }

    fn transport_kind(&self) -> NetworkTransportKind {
        self.transport_kind
    }

    fn bind_host(&self) -> Option<&str> {
        self.bind_host.as_deref()
    }

    fn bind_port(&self) -> Option<u16> {
        self.bind_port
    }

    fn target_url(&self) -> Option<&str> {
        self.target_url.as_deref()
    }
}

impl BindingInputMut for CreateNetworkBindingRequest {
    fn name_mut(&mut self) -> &mut String {
        &mut self.name
    }

    fn agent_id_mut(&mut self) -> &mut String {
        &mut self.agent_id
    }

    fn bind_host_mut(&mut self) -> &mut Option<String> {
        &mut self.bind_host
    }

    fn target_url_mut(&mut self) -> &mut Option<String> {
        &mut self.target_url
    }

    fn metadata_mut(&mut self) -> &mut Value {
        &mut self.metadata
    }
}
