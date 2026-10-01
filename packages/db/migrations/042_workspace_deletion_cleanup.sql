-- Account deletion must retain an object-store cleanup instruction after the workspace row and
-- media metadata have been cascaded. The final sweep runs only after every presigned PUT issued
-- before the deletion fence has expired.
CREATE TABLE IF NOT EXISTS workspace_media_deletion_jobs (
  workspace_id uuid PRIMARY KEY,
  deletion_started_at timestamptz NOT NULL,
  sweep_after timestamptz NOT NULL,
  CONSTRAINT workspace_media_deletion_jobs_window_check
    CHECK (sweep_after >= deletion_started_at + interval '11 minutes')
);

CREATE INDEX IF NOT EXISTS workspace_media_deletion_jobs_due_idx
  ON workspace_media_deletion_jobs (sweep_after, workspace_id);

ALTER TABLE workspace_media_deletion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_media_deletion_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_media_deletion_jobs_access ON workspace_media_deletion_jobs;
CREATE POLICY workspace_media_deletion_jobs_access ON workspace_media_deletion_jobs
  USING (
    current_setting('app.system_access', true) = 'on'
    OR workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
  )
  WITH CHECK (
    current_setting('app.system_access', true) = 'on'
    OR workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON workspace_media_deletion_jobs TO openround_runtime';
  END IF;
END $$;
