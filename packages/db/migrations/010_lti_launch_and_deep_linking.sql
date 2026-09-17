CREATE TABLE IF NOT EXISTS lti_platform_registrations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  issuer text NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 2048),
  client_id text NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 500),
  deployment_id text NOT NULL CHECK (char_length(deployment_id) BETWEEN 1 AND 500),
  authorization_endpoint text NOT NULL CHECK (char_length(authorization_endpoint) BETWEEN 1 AND 2048),
  token_endpoint text CHECK (token_endpoint IS NULL OR char_length(token_endpoint) BETWEEN 1 AND 2048),
  jwks_url text NOT NULL CHECK (char_length(jwks_url) BETWEEN 1 AND 2048),
  deep_link_return_origins text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('disabled', 'active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, issuer, client_id, deployment_id)
);

CREATE INDEX IF NOT EXISTS lti_platform_registrations_lookup_idx
  ON lti_platform_registrations (issuer, client_id, deployment_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS lti_login_transactions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES lti_platform_registrations(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  nonce text NOT NULL CHECK (char_length(nonce) BETWEEN 20 AND 256),
  target_link_uri text NOT NULL CHECK (char_length(target_link_uri) BETWEEN 1 AND 2048),
  lti_message_hint text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lti_login_transactions_expiry_idx
  ON lti_login_transactions (expires_at);

CREATE TABLE IF NOT EXISTS lti_launches (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES lti_platform_registrations(id) ON DELETE CASCADE,
  creator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject text CHECK (subject IS NULL OR char_length(subject) BETWEEN 1 AND 2048),
  message_type text NOT NULL
    CHECK (message_type IN ('LtiResourceLinkRequest', 'LtiDeepLinkingRequest')),
  role text NOT NULL CHECK (role IN ('instructor', 'learner')),
  target_link_uri text NOT NULL CHECK (char_length(target_link_uri) BETWEEN 1 AND 2048),
  quiz_id uuid REFERENCES quizzes(id) ON DELETE SET NULL,
  context_id text,
  resource_link_id text,
  deep_link_return_url text,
  deep_link_data text,
  link_token_hash text UNIQUE CHECK (link_token_hash IS NULL OR link_token_hash ~ '^[a-f0-9]{64}$'),
  response_jwt text,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (message_type = 'LtiDeepLinkingRequest' AND deep_link_return_url IS NOT NULL)
    OR (message_type = 'LtiResourceLinkRequest' AND deep_link_return_url IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS lti_launches_expiry_idx ON lti_launches (expires_at);
CREATE INDEX IF NOT EXISTS lti_launches_workspace_idx
  ON lti_launches (workspace_id, created_at DESC);

ALTER TABLE lti_platform_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lti_login_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lti_launches ENABLE ROW LEVEL SECURITY;

ALTER TABLE lti_platform_registrations FORCE ROW LEVEL SECURITY;
ALTER TABLE lti_login_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE lti_launches FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'lti_platform_registrations', 'lti_login_transactions', 'lti_launches'
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON lti_platform_registrations, lti_login_transactions, lti_launches TO openround_runtime';
  END IF;
END $$;
