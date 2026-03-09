ALTER TABLE agents ADD COLUMN component_asr_params_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN component_tts_params_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN component_vision_params_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN tool_planner_params_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN tool_executor_params_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN reply_params_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN decision_params_json TEXT NOT NULL DEFAULT '{}';
