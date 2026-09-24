-- A single namespace prevents a seven-digit code from routing to both a Round and a Presentation.
CREATE TABLE IF NOT EXISTS live_room_codes (
  code char(7) PRIMARY KEY CHECK (code ~ '^[0-9]{7}$'),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK (artifact_type IN ('round', 'presentation')),
  artifact_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_type, artifact_id)
);

-- Legacy application binaries can continue creating either room type while this migration runs.
-- Drain those writers, then hold both tables until the registry backfill and INSERT triggers commit
-- so no active room can land between its source-table scan and trigger installation.
LOCK TABLE game_sessions, presentation_live_sessions IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM game_sessions AS round_session
      JOIN presentation_live_sessions AS presentation_session
        ON presentation_session.join_code = round_session.code
     WHERE round_session.ended_at IS NULL
       AND round_session.deleted_at IS NULL
       AND round_session.expires_at > now()
       AND presentation_session.status = 'active'
       AND presentation_session.live_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'active Round and Presentation room codes overlap; resolve before migrating'
      USING ERRCODE = '23505';
  END IF;
END $$;

INSERT INTO live_room_codes
  (code, workspace_id, artifact_type, artifact_id, expires_at, released_at, created_at)
SELECT code, workspace_id, 'round', id, expires_at,
       NULL,
       created_at
  FROM game_sessions
 WHERE ended_at IS NULL AND deleted_at IS NULL AND expires_at > now()
ON CONFLICT (artifact_type, artifact_id) DO NOTHING;

INSERT INTO live_room_codes
  (code, workspace_id, artifact_type, artifact_id, expires_at, released_at, created_at)
SELECT join_code, workspace_id, 'presentation', id, live_expires_at,
       NULL,
       created_at
  FROM presentation_live_sessions
 WHERE status = 'active' AND live_expires_at > now()
ON CONFLICT (artifact_type, artifact_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS live_room_codes_active_expiry_idx
  ON live_room_codes (expires_at)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS live_room_codes_workspace_created_idx
  ON live_room_codes (workspace_id, created_at DESC);

CREATE OR REPLACE FUNCTION claim_live_room_code(
  requested_code char(7),
  requested_workspace_id uuid,
  requested_artifact_type text,
  requested_artifact_id uuid,
  requested_expires_at timestamptz,
  requested_created_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prior_system_access text;
BEGIN
  prior_system_access := current_setting('app.system_access', true);
  PERFORM set_config('app.system_access', 'on', true);

  DELETE FROM live_room_codes
   WHERE code = requested_code
     AND (released_at IS NOT NULL OR expires_at <= now());

  INSERT INTO live_room_codes
    (code, workspace_id, artifact_type, artifact_id, expires_at, created_at)
  VALUES
    (requested_code, requested_workspace_id, requested_artifact_type, requested_artifact_id,
     requested_expires_at, requested_created_at);

  PERFORM set_config('app.system_access', COALESCE(prior_system_access, ''), true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.system_access', COALESCE(prior_system_access, ''), true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION claim_live_room_code(char(7), uuid, text, uuid, timestamptz, timestamptz)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION claim_live_room_code(char(7), uuid, text, uuid, timestamptz, timestamptz) FROM openround_runtime';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION register_round_room_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM claim_live_room_code(
    NEW.code, NEW.workspace_id, 'round', NEW.id, NEW.expires_at, NEW.created_at
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION register_round_room_code() FROM PUBLIC;

CREATE OR REPLACE FUNCTION update_round_room_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE live_room_codes
     SET expires_at = NEW.expires_at,
         released_at = CASE
           WHEN NEW.ended_at IS NOT NULL OR NEW.deleted_at IS NOT NULL OR NEW.expires_at <= now()
             THEN COALESCE(NEW.ended_at, NEW.updated_at, now())
           ELSE NULL
         END
   WHERE artifact_type = 'round' AND artifact_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION delete_round_room_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM live_room_codes
   WHERE artifact_type = 'round'
     AND artifact_id = OLD.id
     AND workspace_id = OLD.workspace_id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_round_room_code_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'live room code is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION register_presentation_room_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM claim_live_room_code(
    NEW.join_code, NEW.workspace_id, 'presentation', NEW.id, NEW.live_expires_at, NEW.created_at
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION register_presentation_room_code() FROM PUBLIC;

CREATE OR REPLACE FUNCTION update_presentation_room_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE live_room_codes
     SET expires_at = NEW.live_expires_at,
         released_at = CASE
           WHEN NEW.status <> 'active' OR NEW.live_expires_at <= now()
             THEN COALESCE(NEW.finished_at, NEW.updated_at, now())
           ELSE NULL
         END
   WHERE artifact_type = 'presentation' AND artifact_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION delete_presentation_room_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM live_room_codes
   WHERE artifact_type = 'presentation'
     AND artifact_id = OLD.id
     AND workspace_id = OLD.workspace_id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_presentation_room_code_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.join_code IS DISTINCT FROM OLD.join_code THEN
    RAISE EXCEPTION 'live room code is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS game_sessions_register_room_code ON game_sessions;
CREATE TRIGGER game_sessions_register_room_code
  AFTER INSERT ON game_sessions
  FOR EACH ROW EXECUTE FUNCTION register_round_room_code();

DROP TRIGGER IF EXISTS game_sessions_room_code_immutable ON game_sessions;
CREATE TRIGGER game_sessions_room_code_immutable
  BEFORE UPDATE OF code ON game_sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_round_room_code_immutable();

DROP TRIGGER IF EXISTS game_sessions_update_room_code ON game_sessions;
CREATE TRIGGER game_sessions_update_room_code
  AFTER UPDATE OF ended_at, deleted_at, expires_at ON game_sessions
  FOR EACH ROW EXECUTE FUNCTION update_round_room_code();

DROP TRIGGER IF EXISTS game_sessions_delete_room_code ON game_sessions;
CREATE TRIGGER game_sessions_delete_room_code
  AFTER DELETE ON game_sessions
  FOR EACH ROW EXECUTE FUNCTION delete_round_room_code();

DROP TRIGGER IF EXISTS presentation_sessions_register_room_code ON presentation_live_sessions;
CREATE TRIGGER presentation_sessions_register_room_code
  AFTER INSERT ON presentation_live_sessions
  FOR EACH ROW EXECUTE FUNCTION register_presentation_room_code();

DROP TRIGGER IF EXISTS presentation_sessions_room_code_immutable
  ON presentation_live_sessions;
CREATE TRIGGER presentation_sessions_room_code_immutable
  BEFORE UPDATE OF join_code ON presentation_live_sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_presentation_room_code_immutable();

DROP TRIGGER IF EXISTS presentation_sessions_update_room_code ON presentation_live_sessions;
CREATE TRIGGER presentation_sessions_update_room_code
  AFTER UPDATE OF status, finished_at, live_expires_at ON presentation_live_sessions
  FOR EACH ROW EXECUTE FUNCTION update_presentation_room_code();

DROP TRIGGER IF EXISTS presentation_sessions_delete_room_code
  ON presentation_live_sessions;
CREATE TRIGGER presentation_sessions_delete_room_code
  AFTER DELETE ON presentation_live_sessions
  FOR EACH ROW EXECUTE FUNCTION delete_presentation_room_code();

ALTER TABLE live_room_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_room_codes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_isolation ON live_room_codes;
DROP POLICY IF EXISTS live_room_codes_select ON live_room_codes;
DROP POLICY IF EXISTS live_room_codes_insert ON live_room_codes;
DROP POLICY IF EXISTS live_room_codes_update ON live_room_codes;
DROP POLICY IF EXISTS live_room_codes_delete_expired ON live_room_codes;

CREATE POLICY live_room_codes_select ON live_room_codes
  FOR SELECT
  USING (
    current_setting('app.system_access', true) = 'on'
    OR workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
  );

CREATE POLICY live_room_codes_insert ON live_room_codes
  FOR INSERT
  WITH CHECK (
    current_setting('app.system_access', true) = 'on'
    OR workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
  );

CREATE POLICY live_room_codes_update ON live_room_codes
  FOR UPDATE
  USING (
    current_setting('app.system_access', true) = 'on'
    OR workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
  )
  WITH CHECK (
    current_setting('app.system_access', true) = 'on'
    OR workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
  );

-- Claiming a code may clean up an expired/released row from another workspace, but never permits
-- reading or mutating an active row from that workspace.
CREATE POLICY live_room_codes_delete_expired ON live_room_codes
  FOR DELETE
  USING (
    current_setting('app.system_access', true) = 'on'
    OR workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
    OR released_at IS NOT NULL
    OR expires_at <= now()
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON live_room_codes TO openround_runtime';
  END IF;
END $$;
