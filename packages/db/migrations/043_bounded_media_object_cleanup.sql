ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS object_cleanup_pass smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS object_cleanup_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS object_cleanup_claim_token uuid,
  ADD COLUMN IF NOT EXISTS object_cleanup_claimed_at timestamptz;

-- Migration 041 first introduced finalized_at. Legacy clean rows without it cannot have
-- token-scoped finalization candidates. Recently finalized rows need both passes; older rows
-- only need the final catch-up sweep, rather than two immediate object-store scans.
UPDATE media_assets
SET object_cleanup_pass = CASE WHEN finalized_at <= now() - interval '6 days' THEN 1 ELSE 0 END,
    object_cleanup_due_at = CASE WHEN finalized_at <= now() - interval '6 days'
      THEN now() ELSE finalized_at END
WHERE scan_status = 'clean'
  AND finalized_at IS NOT NULL
  AND object_cleanup_pass = 0
  AND object_cleanup_due_at IS NULL;

ALTER TABLE media_assets
  DROP CONSTRAINT IF EXISTS media_assets_object_cleanup_pass_check,
  DROP CONSTRAINT IF EXISTS media_assets_object_cleanup_claim_check;

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_object_cleanup_pass_check
  CHECK (object_cleanup_pass BETWEEN 0 AND 2),
  ADD CONSTRAINT media_assets_object_cleanup_claim_check
  CHECK ((object_cleanup_claim_token IS NULL) = (object_cleanup_claimed_at IS NULL));

CREATE INDEX IF NOT EXISTS media_assets_object_cleanup_due_idx
  ON media_assets (object_cleanup_due_at, id)
  WHERE scan_status = 'clean' AND object_cleanup_pass < 2;
