-- Additive Presentation Q&A. Legacy Round foreign keys and wire formats are unchanged.
ALTER TABLE scoped_audience_outbox DROP CONSTRAINT IF EXISTS scoped_audience_outbox_event_type_check;
ALTER TABLE scoped_audience_outbox ADD CONSTRAINT scoped_audience_outbox_event_type_check
  CHECK (event_type IN ('audience.scope.activated', 'audience.qna.updated'));

CREATE TABLE IF NOT EXISTS scoped_qna_settings (
  workspace_id uuid NOT NULL,
  scope_id uuid PRIMARY KEY,
  enabled boolean NOT NULL,
  display_mode text NOT NULL CHECK (display_mode IN ('anonymous_public', 'alias_public')),
  moderation_mode text NOT NULL CHECK (moderation_mode IN ('pre', 'post')),
  participant_replies boolean NOT NULL DEFAULT false CHECK (NOT participant_replies),
  FOREIGN KEY (workspace_id, scope_id) REFERENCES audience_scopes(workspace_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS scoped_qna_questions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  public_alias text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'published', 'answered', 'dismissed', 'removed')),
  label text CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, scope_id, id),
  FOREIGN KEY (workspace_id, scope_id) REFERENCES audience_scopes(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, scope_id, participant_id)
    REFERENCES presentation_live_participants(workspace_id, session_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS scoped_qna_questions_page_idx ON scoped_qna_questions(workspace_id, scope_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS scoped_qna_votes (
  workspace_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  question_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  PRIMARY KEY (scope_id, question_id, participant_id),
  FOREIGN KEY (workspace_id, scope_id, question_id) REFERENCES scoped_qna_questions(workspace_id, scope_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, scope_id, participant_id) REFERENCES presentation_live_participants(workspace_id, session_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS scoped_qna_bans (
  workspace_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  PRIMARY KEY (scope_id, participant_id),
  FOREIGN KEY (workspace_id, scope_id) REFERENCES audience_scopes(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, scope_id, participant_id) REFERENCES presentation_live_participants(workspace_id, session_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS scoped_qna_receipts (
  workspace_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  receipt jsonb NOT NULL,
  PRIMARY KEY (scope_id, actor_id, idempotency_key),
  FOREIGN KEY (workspace_id, scope_id) REFERENCES audience_scopes(workspace_id, id) ON DELETE CASCADE
);
-- Bounded, durable per-minute limits work across processes, including Redis disruption.
CREATE TABLE IF NOT EXISTS scoped_qna_rate_limits (
  workspace_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('question.create', 'vote.set', 'question.moderate', 'settings.update')),
  window_started_at timestamptz NOT NULL,
  action_count integer NOT NULL CHECK (action_count BETWEEN 1 AND 120),
  PRIMARY KEY (scope_id, actor_id, action),
  FOREIGN KEY (workspace_id, scope_id) REFERENCES audience_scopes(workspace_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS scoped_qna_audit (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('question.moderate', 'settings.update')),
  resource_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (workspace_id, scope_id) REFERENCES audience_scopes(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, scope_id, credential_id) REFERENCES presentation_session_credentials(workspace_id, session_id, id) ON DELETE CASCADE
);
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['scoped_qna_settings', 'scoped_qna_questions', 'scoped_qna_votes', 'scoped_qna_bans', 'scoped_qna_receipts', 'scoped_qna_rate_limits', 'scoped_qna_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), '''')) WITH CHECK (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), ''''))', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO openround_runtime', table_name);
    END IF;
  END LOOP;
END;
$$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    REVOKE UPDATE ON scoped_qna_receipts, scoped_qna_audit FROM openround_runtime;
  END IF;
END;
$$;
