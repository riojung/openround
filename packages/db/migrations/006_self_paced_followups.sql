CREATE TABLE IF NOT EXISTS followups (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  source_report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  concept_keys text[] NOT NULL CHECK (cardinality(concept_keys) BETWEEN 1 AND 12),
  time_mode text NOT NULL CHECK (time_mode IN ('timed', 'flex')),
  generic_token_hash text NOT NULL UNIQUE,
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at < closes_at),
  CHECK (closes_at <= expires_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS followups_source_report_uq
  ON followups (source_report_id);
CREATE INDEX IF NOT EXISTS followups_expiry_idx ON followups (expires_at);

CREATE TABLE IF NOT EXISTS followup_access_tokens (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  followup_id uuid NOT NULL REFERENCES followups(id) ON DELETE CASCADE,
  source_participant_id uuid REFERENCES participants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('personal', 'accommodation')),
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 80),
  token_hash text NOT NULL UNIQUE,
  time_multiplier numeric(2,1) NOT NULL DEFAULT 1.0
    CHECK (time_multiplier IN (1.0, 1.5, 2.0)),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'personal' AND source_participant_id IS NOT NULL AND time_multiplier = 1.0)
    OR (kind = 'accommodation' AND source_participant_id IS NULL AND time_multiplier IN (1.5, 2.0))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS followup_personal_participant_uq
  ON followup_access_tokens (followup_id, source_participant_id)
  WHERE kind = 'personal';
CREATE INDEX IF NOT EXISTS followup_access_followup_idx
  ON followup_access_tokens (followup_id, created_at);

CREATE OR REPLACE FUNCTION enforce_followup_access_participant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_participant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM participants AS participant
    JOIN followups AS followup ON followup.id = NEW.followup_id
    WHERE participant.id = NEW.source_participant_id
      AND participant.session_id = followup.source_session_id
      AND followup.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'follow-up participant must belong to the source session'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS followup_access_participant_scope ON followup_access_tokens;
CREATE TRIGGER followup_access_participant_scope
  BEFORE INSERT OR UPDATE OF source_participant_id, followup_id, workspace_id
  ON followup_access_tokens
  FOR EACH ROW EXECUTE FUNCTION enforce_followup_access_participant();

CREATE TABLE IF NOT EXISTS followup_attempts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  followup_id uuid NOT NULL REFERENCES followups(id) ON DELETE CASCADE,
  access_token_id uuid REFERENCES followup_access_tokens(id) ON DELETE CASCADE,
  source_participant_id uuid REFERENCES participants(id) ON DELETE CASCADE,
  attempt_token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  phase text NOT NULL DEFAULT 'question_open'
    CHECK (phase IN ('question_open', 'answer_reveal', 'completed')),
  current_index integer NOT NULL DEFAULT 0 CHECK (current_index >= 0),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  time_multiplier numeric(2,1) NOT NULL DEFAULT 1.0
    CHECK (time_multiplier IN (1.0, 1.5, 2.0)),
  question_opened_at timestamptz NOT NULL,
  deadline_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'in_progress' AND phase <> 'completed' AND completed_at IS NULL)
    OR (status = 'completed' AND phase = 'completed' AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS followup_attempt_access_uq
  ON followup_attempts (access_token_id) WHERE access_token_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS followup_attempt_followup_idx
  ON followup_attempts (followup_id, created_at);

CREATE TABLE IF NOT EXISTS followup_answers (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  followup_id uuid NOT NULL REFERENCES followups(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES followup_attempts(id) ON DELETE CASCADE,
  checkpoint_id uuid NOT NULL,
  response_payload jsonb NOT NULL CHECK (jsonb_typeof(response_payload) = 'object'),
  response_schema_version smallint NOT NULL DEFAULT 2 CHECK (response_schema_version > 0),
  confidence smallint CHECK (confidence BETWEEN 1 AND 3),
  correct boolean,
  idempotency_key text NOT NULL,
  accepted_at timestamptz NOT NULL,
  UNIQUE (attempt_id, checkpoint_id),
  UNIQUE (attempt_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS followup_answers_followup_idx
  ON followup_answers (followup_id, accepted_at);

CREATE OR REPLACE FUNCTION enforce_followup_immutable_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.source_session_id IS DISTINCT FROM OLD.source_session_id
    OR NEW.source_report_id IS DISTINCT FROM OLD.source_report_id
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.concept_keys IS DISTINCT FROM OLD.concept_keys
    OR NEW.time_mode IS DISTINCT FROM OLD.time_mode
    OR NEW.opens_at IS DISTINCT FROM OLD.opens_at
    OR NEW.closes_at IS DISTINCT FROM OLD.closes_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'follow-up content and schedule are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS followups_immutable_content ON followups;
CREATE TRIGGER followups_immutable_content
  BEFORE UPDATE ON followups
  FOR EACH ROW EXECUTE FUNCTION enforce_followup_immutable_content();

ALTER TABLE followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE followups FORCE ROW LEVEL SECURITY;
ALTER TABLE followup_access_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE followup_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE followup_answers FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'followups', 'followup_access_tokens', 'followup_attempts', 'followup_answers'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I USING (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), '''')) WITH CHECK (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), ''''))',
      table_name
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON followups, followup_access_tokens, followup_attempts, followup_answers TO openround_runtime';
  END IF;
END $$;
