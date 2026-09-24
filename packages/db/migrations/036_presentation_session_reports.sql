CREATE TABLE IF NOT EXISTS presentation_session_reports (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'failed')),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  payload jsonb,
  generated_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, session_id),
  FOREIGN KEY (workspace_id, session_id)
    REFERENCES presentation_live_sessions(workspace_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'ready' AND payload IS NOT NULL AND generated_at IS NOT NULL)
    OR (status IN ('pending', 'failed') AND payload IS NULL AND generated_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS presentation_session_reports_generation_queue_idx
  ON presentation_session_reports (available_at, created_at, id)
  WHERE status = 'pending';

ALTER TABLE presentation_session_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_session_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_isolation ON presentation_session_reports;
CREATE POLICY workspace_isolation ON presentation_session_reports
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON presentation_session_reports TO openround_runtime';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enqueue_presentation_session_report()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'finished' THEN
    INSERT INTO presentation_session_reports
      (id, workspace_id, session_id, status, schema_version, payload, generated_at,
       attempts, available_at, last_error, created_at, updated_at)
    VALUES
      (NEW.id, NEW.workspace_id, NEW.id, 'pending', 1, NULL, NULL,
       0, COALESCE(NEW.finished_at, NEW.updated_at), NULL,
       COALESCE(NEW.finished_at, NEW.updated_at), COALESCE(NEW.finished_at, NEW.updated_at))
    ON CONFLICT (session_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS presentation_session_enqueue_report ON presentation_live_sessions;
CREATE TRIGGER presentation_session_enqueue_report
  AFTER INSERT OR UPDATE OF status ON presentation_live_sessions
  FOR EACH ROW EXECUTE FUNCTION enqueue_presentation_session_report();
