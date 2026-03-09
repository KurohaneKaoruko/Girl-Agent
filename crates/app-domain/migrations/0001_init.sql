CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL UNIQUE,
  provider_kind TEXT NOT NULL,
  api_base TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  api_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_keys_provider_id ON provider_keys(provider_id);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider_ref TEXT,
  custom_provider_json TEXT,
  model_id TEXT NOT NULL,
  category TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  params_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_ref) REFERENCES providers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_models_provider_ref ON models(provider_ref);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  persona TEXT NOT NULL,
  speech_rules TEXT NOT NULL,
  mode TEXT NOT NULL,
  component_asr_model_id TEXT,
  component_tts_model_id TEXT,
  component_vision_model_id TEXT,
  tool_planner_model_id TEXT,
  tool_executor_model_id TEXT,
  reply_model_id TEXT NOT NULL,
  decision_enabled INTEGER NOT NULL DEFAULT 0,
  decision_model_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (component_asr_model_id) REFERENCES models(id) ON DELETE RESTRICT,
  FOREIGN KEY (component_tts_model_id) REFERENCES models(id) ON DELETE RESTRICT,
  FOREIGN KEY (component_vision_model_id) REFERENCES models(id) ON DELETE RESTRICT,
  FOREIGN KEY (tool_planner_model_id) REFERENCES models(id) ON DELETE RESTRICT,
  FOREIGN KEY (tool_executor_model_id) REFERENCES models(id) ON DELETE RESTRICT,
  FOREIGN KEY (reply_model_id) REFERENCES models(id) ON DELETE RESTRICT,
  FOREIGN KEY (decision_model_id) REFERENCES models(id) ON DELETE RESTRICT
);
