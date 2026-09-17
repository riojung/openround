CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  locale text NOT NULL DEFAULT 'en-CA',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  segment text NOT NULL CHECK (segment IN ('education', 'workplace')),
  owner_id uuid NOT NULL REFERENCES users(id),
  home_region text NOT NULL DEFAULT 'ca-central-1',
  retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 3650),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS brand_theme jsonb;

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS auth_magic_tokens (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  segment text NOT NULL CHECK (segment IN ('education', 'workplace')),
  token_hash text NOT NULL UNIQUE,
  policy_version text NOT NULL DEFAULT 'unversioned',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auth_magic_tokens
  ADD COLUMN IF NOT EXISTS policy_version text NOT NULL DEFAULT 'unversioned';

CREATE TABLE IF NOT EXISTS creator_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quizzes (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  draft jsonb NOT NULL,
  current_version_id uuid,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  version integer NOT NULL,
  content jsonb NOT NULL,
  content_hash text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, version),
  UNIQUE (quiz_id, content_hash)
);

ALTER TABLE quizzes
  DROP CONSTRAINT IF EXISTS quizzes_current_version_fk;
ALTER TABLE quizzes
  ADD CONSTRAINT quizzes_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES quiz_versions(id);

CREATE OR REPLACE FUNCTION reject_quiz_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'published quiz versions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quiz_versions_immutable ON quiz_versions;
CREATE TRIGGER quiz_versions_immutable
  BEFORE UPDATE ON quiz_versions
  FOR EACH ROW EXECUTE FUNCTION reject_quiz_version_mutation();

CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'rejected')),
  alt_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_assets_scan_created_idx
  ON media_assets (scan_status, created_at)
  WHERE scan_status <> 'clean';

CREATE TABLE IF NOT EXISTS game_sessions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quiz_version_id uuid NOT NULL REFERENCES quiz_versions(id),
  host_id uuid NOT NULL REFERENCES users(id),
  code char(7) NOT NULL,
  state text NOT NULL,
  version integer NOT NULL DEFAULT 0,
  seq bigint NOT NULL DEFAULT 0,
  deadline timestamptz,
  settings jsonb NOT NULL,
  state_snapshot jsonb NOT NULL,
  host_token_hash text NOT NULL UNIQUE,
  ended_at timestamptz,
  deleted_at timestamptz,
  expires_at timestamptz NOT NULL,
  retention_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS game_sessions_active_code_uq
  ON game_sessions (code)
  WHERE ended_at IS NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  nickname text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'kicked')),
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  accepted_response_ms bigint NOT NULL DEFAULT 0 CHECK (accepted_response_ms >= 0),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS question_rounds (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL,
  position integer NOT NULL,
  opened_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  locked_at timestamptz,
  UNIQUE (session_id, position)
);

CREATE TABLE IF NOT EXISTS answers (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  round_id uuid NOT NULL,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  choice_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL,
  response_ms integer NOT NULL CHECK (response_ms >= 0),
  score integer NOT NULL CHECK (score >= 0),
  correct boolean NOT NULL,
  idempotency_key text NOT NULL,
  UNIQUE (round_id, participant_id),
  UNIQUE (session_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS session_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  command_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (session_id, seq),
  UNIQUE NULLS NOT DISTINCT (session_id, command_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL UNIQUE REFERENCES game_sessions(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  metrics jsonb NOT NULL,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_customer_id text UNIQUE,
  provider_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'free',
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team')),
  current_period_end timestamptz,
  last_event_created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS last_event_created_at timestamptz;

UPDATE game_sessions AS session
SET retention_expires_at = GREATEST(
  session.expires_at,
  session.created_at + CASE
    WHEN COALESCE(
      (SELECT subscription.plan FROM subscriptions AS subscription
       WHERE subscription.workspace_id = session.workspace_id),
      'free'
    ) IN ('pro', 'team') THEN interval '365 days'
    ELSE interval '30 days'
  END
)
WHERE session.retention_expires_at IS NULL;

ALTER TABLE game_sessions
  ALTER COLUMN retention_expires_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS billing_events (
  provider_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  provider_created_at timestamptz,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE billing_events
  ADD COLUMN IF NOT EXISTS provider_created_at timestamptz;

CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  document_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS consent_records_document_uq
  ON consent_records (workspace_id, user_id, document_type, document_version);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  request_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operational_settings (
  id text PRIMARY KEY CHECK (id = 'global'),
  signups_enabled boolean NOT NULL DEFAULT true,
  session_creation_enabled boolean NOT NULL DEFAULT true,
  media_uploads_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO operational_settings (id)
VALUES ('global')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS quizzes_workspace_updated_idx ON quizzes (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS participants_session_idx ON participants (session_id);
CREATE INDEX IF NOT EXISTS answers_session_idx ON answers (session_id);
CREATE INDEX IF NOT EXISTS session_events_replay_idx ON session_events (session_id, seq);
CREATE INDEX IF NOT EXISTS game_sessions_live_expiry_idx
  ON game_sessions (expires_at) WHERE ended_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS game_sessions_retention_expiry_idx
  ON game_sessions (retention_expires_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS audit_events_workspace_created_idx ON audit_events (workspace_id, created_at DESC);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_magic_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_magic_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE creator_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_members FORCE ROW LEVEL SECURITY;
ALTER TABLE quizzes FORCE ROW LEVEL SECURITY;
ALTER TABLE quiz_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE media_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE game_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE participants FORCE ROW LEVEL SECURITY;
ALTER TABLE question_rounds FORCE ROW LEVEL SECURITY;
ALTER TABLE answers FORCE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_isolation ON workspaces;
CREATE POLICY workspace_isolation ON workspaces
  USING (
    current_setting('app.system_access', true) = 'on'
    OR id::text = nullif(current_setting('app.workspace_id', true), '')
  )
  WITH CHECK (
    current_setting('app.system_access', true) = 'on'
    OR id::text = nullif(current_setting('app.workspace_id', true), '')
  );

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'auth_magic_tokens', 'creator_sessions', 'billing_events', 'operational_settings'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS system_only ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY system_only ON %I USING (current_setting(''app.system_access'', true) = ''on'') WITH CHECK (current_setting(''app.system_access'', true) = ''on'')',
      table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS session_workspace_isolation ON participants;
CREATE POLICY session_workspace_isolation ON participants
  USING (
    current_setting('app.system_access', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM game_sessions
      WHERE game_sessions.id = participants.session_id
        AND game_sessions.workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.system_access', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM game_sessions
      WHERE game_sessions.id = participants.session_id
        AND game_sessions.workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
    )
  );

DROP POLICY IF EXISTS session_workspace_isolation ON question_rounds;
CREATE POLICY session_workspace_isolation ON question_rounds
  USING (
    current_setting('app.system_access', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM game_sessions
      WHERE game_sessions.id = question_rounds.session_id
        AND game_sessions.workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.system_access', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM game_sessions
      WHERE game_sessions.id = question_rounds.session_id
        AND game_sessions.workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
    )
  );

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workspace_members', 'quizzes', 'quiz_versions', 'media_assets', 'game_sessions',
    'answers', 'reports', 'subscriptions', 'consent_records', 'audit_events'
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
    EXECUTE 'GRANT USAGE ON SCHEMA public TO openround_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openround_runtime';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO openround_runtime';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO openround_runtime';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO openround_runtime';
  END IF;
END $$;
