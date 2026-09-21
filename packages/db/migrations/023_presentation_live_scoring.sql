ALTER TABLE presentation_live_sessions
  DROP CONSTRAINT IF EXISTS presentation_live_sessions_phase_check;

ALTER TABLE presentation_live_sessions
  ADD CONSTRAINT presentation_live_sessions_phase_check
  CHECK (phase IN ('lobby', 'content', 'question_open', 'question_reveal',
                   'intervention', 'finished'));

ALTER TABLE presentation_live_responses
  ADD COLUMN IF NOT EXISTS score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  ADD COLUMN IF NOT EXISTS response_ms integer NOT NULL DEFAULT 0 CHECK (response_ms >= 0);

ALTER TABLE presentation_session_timeline
  DROP CONSTRAINT IF EXISTS presentation_session_timeline_event_type_check;

ALTER TABLE presentation_session_timeline
  ADD CONSTRAINT presentation_session_timeline_event_type_check
  CHECK (event_type IN ('presentation.started', 'content.presented', 'question.launched',
                        'question.revealed', 'intervention.presented',
                        'presentation.finished'));
