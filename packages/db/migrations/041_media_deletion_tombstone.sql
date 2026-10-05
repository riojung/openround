ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS deletion_started_at timestamptz;

ALTER TABLE media_assets
  DROP CONSTRAINT IF EXISTS media_assets_scan_status_check,
  DROP CONSTRAINT IF EXISTS media_assets_finalization_lease_check,
  DROP CONSTRAINT IF EXISTS media_assets_deletion_tombstone_check;

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS finalization_token uuid,
  ADD COLUMN IF NOT EXISTS finalization_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_started_at timestamptz;

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_scan_status_check
  CHECK (scan_status IN ('pending', 'finalizing', 'clean', 'rejected', 'deleting'));

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_finalization_lease_check
  CHECK (
    (scan_status = 'finalizing') =
    (finalization_token IS NOT NULL AND finalization_started_at IS NOT NULL)
  );

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_deletion_tombstone_check
  CHECK ((scan_status = 'deleting') = (deletion_started_at IS NOT NULL));
