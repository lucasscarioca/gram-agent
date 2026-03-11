ALTER TABLE sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sessions ADD COLUMN title_updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN last_auto_title_message_count INTEGER NOT NULL DEFAULT 0;

UPDATE sessions
SET title_source = 'first_message',
    title_updated_at = created_at
WHERE title_source = 'default';

CREATE TABLE IF NOT EXISTS pending_chat_actions (
  chat_id INTEGER PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('rename_session')),
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
