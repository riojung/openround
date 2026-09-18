CREATE INDEX IF NOT EXISTS game_sessions_workspace_created_cursor_idx
  ON game_sessions (workspace_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS reports_workspace_created_cursor_idx
  ON reports (workspace_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS followups_workspace_created_cursor_idx
  ON followups (workspace_id, created_at DESC, id DESC);

ALTER TABLE session_staff_credentials
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'collaboration';

ALTER TABLE session_staff_credentials
  DROP CONSTRAINT IF EXISTS session_staff_credentials_purpose_check;
ALTER TABLE session_staff_credentials
  ADD CONSTRAINT session_staff_credentials_purpose_check
  CHECK (
    purpose IN ('collaboration', 'creator_resume')
    AND (purpose <> 'creator_resume' OR role = 'cohost')
  );

CREATE UNIQUE INDEX IF NOT EXISTS session_staff_creator_resume_active_uq
  ON session_staff_credentials (session_id, created_by)
  WHERE purpose = 'creator_resume' AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS product_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (event_name IN (
    'creation_started', 'creation_completed', 'setup_recipe_selected',
    'rehearsal_started', 'rehearsal_completed'
  )),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(dimensions) = 'object'
    AND dimensions - ARRAY[
      'creationPath', 'recipe', 'scenario', 'segment', 'betaVersion', 'durationBucket'
    ]::text[] = '{}'::jsonb
    AND (dimensions->>'creationPath' IS NULL OR dimensions->>'creationPath' IN (
      'starter', 'source', 'import', 'blank'
    ))
    AND (dimensions->>'recipe' IS NULL OR dimensions->>'recipe' IN (
      'recovery', 'friendly_competition', 'open_discussion'
    ))
    AND (dimensions->>'scenario' IS NULL OR dimensions->>'scenario' IN (
      'low_participation', 'split_room', 'confident_misconception'
    ))
    AND (dimensions->>'segment' IS NULL OR dimensions->>'segment' IN (
      'education', 'workplace'
    ))
    AND (dimensions->>'betaVersion' IS NULL OR dimensions->>'betaVersion' = 'p0-2026')
    AND (dimensions->>'durationBucket' IS NULL OR dimensions->>'durationBucket' IN (
      'under_1m', '1_to_5m', '5_to_15m', 'over_15m'
    ))
  ),
  occurred_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    expires_at > created_at
    AND extract(epoch FROM (expires_at - created_at)) <= 2592000
  )
);

CREATE INDEX IF NOT EXISTS product_events_workspace_created_idx
  ON product_events (workspace_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS product_events_expiry_idx
  ON product_events (expires_at);

ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON product_events;
CREATE POLICY workspace_isolation ON product_events
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON product_events TO openround_runtime';
  END IF;
END $$;
