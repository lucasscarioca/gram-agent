CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('user', 'chat')),
  kind TEXT NOT NULL CHECK (kind IN ('note', 'preference', 'constraint', 'profile', 'project', 'fact')),
  content_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  source_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX memories_chat_status_updated_idx
  ON memories (chat_id, status, updated_at DESC);

CREATE INDEX memories_user_status_updated_idx
  ON memories (user_id, status, updated_at DESC);
