CREATE TABLE IF NOT EXISTS chats (
  chat_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  active_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  title_source TEXT NOT NULL,
  title_updated_at TEXT NOT NULL,
  last_auto_title_message_count INTEGER NOT NULL DEFAULT 0,
  selected_model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_chat_last_message_idx
  ON sessions (chat_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  telegram_message_id INTEGER,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_session_created_idx
  ON messages (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  update_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  error TEXT,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd REAL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS runs_status_created_idx
  ON runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS pending_chat_actions (
  chat_id INTEGER PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('rename_session')),
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
