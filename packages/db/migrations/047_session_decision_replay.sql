-- Freeze the decision-replay rollout for each new session. Existing sessions remain readable
-- without inventing a history that was never captured.
ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS decision_replay_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION enforce_game_session_decision_replay_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.decision_replay_enabled IS DISTINCT FROM OLD.decision_replay_enabled THEN
    RAISE EXCEPTION 'session decision replay setting is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS game_sessions_decision_replay_immutable ON game_sessions;
CREATE TRIGGER game_sessions_decision_replay_immutable
  BEFORE UPDATE OF decision_replay_enabled ON game_sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_game_session_decision_replay_immutable();
