ALTER TABLE presentation_live_sessions
  ADD COLUMN IF NOT EXISTS live_expires_at timestamptz;

UPDATE presentation_live_sessions
SET live_expires_at = CASE
  WHEN status = 'finished' THEN COALESCE(finished_at, updated_at)
  ELSE created_at + interval '24 hours'
END
WHERE live_expires_at IS NULL;

ALTER TABLE presentation_live_sessions
  ALTER COLUMN live_expires_at SET DEFAULT (now() + interval '24 hours'),
  ALTER COLUMN live_expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS presentation_live_sessions_live_expiry_idx
  ON presentation_live_sessions (live_expires_at)
  WHERE status = 'active';
