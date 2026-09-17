CREATE TABLE IF NOT EXISTS workspace_institution_policies (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  contract_status text NOT NULL DEFAULT 'disabled'
    CHECK (contract_status IN ('disabled', 'pilot', 'active')),
  identity_requirement text NOT NULL DEFAULT 'guest'
    CHECK (identity_requirement IN ('guest', 'optional', 'institution')),
  oidc_enabled boolean NOT NULL DEFAULT false,
  managed_sso_enabled boolean NOT NULL DEFAULT false,
  scim_enabled boolean NOT NULL DEFAULT false,
  lti_enabled boolean NOT NULL DEFAULT false,
  nrps_enabled boolean NOT NULL DEFAULT false,
  ags_enabled boolean NOT NULL DEFAULT false,
  audit_exports_enabled boolean NOT NULL DEFAULT false,
  residency_controls_enabled boolean NOT NULL DEFAULT false,
  k12_enabled boolean NOT NULL DEFAULT false CHECK (k12_enabled = false),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    contract_status <> 'disabled'
    OR (
      identity_requirement = 'guest'
      AND NOT oidc_enabled
      AND NOT managed_sso_enabled
      AND NOT scim_enabled
      AND NOT lti_enabled
      AND NOT nrps_enabled
      AND NOT ags_enabled
      AND NOT audit_exports_enabled
      AND NOT residency_controls_enabled
    )
  ),
  CHECK (NOT scim_enabled OR managed_sso_enabled),
  CHECK (
    (NOT nrps_enabled AND NOT ags_enabled)
    OR (lti_enabled AND identity_requirement = 'institution')
  )
);

CREATE TABLE IF NOT EXISTS external_identities (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('oidc', 'lti')),
  issuer text NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 2048),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 2048),
  email_hint text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (workspace_id, provider, issuer, subject),
  UNIQUE (workspace_id, provider, issuer, user_id)
);

CREATE INDEX IF NOT EXISTS external_identities_user_idx
  ON external_identities (user_id, workspace_id, linked_at);

CREATE TABLE IF NOT EXISTS federated_auth_transactions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('login', 'link')),
  state_hash text NOT NULL UNIQUE CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  code_verifier text NOT NULL CHECK (char_length(code_verifier) BETWEEN 43 AND 128),
  nonce text NOT NULL CHECK (char_length(nonce) BETWEEN 20 AND 256),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((mode = 'login' AND user_id IS NULL) OR (mode = 'link' AND user_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS federated_auth_transactions_expiry_idx
  ON federated_auth_transactions (expires_at);

ALTER TABLE workspace_institution_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE federated_auth_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE workspace_institution_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE external_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE federated_auth_transactions FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workspace_institution_policies', 'external_identities', 'federated_auth_transactions'
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_institution_policies, external_identities, federated_auth_transactions TO openround_runtime';
  END IF;
END $$;
