use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{code}: {message}")]
    Domain {
        code: String,
        message: String,
        details: Option<serde_json::Value>,
    },
    #[error("INTERNAL_ERROR: {0}")]
    Internal(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Domain {
            code: "VALIDATION_ERROR".to_string(),
            message: message.into(),
            details: None,
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::Domain {
            code: "NOT_FOUND".to_string(),
            message: message.into(),
            details: None,
        }
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Domain {
            code: "CONFLICT".to_string(),
            message: message.into(),
            details: None,
        }
    }

    pub fn reference_in_use(message: impl Into<String>) -> Self {
        Self::Domain {
            code: "REFERENCE_IN_USE".to_string(),
            message: message.into(),
            details: None,
        }
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::Domain {
            code: "UNAUTHORIZED".to_string(),
            message: message.into(),
            details: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }

    pub fn payload(&self) -> ErrorPayload {
        match self {
            AppError::Domain {
                code,
                message,
                details,
            } => ErrorPayload {
                code: code.clone(),
                message: message.clone(),
                details: details.clone(),
            },
            AppError::Internal(message) => ErrorPayload {
                code: "INTERNAL_ERROR".to_string(),
                message: message.clone(),
                details: None,
            },
        }
    }
}

impl From<sqlx::Error> for AppError {
    fn from(value: sqlx::Error) -> Self {
        AppError::internal(value.to_string())
    }
}

impl From<sqlx::migrate::MigrateError> for AppError {
    fn from(value: sqlx::migrate::MigrateError) -> Self {
        AppError::internal(value.to_string())
    }
}
