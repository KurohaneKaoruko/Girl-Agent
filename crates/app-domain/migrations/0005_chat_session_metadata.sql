ALTER TABLE agent_chat_sessions ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_chat_sessions ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_chat_sessions ADD COLUMN tags_json TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_chat_sessions_agent_archive_pin_updated
  ON agent_chat_sessions(agent_id, is_archived, is_pinned, updated_at, id);
