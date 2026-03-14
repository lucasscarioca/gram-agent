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
