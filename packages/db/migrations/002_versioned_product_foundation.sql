ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS draft_schema_version smallint NOT NULL DEFAULT 1
  CHECK (draft_schema_version > 0);

ALTER TABLE quiz_versions
  ADD COLUMN IF NOT EXISTS content_schema_version smallint NOT NULL DEFAULT 1
  CHECK (content_schema_version > 0);

ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS state_schema_version smallint NOT NULL DEFAULT 1
  CHECK (state_schema_version > 0);

ALTER TABLE session_events
  ADD COLUMN IF NOT EXISTS schema_version smallint NOT NULL DEFAULT 1
  CHECK (schema_version > 0);

ALTER TABLE answers
  ADD COLUMN IF NOT EXISTS response_payload jsonb,
  ADD COLUMN IF NOT EXISTS response_schema_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS confidence smallint;

UPDATE answers
SET response_payload = jsonb_build_object(
  'kind', 'choice',
  'choiceIds', jsonb_build_array(choice_id::text)
)
WHERE response_payload IS NULL AND choice_id IS NOT NULL;

ALTER TABLE answers
  ALTER COLUMN response_payload SET NOT NULL,
  ALTER COLUMN choice_id DROP NOT NULL;

ALTER TABLE answers
  DROP CONSTRAINT IF EXISTS answers_response_schema_version_check,
  ADD CONSTRAINT answers_response_schema_version_check CHECK (response_schema_version > 0),
  DROP CONSTRAINT IF EXISTS answers_confidence_check,
  ADD CONSTRAINT answers_confidence_check CHECK (confidence BETWEEN 1 AND 3),
  DROP CONSTRAINT IF EXISTS answers_response_payload_check,
  ADD CONSTRAINT answers_response_payload_check CHECK (jsonb_typeof(response_payload) = 'object');

ALTER TABLE question_rounds
  ADD COLUMN IF NOT EXISTS round_kind text NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS source_round_id uuid,
  ADD COLUMN IF NOT EXISTS intervention_id uuid;

ALTER TABLE question_rounds
  DROP CONSTRAINT IF EXISTS question_rounds_round_kind_check,
  ADD CONSTRAINT question_rounds_round_kind_check
    CHECK (round_kind IN ('main', 'linked_recheck', 'revote')),
  DROP CONSTRAINT IF EXISTS question_rounds_session_id_position_key;

CREATE UNIQUE INDEX IF NOT EXISTS question_rounds_main_position_uq
  ON question_rounds (session_id, position)
  WHERE round_kind = 'main';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'question_rounds_source_round_fk'
  ) THEN
    ALTER TABLE question_rounds
      ADD CONSTRAINT question_rounds_source_round_fk
      FOREIGN KEY (source_round_id) REFERENCES question_rounds(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS session_interventions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  source_round_id uuid NOT NULL REFERENCES question_rounds(id) ON DELETE CASCADE,
  facilitator_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('peer_discussion', 'explain', 'example', 'break')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  linked_recheck_round_id uuid REFERENCES question_rounds(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND finished_at IS NULL)
    OR (status = 'finished' AND finished_at IS NOT NULL)
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'question_rounds_intervention_fk'
  ) THEN
    ALTER TABLE question_rounds
      ADD CONSTRAINT question_rounds_intervention_fk
      FOREIGN KEY (intervention_id) REFERENCES session_interventions(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS schema_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE reports
  DROP CONSTRAINT IF EXISTS reports_schema_version_check,
  ADD CONSTRAINT reports_schema_version_check CHECK (schema_version > 0),
  DROP CONSTRAINT IF EXISTS reports_attempts_check,
  ADD CONSTRAINT reports_attempts_check CHECK (attempts >= 0);

CREATE INDEX IF NOT EXISTS reports_generation_queue_idx
  ON reports (available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS session_interventions_session_started_idx
  ON session_interventions (session_id, started_at);

ALTER TABLE session_interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_interventions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_isolation ON session_interventions;
CREATE POLICY workspace_isolation ON session_interventions
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON session_interventions TO openround_runtime';
  END IF;
END $$;
