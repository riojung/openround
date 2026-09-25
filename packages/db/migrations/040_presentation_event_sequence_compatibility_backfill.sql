-- Drain session writers before establishing the compatibility baseline. EXCLUSIVE still permits
-- ordinary snapshot reads, but blocks session mutations, row locks, and child inserts while their
-- foreign keys inspect the parent. Do not lock the child tables after the parent: application
-- transactions deliberately mutate the session before inserting a participant or response.
LOCK TABLE presentation_live_sessions IN EXCLUSIVE MODE;

SELECT set_config('app.system_access', 'on', true);

CREATE TEMP TABLE presentation_event_sequence_compat_fences ON COMMIT DROP AS
WITH participant_counts AS (
  SELECT workspace_id, session_id, count(*) AS participant_count
    FROM presentation_live_participants
   GROUP BY workspace_id, session_id
), response_counts AS (
  SELECT workspace_id, session_id, count(*) AS response_count
    FROM presentation_live_responses
   GROUP BY workspace_id, session_id
)
SELECT session.workspace_id,
       session.id AS session_id,
       session.event_seq AS stored_event_seq,
       session.revision
         + COALESCE(participant_counts.participant_count, 0)
         + COALESCE(response_counts.response_count, 0) AS aggregate_event_seq
  FROM presentation_live_sessions AS session
  LEFT JOIN participant_counts
    ON participant_counts.workspace_id = session.workspace_id
   AND participant_counts.session_id = session.id
  LEFT JOIN response_counts
    ON response_counts.workspace_id = session.workspace_id
   AND response_counts.session_id = session.id;

-- A positive offset is safe for retained, expired evidence, but v038 readers do not understand it.
-- Refuse to create two sequence domains for any unexpired session; finished sessions remain
-- reconnectable until their live expiry.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM presentation_event_sequence_compat_fences AS fence
      JOIN presentation_live_sessions AS session
        ON session.workspace_id = fence.workspace_id
       AND session.id = fence.session_id
     WHERE session.live_expires_at > now()
       AND fence.stored_event_seq > fence.aggregate_event_seq
  ) THEN
    RAISE EXCEPTION
      'unexpired Presentation session has a stored event sequence above its aggregate fence; expire it before retrying migration 040'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

UPDATE presentation_live_sessions AS session
   SET event_seq_offset = GREATEST(
         fence.stored_event_seq - fence.aggregate_event_seq,
         0
       ),
       event_seq = GREATEST(fence.stored_event_seq, fence.aggregate_event_seq)
  FROM presentation_event_sequence_compat_fences AS fence
 WHERE session.workspace_id = fence.workspace_id
   AND session.id = fence.session_id;

ALTER TABLE presentation_live_sessions
  VALIDATE CONSTRAINT presentation_live_sessions_event_seq_offset_check;

-- Reconcile the proposed timeline value, stored prior-image counter, and derived public fence in
-- one locked mutation. This catches the stored counter up after optimized writes and preserves a
-- higher imported sequence exactly once.
CREATE OR REPLACE FUNCTION reconcile_presentation_timeline_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  stored_sequence bigint;
  effective_sequence bigint;
  target_sequence bigint;
  readable_session boolean;
BEGIN
  SELECT session.event_seq,
         session.event_seq_offset
           + session.revision
           + (SELECT count(*)
                FROM presentation_live_participants AS participant
               WHERE participant.session_id = session.id)
           + (SELECT count(*)
                FROM presentation_live_responses AS response
               WHERE response.session_id = session.id),
         session.live_expires_at > now()
    INTO stored_sequence, effective_sequence, readable_session
    FROM presentation_live_sessions AS session
   WHERE session.workspace_id = NEW.workspace_id
     AND session.id = NEW.session_id
   FOR UPDATE OF session;

  IF effective_sequence IS NULL THEN
    RAISE EXCEPTION 'presentation session does not exist' USING ERRCODE = '23503';
  END IF;

  target_sequence := GREATEST(NEW.sequence, stored_sequence, effective_sequence);
  IF readable_session AND target_sequence > effective_sequence THEN
    RAISE EXCEPTION
      'cannot import a Presentation event sequence above the unexpired aggregate fence'
      USING ERRCODE = '23514';
  END IF;

  UPDATE presentation_live_sessions
     SET event_seq_offset = event_seq_offset + (target_sequence - effective_sequence),
         event_seq = target_sequence
   WHERE workspace_id = NEW.workspace_id
     AND id = NEW.session_id;
  NEW.sequence := target_sequence;

  RETURN NEW;
END;
$$;
