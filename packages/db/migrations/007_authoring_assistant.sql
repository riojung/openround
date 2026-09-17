CREATE TABLE IF NOT EXISTS authoring_jobs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('pasted_text', 'pdf', 'docx', 'pptx')),
  source_name text NOT NULL CHECK (char_length(source_name) BETWEEN 1 AND 200),
  source_mime_type text,
  source_text text,
  source_blob bytea,
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  output jsonb,
  last_error text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(source_text, source_blob) <= 1),
  CHECK (output IS NULL OR jsonb_typeof(output) = 'object')
);

CREATE INDEX IF NOT EXISTS authoring_jobs_queue_idx
  ON authoring_jobs (available_at, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS authoring_jobs_workspace_created_idx
  ON authoring_jobs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS authoring_jobs_expiry_idx ON authoring_jobs (expires_at);

ALTER TABLE authoring_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE authoring_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_isolation ON authoring_jobs;
CREATE POLICY workspace_isolation ON authoring_jobs
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON authoring_jobs TO openround_runtime';
  END IF;
END $$;
