CREATE TABLE IF NOT EXISTS chats (
  chat_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  active_session_id TEXT,
  default_vision_model TEXT,
  default_transcription_model TEXT,
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
  compacted_summary TEXT,
  compacted_at TEXT,
  last_compacted_message_id TEXT,
  last_context_warning_at TEXT,
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
  content_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_session_created_idx
  ON messages (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memories (
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

CREATE INDEX IF NOT EXISTS memories_chat_status_updated_idx
  ON memories (chat_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS memories_user_status_updated_idx
  ON memories (user_id, status, updated_at DESC);

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

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  reply_to_message_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'waiting_permission', 'waiting_question', 'completed', 'failed')),
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS agent_runs_chat_status_idx
  ON agent_runs (chat_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL CHECK (tool_name IN ('web_search', 'web_fetch', 'question', 'datetime')),
  status TEXT NOT NULL CHECK (status IN ('started', 'waiting_permission', 'waiting_user', 'completed', 'failed')),
  input_json TEXT NOT NULL,
  output_json TEXT,
  summary_text TEXT,
  display_message_id INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tool_calls_run_created_idx
  ON tool_calls (run_id, created_at ASC);

CREATE TABLE IF NOT EXISTS tool_permissions (
  id TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL CHECK (tool_name IN ('web_search', 'web_fetch')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('domain', 'provider')),
  scope_value TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allow')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tool_permissions_unique_scope_idx
  ON tool_permissions (chat_id, tool_name, scope_type, scope_value);

CREATE TABLE IF NOT EXISTS pending_tool_approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL CHECK (tool_name IN ('web_search', 'web_fetch')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('domain', 'provider')),
  scope_value TEXT NOT NULL,
  request_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pending_tool_approvals_chat_idx
  ON pending_tool_approvals (chat_id, created_at ASC);

CREATE TABLE IF NOT EXISTS pending_questions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  question_kind TEXT NOT NULL CHECK (question_kind IN ('single_select', 'multi_select', 'free_text', 'confirm')),
  question_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pending_questions_chat_idx
  ON pending_questions (chat_id, created_at ASC);
