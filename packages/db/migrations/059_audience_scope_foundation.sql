-- Additive foundation only. Round Q&A/chat/Pulse keep their original tables and sequences.
-- Feedback-room sources and interaction writers are introduced by later ordered migrations.
CREATE TABLE IF NOT EXISTS audience_scopes (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind = 'presentation'),
  identity_policy text NOT NULL CHECK (identity_policy = 'facilitator_visible_alias'),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  audience_seq bigint NOT NULL DEFAULT 1 CHECK (audience_seq BETWEEN 1 AND 9007199254740991),
  creation_idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, creation_idempotency_key),
  FOREIGN KEY (workspace_id, id)
    REFERENCES presentation_live_sessions(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scoped_audience_outbox (
  event_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope_id uuid NOT NULL,
  audience_seq bigint NOT NULL CHECK (audience_seq BETWEEN 1 AND 9007199254740991),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  event_type text NOT NULL CHECK (event_type = 'audience.scope.activated'),
  payload jsonb NOT NULL CHECK (payload = '{"kind":"presentation"}'::jsonb),
  created_at timestamptz NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  published_at timestamptz,
  UNIQUE (scope_id, audience_seq),
  FOREIGN KEY (workspace_id, scope_id) REFERENCES audience_scopes(workspace_id, id) ON DELETE CASCADE,
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS audience_scopes_workspace_expiry_idx ON audience_scopes(workspace_id, expires_at);
CREATE INDEX IF NOT EXISTS scoped_audience_outbox_pending_idx ON scoped_audience_outbox(created_at, event_id)
  WHERE published_at IS NULL;

ALTER TABLE audience_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audience_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE scoped_audience_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoped_audience_outbox FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION openround_guard_audience_scope_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.workspace_id, NEW.kind, NEW.identity_policy, NEW.schema_version,
         NEW.creation_idempotency_key, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.workspace_id, OLD.kind, OLD.identity_policy, OLD.schema_version,
         OLD.creation_idempotency_key, OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'audience scope identity and retention are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audience_scopes_identity_immutable ON audience_scopes;
CREATE TRIGGER audience_scopes_identity_immutable BEFORE UPDATE ON audience_scopes
  FOR EACH ROW EXECUTE FUNCTION openround_guard_audience_scope_identity();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['audience_scopes', 'scoped_audience_outbox'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), '''')) WITH CHECK (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), ''''))', table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    REVOKE UPDATE ON audience_scopes FROM openround_runtime;
    REVOKE UPDATE ON scoped_audience_outbox FROM openround_runtime;
    GRANT SELECT, INSERT, DELETE ON audience_scopes TO openround_runtime;
    GRANT UPDATE (audience_seq) ON audience_scopes TO openround_runtime;
    GRANT SELECT, INSERT, DELETE ON scoped_audience_outbox TO openround_runtime;
    GRANT UPDATE (lease_token, lease_until, published_at) ON scoped_audience_outbox TO openround_runtime;
  END IF;
END;
$$;
