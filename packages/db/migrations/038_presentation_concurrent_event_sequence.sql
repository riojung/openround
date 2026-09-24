-- The realtime reader derives its public, per-session mutation fence from the session revision
-- plus committed participant and response cardinalities. Keep the participant count lookup cheap
-- without exposing a process-wide sequence or assigning a fence before a transaction commits.
CREATE INDEX IF NOT EXISTS presentation_live_participants_session_fence_idx
  ON presentation_live_participants (session_id);

-- This is an expand/compatibility release. Prior application images still read the stored
-- presentation_live_sessions.event_seq, so retain both legacy bump triggers. After every serving
-- binary reads the aggregate fence, an operator may opt new response transactions out of the row
-- update. The setting is transaction-local; prior images never set it and remain rollback-safe
-- when the deployment switch is disabled before rollback.
CREATE OR REPLACE FUNCTION bump_presentation_session_event_seq()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'presentation_live_responses'
    AND current_setting('app.presentation_concurrent_response_writes', true) = 'on'
  THEN
    RETURN NEW;
  END IF;

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

-- Restore the legacy host reconciliation function verbatim so applying this migration over a
-- development database that briefly ran an earlier draft also returns to rollback-safe behavior.
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
