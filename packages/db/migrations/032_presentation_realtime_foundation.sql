ALTER TABLE presentation_live_sessions
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{"timeMode":"timed"}'::jsonb,
  ADD COLUMN IF NOT EXISTS trust_mode text NOT NULL DEFAULT 'learning',
  ADD COLUMN IF NOT EXISTS event_seq bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS question_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS question_closes_at timestamptz;

UPDATE presentation_live_sessions AS session
SET event_seq = timeline.max_sequence
FROM (
  SELECT session_id, COALESCE(MAX(sequence), 0) AS max_sequence
  FROM presentation_session_timeline
  GROUP BY session_id
) AS timeline
WHERE session.id = timeline.session_id
  AND session.event_seq < timeline.max_sequence;

-- Preserve an in-flight legacy question across deployment. Before this migration, updated_at was
-- the authoritative open instant, so use it once to establish the explicit window.
UPDATE presentation_live_sessions
SET question_opened_at = updated_at,
    question_closes_at = updated_at +
      COALESCE(
        ((content_snapshot -> 'blocks' -> current_block_index -> 'question'
          ->> 'timeLimitSeconds')::integer),
        0
      ) * interval '1 second'
WHERE phase = 'question_open'
  AND question_opened_at IS NULL;

ALTER TABLE presentation_live_sessions
  DROP CONSTRAINT IF EXISTS presentation_live_sessions_settings_check,
  DROP CONSTRAINT IF EXISTS presentation_live_sessions_trust_mode_check,
  DROP CONSTRAINT IF EXISTS presentation_live_sessions_event_seq_check,
  DROP CONSTRAINT IF EXISTS presentation_live_sessions_question_window_check;

ALTER TABLE presentation_live_sessions
  ADD CONSTRAINT presentation_live_sessions_settings_check
    CHECK (jsonb_typeof(settings) = 'object'
      AND settings ? 'timeMode'
      AND jsonb_typeof(settings -> 'timeMode') = 'string'
      AND settings ->> 'timeMode' IN ('timed', 'flex')),
  ADD CONSTRAINT presentation_live_sessions_trust_mode_check
    CHECK (trust_mode IN ('learning', 'verified')),
  ADD CONSTRAINT presentation_live_sessions_event_seq_check CHECK (event_seq >= 0),
  ADD CONSTRAINT presentation_live_sessions_question_window_check
    CHECK (question_closes_at IS NULL OR
      (question_opened_at IS NOT NULL AND question_closes_at >= question_opened_at));

CREATE OR REPLACE FUNCTION enforce_presentation_session_foundation_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.trust_mode IS DISTINCT FROM OLD.trust_mode
    OR NEW.settings IS DISTINCT FROM OLD.settings
  THEN
    RAISE EXCEPTION 'presentation trust mode and settings are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS presentation_session_foundation_immutable
  ON presentation_live_sessions;
CREATE TRIGGER presentation_session_foundation_immutable
  BEFORE UPDATE OF trust_mode, settings ON presentation_live_sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_presentation_session_foundation_immutable();

-- Keep the expanded columns coherent while an older application binary is still serving traffic.
-- The legacy writer increments revision and updated_at, but does not know about event_seq or the
-- explicit question window. New writers supply all three values and pass through unchanged.
CREATE OR REPLACE FUNCTION reconcile_legacy_presentation_session_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  time_limit_seconds integer;
BEGIN
  IF NEW.event_seq < OLD.event_seq THEN
    RAISE EXCEPTION 'presentation event sequence cannot decrease' USING ERRCODE = '23514';
  END IF;

  IF NEW.revision > OLD.revision AND NEW.event_seq = OLD.event_seq THEN
    NEW.event_seq := OLD.event_seq + 1;
  END IF;

  IF NEW.phase = 'question_open'
    AND (OLD.phase IS DISTINCT FROM 'question_open'
      OR NEW.current_block_index IS DISTINCT FROM OLD.current_block_index)
    AND NEW.question_opened_at IS NOT DISTINCT FROM OLD.question_opened_at
  THEN
    NEW.question_opened_at := NEW.updated_at;
    IF NEW.settings ->> 'timeMode' = 'flex' THEN
      NEW.question_closes_at := NULL;
    ELSE
      time_limit_seconds := COALESCE(
        ((NEW.content_snapshot -> 'blocks' -> NEW.current_block_index -> 'question'
          ->> 'timeLimitSeconds')::integer),
        0
      );
      NEW.question_closes_at := NEW.question_opened_at
        + time_limit_seconds * interval '1 second';
    END IF;
  ELSIF OLD.phase = 'question_open'
    AND NEW.phase IS DISTINCT FROM 'question_open'
    AND NEW.question_opened_at IS NOT DISTINCT FROM OLD.question_opened_at
    AND NEW.question_closes_at IS NOT DISTINCT FROM OLD.question_closes_at
  THEN
    NEW.question_opened_at := NULL;
    NEW.question_closes_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS presentation_session_legacy_mutation_compat
  ON presentation_live_sessions;
CREATE TRIGGER presentation_session_legacy_mutation_compat
  BEFORE UPDATE OF phase, current_block_index, revision, event_seq, updated_at
  ON presentation_live_sessions
  FOR EACH ROW EXECUTE FUNCTION reconcile_legacy_presentation_session_mutation();

ALTER TABLE presentation_live_responses
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_hash char(64);

ALTER TABLE presentation_live_responses
  DROP CONSTRAINT IF EXISTS presentation_live_responses_idempotency_key_length,
  DROP CONSTRAINT IF EXISTS presentation_live_responses_request_hash_check;
ALTER TABLE presentation_live_responses
  ADD CONSTRAINT presentation_live_responses_idempotency_key_length
    CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 160),
  ADD CONSTRAINT presentation_live_responses_request_hash_check
    CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX IF NOT EXISTS presentation_live_responses_idempotency_idx
  ON presentation_live_responses (session_id, participant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS presentation_session_command_receipts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  command_id uuid NOT NULL,
  expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
  resulting_revision bigint NOT NULL CHECK (resulting_revision > expected_revision),
  event_type text NOT NULL
    CHECK (event_type IN ('presentation.started', 'content.presented', 'question.launched',
                          'question.revealed', 'intervention.presented',
                          'presentation.finished')),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, command_id),
  FOREIGN KEY (workspace_id, session_id)
    REFERENCES presentation_live_sessions(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS presentation_session_credentials (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('host', 'companion')),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  UNIQUE (workspace_id, session_id, id),
  FOREIGN KEY (workspace_id, session_id)
    REFERENCES presentation_live_sessions(workspace_id, id) ON DELETE CASCADE
);

-- Participant joins and accepted responses are durable aggregate mutations. Advance the shared
-- sequence in the database so old and new writers cannot emit equal synchronization fences.
CREATE OR REPLACE FUNCTION bump_presentation_session_event_seq()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE presentation_live_sessions
     SET event_seq = event_seq + 1
   WHERE workspace_id = NEW.workspace_id
     AND id = NEW.session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'presentation session does not exist' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS presentation_participant_bump_event_seq
  ON presentation_live_participants;
CREATE TRIGGER presentation_participant_bump_event_seq
  AFTER INSERT ON presentation_live_participants
  FOR EACH ROW EXECUTE FUNCTION bump_presentation_session_event_seq();

DROP TRIGGER IF EXISTS presentation_response_bump_event_seq
  ON presentation_live_responses;
CREATE TRIGGER presentation_response_bump_event_seq
  AFTER INSERT ON presentation_live_responses
  FOR EACH ROW EXECUTE FUNCTION bump_presentation_session_event_seq();

-- A pre-032 writer derives timeline sequence from the timeline table and therefore cannot see
-- sequence increments caused by participant/response mutations. Fence its command event at the
-- aggregate sequence while allowing a higher imported sequence to repair the aggregate counter.
CREATE OR REPLACE FUNCTION reconcile_presentation_timeline_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  aggregate_sequence bigint;
BEGIN
  SELECT event_seq
    INTO aggregate_sequence
    FROM presentation_live_sessions
   WHERE workspace_id = NEW.workspace_id
     AND id = NEW.session_id
   FOR UPDATE;

  IF aggregate_sequence IS NULL THEN
    RAISE EXCEPTION 'presentation session does not exist' USING ERRCODE = '23503';
  ELSIF NEW.sequence < aggregate_sequence THEN
    NEW.sequence := aggregate_sequence;
  ELSIF NEW.sequence > aggregate_sequence THEN
    UPDATE presentation_live_sessions
       SET event_seq = NEW.sequence
     WHERE workspace_id = NEW.workspace_id
       AND id = NEW.session_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS presentation_timeline_reconcile_sequence
  ON presentation_session_timeline;
CREATE TRIGGER presentation_timeline_reconcile_sequence
  BEFORE INSERT ON presentation_session_timeline
  FOR EACH ROW EXECUTE FUNCTION reconcile_presentation_timeline_sequence();

CREATE INDEX IF NOT EXISTS presentation_session_command_receipts_session_idx
  ON presentation_session_command_receipts (workspace_id, session_id, received_at);
CREATE INDEX IF NOT EXISTS presentation_session_credentials_session_idx
  ON presentation_session_credentials (workspace_id, session_id, role)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS presentation_session_credentials_expiry_idx
  ON presentation_session_credentials (expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE presentation_session_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_session_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_session_command_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE presentation_session_credentials FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'presentation_session_command_receipts', 'presentation_session_credentials'
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON presentation_session_command_receipts, presentation_session_credentials TO openround_runtime';
  END IF;
END $$;
