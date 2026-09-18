ALTER TABLE session_interaction_settings
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

INSERT INTO session_interaction_settings (session_id, workspace_id, closed_at)
SELECT id, workspace_id, ended_at
FROM game_sessions
ON CONFLICT (session_id) DO NOTHING;

UPDATE session_interaction_settings AS interactions
SET closed_at = COALESCE(interactions.closed_at, sessions.ended_at),
    signals_enabled = CASE WHEN sessions.ended_at IS NULL THEN interactions.signals_enabled ELSE false END,
    chat_enabled = CASE WHEN sessions.ended_at IS NULL THEN interactions.chat_enabled ELSE false END
FROM game_sessions AS sessions
WHERE interactions.session_id = sessions.id AND sessions.ended_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS session_interaction_settings_open_idx
  ON session_interaction_settings (session_id)
  WHERE closed_at IS NULL;
