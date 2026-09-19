CREATE INDEX IF NOT EXISTS quiz_versions_workspace_quiz_idx
  ON quiz_versions (workspace_id, quiz_id, id);

CREATE INDEX IF NOT EXISTS game_sessions_workspace_version_created_idx
  ON game_sessions (workspace_id, quiz_version_id, created_at DESC)
  WHERE deleted_at IS NULL;
