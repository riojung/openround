-- The enqueue trigger was committed in migration 036 before this idempotent historical scan.
-- Concurrent legacy writers can continue finishing sessions; ON CONFLICT makes their trigger
-- insert and this backfill converge without holding a writer lock on the live-session table.
INSERT INTO presentation_session_reports
  (id, workspace_id, session_id, status, schema_version, payload, generated_at,
   attempts, available_at, last_error, created_at, updated_at)
SELECT session.id, session.workspace_id, session.id, 'pending', 1, NULL, NULL,
       0, COALESCE(session.finished_at, session.updated_at), NULL,
       COALESCE(session.finished_at, session.updated_at),
       COALESCE(session.finished_at, session.updated_at)
FROM presentation_live_sessions AS session
WHERE session.status = 'finished'
ON CONFLICT (session_id) DO NOTHING;
