ALTER TABLE creator_sessions
  ADD COLUMN IF NOT EXISTS active_workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_active_email_uq
  ON workspace_invitations (workspace_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS session_staff_credentials (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('cohost', 'presenter')),
  label text NOT NULL DEFAULT '',
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_staff_credentials_session_idx
  ON session_staff_credentials (session_id, created_at);

CREATE TABLE IF NOT EXISTS session_qna_settings (
  session_id uuid PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  display_mode text NOT NULL CHECK (display_mode IN ('anonymous_public', 'alias_public')),
  moderation_mode text NOT NULL CHECK (moderation_mode IN ('pre', 'post')),
  participant_replies boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qna_questions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  public_alias text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'published', 'answered', 'dismissed', 'removed')),
  label text CHECK (label IS NULL OR char_length(label) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qna_questions_session_cursor_idx
  ON qna_questions (session_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS qna_replies (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES qna_questions(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES participants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  staff_credential_id uuid REFERENCES session_staff_credentials(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  public_alias text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'published', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(participant_id, actor_id, staff_credential_id) = 1)
);

CREATE INDEX IF NOT EXISTS qna_replies_question_cursor_idx
  ON qna_replies (question_id, created_at, id);

CREATE TABLE IF NOT EXISTS qna_votes (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES qna_questions(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, participant_id)
);

CREATE TABLE IF NOT EXISTS qna_bans (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, participant_id)
);

ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_staff_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_qna_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE qna_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qna_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE qna_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE qna_bans ENABLE ROW LEVEL SECURITY;

ALTER TABLE workspace_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE session_staff_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE session_qna_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE qna_questions FORCE ROW LEVEL SECURITY;
ALTER TABLE qna_replies FORCE ROW LEVEL SECURITY;
ALTER TABLE qna_votes FORCE ROW LEVEL SECURITY;
ALTER TABLE qna_bans FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workspace_invitations', 'session_staff_credentials', 'session_qna_settings',
    'qna_questions', 'qna_replies', 'qna_votes', 'qna_bans'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I USING (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), '''')) WITH CHECK (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), ''''))',
      table_name
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_invitations, session_staff_credentials, session_qna_settings, qna_questions, qna_replies, qna_votes, qna_bans TO openround_runtime';
  END IF;
END $$;
