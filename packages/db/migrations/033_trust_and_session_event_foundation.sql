-- Make the privacy/identity promise explicit and immutable before Verified mode is implemented.
-- Existing and legacy writers remain compatible because Learning is the database default.
ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS trust_mode text NOT NULL DEFAULT 'learning';

ALTER TABLE game_sessions
  DROP CONSTRAINT IF EXISTS game_sessions_trust_mode_check;
ALTER TABLE game_sessions
  ADD CONSTRAINT game_sessions_trust_mode_check
  CHECK (trust_mode IN ('learning', 'verified'));

CREATE OR REPLACE FUNCTION enforce_game_session_trust_mode_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.trust_mode IS DISTINCT FROM OLD.trust_mode THEN
    RAISE EXCEPTION 'session trust mode is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS game_sessions_trust_mode_immutable ON game_sessions;
CREATE TRIGGER game_sessions_trust_mode_immutable
  BEFORE UPDATE OF trust_mode ON game_sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_game_session_trust_mode_immutable();

ALTER TABLE followups
  ADD COLUMN IF NOT EXISTS trust_mode text NOT NULL DEFAULT 'learning';

ALTER TABLE followups
  DROP CONSTRAINT IF EXISTS followups_trust_mode_check;
ALTER TABLE followups
  ADD CONSTRAINT followups_trust_mode_check
  CHECK (trust_mode IN ('learning', 'verified'));

CREATE OR REPLACE FUNCTION enforce_followup_trust_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_trust_mode text;
BEGIN
  IF NEW.purpose = 'recovery' THEN
    SELECT session.trust_mode
      INTO source_trust_mode
      FROM game_sessions AS session
     WHERE session.id = NEW.source_session_id
       AND session.workspace_id = NEW.workspace_id;
    IF source_trust_mode IS NULL OR NEW.trust_mode IS DISTINCT FROM source_trust_mode THEN
      RAISE EXCEPTION 'recovery follow-up must inherit source session trust mode'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.trust_mode <> 'learning' THEN
    RAISE EXCEPTION 'verified assignments require an institution learner binding'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS followups_trust_mode_scope ON followups;
CREATE TRIGGER followups_trust_mode_scope
  BEFORE INSERT OR UPDATE OF trust_mode, purpose, workspace_id, source_session_id
  ON followups
  FOR EACH ROW EXECUTE FUNCTION enforce_followup_trust_mode();

-- Trust mode is part of the immutable assignment/recovery snapshot.
CREATE OR REPLACE FUNCTION enforce_followup_immutable_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.source_quiz_version_id IS DISTINCT FROM OLD.source_quiz_version_id
    OR NEW.source_session_id IS DISTINCT FROM OLD.source_session_id
    OR NEW.source_report_id IS DISTINCT FROM OLD.source_report_id
    OR NEW.trust_mode IS DISTINCT FROM OLD.trust_mode
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

-- Repair the dormant event journal so one command can safely emit multiple ordered events and
-- events without a command ID no longer conflict with each other.
ALTER TABLE session_events
  ADD COLUMN IF NOT EXISTS event_ordinal integer NOT NULL DEFAULT 0
    CHECK (event_ordinal >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'game_sessions'::regclass
       AND conname = 'game_sessions_workspace_id_id_key'
  ) THEN
    ALTER TABLE game_sessions
      ADD CONSTRAINT game_sessions_workspace_id_id_key UNIQUE (workspace_id, id);
  END IF;
END $$;

-- Tie the tenant discriminator to the actual parent instead of trusting a caller-supplied
-- workspace_id alongside an unrelated globally valid session UUID.
ALTER TABLE session_events
  DROP CONSTRAINT IF EXISTS session_events_session_id_fkey,
  DROP CONSTRAINT IF EXISTS session_events_workspace_session_fkey;
ALTER TABLE session_events
  ADD CONSTRAINT session_events_workspace_session_fkey
  FOREIGN KEY (workspace_id, session_id)
  REFERENCES game_sessions(workspace_id, id)
  ON DELETE CASCADE
  NOT VALID;
ALTER TABLE session_events
  VALIDATE CONSTRAINT session_events_workspace_session_fkey;

ALTER TABLE session_events
  DROP CONSTRAINT IF EXISTS session_events_session_id_command_id_key;
DROP INDEX IF EXISTS session_events_session_id_command_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS session_events_command_ordinal_uq
  ON session_events (session_id, command_id, event_ordinal)
  WHERE command_id IS NOT NULL;

ALTER TABLE session_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_isolation ON session_events;
CREATE POLICY workspace_isolation ON session_events
  USING (
    current_setting('app.system_access', true) = 'on'
    OR (
      workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
      AND EXISTS (
        SELECT 1
          FROM game_sessions AS parent_session
         WHERE parent_session.workspace_id = session_events.workspace_id
           AND parent_session.id = session_events.session_id
      )
    )
  )
  WITH CHECK (
    current_setting('app.system_access', true) = 'on'
    OR (
      workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
      AND EXISTS (
        SELECT 1
          FROM game_sessions AS parent_session
         WHERE parent_session.workspace_id = session_events.workspace_id
           AND parent_session.id = session_events.session_id
      )
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON session_events TO openround_runtime';
  END IF;
END $$;
