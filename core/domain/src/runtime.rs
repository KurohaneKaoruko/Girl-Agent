use async_trait::async_trait;
use reqwest::{
    header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    Client,
};
use serde_json::{json, Value};

use crate::{
    dto::{ChatMessage, ChatMessageRole},
    error::{AppError, AppResult},
    types::ModelParams,
};

#[derive(Debug, Clone)]
pub struct CompletionRequest {
    pub api_base: String,
    pub api_key: Option<String>,
    pub model_id: String,
    pub messages: Vec<ChatMessage>,
    pub params: ModelParams,
}

#[derive(Debug, Clone)]
pub struct CompletionResponse {
    pub text: String,
}

#[async_trait]
pub trait ChatCompletionGateway: Send + Sync {
    async fn complete(&self, request: CompletionRequest) -> AppResult<CompletionResponse>;
}

#[derive(Clone)]
pub struct OpenAICompatChatGateway {
    client: Client,
}

impl OpenAICompatChatGateway {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }
}

impl Default for OpenAICompatChatGateway {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ChatCompletionGateway for OpenAICompatChatGateway {
    async fn complete(&self, request: CompletionRequest) -> AppResult<CompletionResponse> {
        let mut base = request.api_base.trim().trim_end_matches('/').to_string();
        if base.is_empty() {
            return Err(AppError::validation("apiBase is required"));
        }
        base.push_str("/chat/completions");

        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(api_key) = request.api_key {
            let key = api_key.trim();
            if !key.is_empty() {
                let token = format!("Bearer {key}");
                let value = HeaderValue::from_str(&token)
                    .map_err(|_| AppError::validation("invalid api key header"))?;
                headers.insert(AUTHORIZATION, value);
            }
        }

        let payload = json!({
            "model": request.model_id,
            "messages": request
                .messages
                .iter()
                .map(|message| {
                    json!({
                        "role": role_as_str(&message.role),
                        "content": message.content,
                    })
                })
                .collect::<Vec<Value>>(),
            "temperature": request.params.temperature,
            "max_tokens": request.params.max_tokens,
            "top_p": request.params.top_p,
            "frequency_penalty": request.params.frequency_penalty,
            "stream": false,
        });

        let response = self
            .client
            .post(base)
            .headers(headers)
            .json(&payload)
            .send()
            .await
            .map_err(|error| AppError::internal(format!("request failed: {error}")))?;

        let status = response.status();
        if !status.is_success() {
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "failed to read error body".to_string());
            return Err(AppError::internal(format!(
                "model request failed: status={}, body={}",
                status.as_u16(),
                text
            )));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|error| AppError::internal(format!("invalid response json: {error}")))?;

        let text = extract_assistant_text(&body)?;
        Ok(CompletionResponse { text })
    }
}

fn role_as_str(role: &ChatMessageRole) -> &'static str {
    match role {
        ChatMessageRole::System => "system",
        ChatMessageRole::User => "user",
        ChatMessageRole::Assistant => "assistant",
        ChatMessageRole::Tool => "tool",
    }
}

fn extract_assistant_text(body: &Value) -> AppResult<String> {
    let Some(choice) = body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
    else {
        return Err(AppError::internal(
            "model response missing choices[0]".to_string(),
        ));
    };

    let Some(message) = choice.get("message") else {
        return Err(AppError::internal(
            "model response missing choices[0].message".to_string(),
        ));
    };

    let Some(content) = message.get("content").and_then(Value::as_str) else {
        return Err(AppError::internal(
            "model response missing choices[0].message.content".to_string(),
        ));
    };

    Ok(content.to_string())
}
