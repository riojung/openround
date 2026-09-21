ALTER TABLE presentation_live_sessions
  ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz;

UPDATE presentation_live_sessions
SET retention_expires_at = COALESCE(finished_at, created_at) + interval '30 days'
WHERE retention_expires_at IS NULL;

ALTER TABLE presentation_live_sessions
  ALTER COLUMN retention_expires_at SET DEFAULT (now() + interval '30 days'),
  ALTER COLUMN retention_expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS presentation_live_sessions_retention_idx
  ON presentation_live_sessions (retention_expires_at);
