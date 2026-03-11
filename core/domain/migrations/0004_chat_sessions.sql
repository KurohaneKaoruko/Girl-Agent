CREATE TABLE IF NOT EXISTS agent_chat_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_chat_sessions_agent_default
  ON agent_chat_sessions(agent_id)
  WHERE is_default = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_chat_sessions_agent_title
  ON agent_chat_sessions(agent_id, title);

ALTER TABLE agent_chat_messages ADD COLUMN session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_chat_messages_agent_session_rowid
  ON agent_chat_messages(agent_id, session_id, created_at, id);

INSERT OR IGNORE INTO agent_chat_sessions (id, agent_id, title, is_default)
SELECT id || ':default', id, '默认会话', 1
FROM agents;

UPDATE agent_chat_messages
SET session_id = agent_id || ':default'
WHERE session_id IS NULL;
