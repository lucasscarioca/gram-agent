ALTER TABLE runs ADD COLUMN cached_input_tokens INTEGER;
ALTER TABLE runs ADD COLUMN estimated_cost_usd REAL;

CREATE INDEX IF NOT EXISTS runs_status_created_idx
  ON runs (status, created_at DESC);
