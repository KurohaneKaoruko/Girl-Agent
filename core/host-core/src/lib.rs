pub use girl_ai_agent_app_contracts::{AppBootstrap, ProviderPreset, RuntimeStatusResponse};
use girl_ai_agent_app_domain::RuntimeStats;

const APP_NAME: &str = "Girl-Ai-Agent";
const API_VERSION: &str = "1.0.0";
const CHAT_GATEWAY_KIND: &str = "openai_compat";

pub fn provider_presets() -> Vec<ProviderPreset> {
    vec![
        ProviderPreset {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            api_base: "https://api.openai.com/v1".to_string(),
            supports_multi_key: true,
        },
        ProviderPreset {
            id: "anthropic".to_string(),
            name: "Anthropic".to_string(),
            api_base: "https://api.anthropic.com/v1".to_string(),
            supports_multi_key: true,
        },
        ProviderPreset {
            id: "openrouter".to_string(),
            name: "OpenRouter".to_string(),
            api_base: "https://openrouter.ai/api/v1".to_string(),
            supports_multi_key: true,
        },
        ProviderPreset {
            id: "google".to_string(),
            name: "Google Gemini".to_string(),
            api_base: "https://generativelanguage.googleapis.com/v1beta".to_string(),
            supports_multi_key: false,
        },
        ProviderPreset {
            id: "ollama".to_string(),
            name: "Ollama (Local)".to_string(),
            api_base: "http://127.0.0.1:11434/v1".to_string(),
            supports_multi_key: false,
        },
        ProviderPreset {
            id: "lmstudio".to_string(),
            name: "LM Studio (Local)".to_string(),
            api_base: "http://127.0.0.1:1234/v1".to_string(),
            supports_multi_key: false,
        },
    ]
}

pub fn build_bootstrap(app_version: &str) -> AppBootstrap {
    AppBootstrap {
        app_name: APP_NAME.to_string(),
        app_version: app_version.to_string(),
        api_version: API_VERSION.to_string(),
        provider_presets: provider_presets(),
    }
}

pub fn build_runtime_status(stats: RuntimeStats, app_version: &str) -> RuntimeStatusResponse {
    RuntimeStatusResponse {
        app_name: APP_NAME.to_string(),
        app_version: app_version.to_string(),
        api_version: API_VERSION.to_string(),
        chat_gateway_kind: CHAT_GATEWAY_KIND.to_string(),
        provider_count: stats.provider_count,
        model_count: stats.model_count,
        agent_count: stats.agent_count,
        session_count: stats.session_count,
        message_count: stats.message_count,
    }
}

#[cfg(test)]
mod tests {
    use super::{build_bootstrap, build_runtime_status, provider_presets};
    use girl_ai_agent_app_domain::RuntimeStats;

    #[test]
    fn bootstrap_uses_shared_presets() {
        let bootstrap = build_bootstrap("0.1.0");

        assert_eq!(bootstrap.app_name, "Girl-Ai-Agent");
        assert_eq!(bootstrap.provider_presets, provider_presets());
    }

    #[test]
    fn runtime_status_maps_core_stats() {
        let status = build_runtime_status(
            RuntimeStats {
                provider_count: 1,
                model_count: 2,
                agent_count: 3,
                session_count: 4,
                message_count: 5,
            },
            "0.1.0",
        );

        assert_eq!(status.chat_gateway_kind, "openai_compat");
        assert_eq!(status.session_count, 4);
        assert_eq!(status.message_count, 5);
    }
}
