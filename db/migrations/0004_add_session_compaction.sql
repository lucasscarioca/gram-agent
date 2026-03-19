ALTER TABLE sessions ADD COLUMN compacted_summary TEXT;
ALTER TABLE sessions ADD COLUMN compacted_at TEXT;
ALTER TABLE sessions ADD COLUMN last_compacted_message_id TEXT;
ALTER TABLE sessions ADD COLUMN last_context_warning_at TEXT;
