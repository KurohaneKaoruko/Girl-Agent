CREATE TABLE IF NOT EXISTS workspace_chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_chat_session_participants (
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  receive_mode TEXT NOT NULL DEFAULT 'all',
  reply_mode TEXT NOT NULL DEFAULT 'all',
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, agent_id),
  FOREIGN KEY (session_id) REFERENCES workspace_chat_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  agent_id TEXT,
  visible_to_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES workspace_chat_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_chat_sessions_updated
  ON workspace_chat_sessions(is_archived, is_pinned, updated_at, id);

CREATE INDEX IF NOT EXISTS idx_workspace_chat_session_participants_agent
  ON workspace_chat_session_participants(agent_id, sort_order, session_id);

CREATE INDEX IF NOT EXISTS idx_workspace_chat_messages_session
  ON workspace_chat_messages(session_id, created_at, id);

INSERT OR IGNORE INTO workspace_chat_sessions (
  id,
  title,
  is_pinned,
  is_archived,
  tags_json,
  created_at,
  updated_at
)
SELECT
  id,
  title,
  is_pinned,
  is_archived,
  tags_json,
  created_at,
  updated_at
FROM agent_chat_sessions;

INSERT OR IGNORE INTO workspace_chat_session_participants (
  session_id,
  agent_id,
  receive_mode,
  reply_mode,
  sort_order
)
SELECT
  id,
  agent_id,
  'all',
  'all',
  0
FROM agent_chat_sessions;

INSERT OR IGNORE INTO workspace_chat_messages (
  id,
  session_id,
  role,
  content,
  agent_id,
  visible_to_json,
  created_at
)
SELECT
  id,
  COALESCE(session_id, agent_id || ':default'),
  role,
  content,
  CASE WHEN role = 'assistant' THEN agent_id ELSE NULL END,
  json_array(agent_id),
  created_at
FROM agent_chat_messages;
