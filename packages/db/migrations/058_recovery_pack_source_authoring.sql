-- Source jobs are short lived. Preserve only the bounded source spans and provenance needed
-- to review the Pack, without an authoring_jobs FK that would erase approval on job expiry.
CREATE TABLE IF NOT EXISTS recovery_pack_sources (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pack_id uuid NOT NULL,
  authoring_job_id uuid NOT NULL,
  source_name text NOT NULL CHECK (length(source_name) BETWEEN 1 AND 200),
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  source_output_hash text NOT NULL CHECK (source_output_hash ~ '^[a-f0-9]{64}$'),
  citation_catalog jsonb NOT NULL CHECK (jsonb_typeof(citation_catalog) = 'array' AND jsonb_array_length(citation_catalog) BETWEEN 1 AND 100),
  creation_mutation_id uuid NOT NULL,
  creation_request_hash text NOT NULL CHECK (creation_request_hash ~ '^[a-f0-9]{64}$'),
  approved_content_hash text CHECK (approved_content_hash ~ '^[a-f0-9]{64}$'),
  approved_draft_revision bigint CHECK (approved_draft_revision >= 0),
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, pack_id),
  UNIQUE (workspace_id, creation_mutation_id),
  FOREIGN KEY (workspace_id, pack_id) REFERENCES recovery_packs(workspace_id, id) ON DELETE CASCADE,
  CHECK ((approved_content_hash IS NULL AND approved_draft_revision IS NULL AND approved_at IS NULL)
    OR (approved_content_hash IS NOT NULL AND approved_draft_revision IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS recovery_pack_source_approvals (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mutation_id uuid NOT NULL,
  pack_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, mutation_id),
  FOREIGN KEY (workspace_id, pack_id) REFERENCES recovery_pack_sources(workspace_id, pack_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS recovery_pack_source_approval_retention_idx
  ON recovery_pack_source_approvals (created_at);

ALTER TABLE recovery_pack_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_pack_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE recovery_pack_source_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_pack_source_approvals FORCE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['recovery_pack_sources', 'recovery_pack_source_approvals'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), '''')) WITH CHECK (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), ''''))', table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    REVOKE UPDATE, DELETE ON recovery_pack_sources FROM openround_runtime;
    GRANT SELECT, INSERT ON recovery_pack_sources TO openround_runtime;
    GRANT UPDATE (approved_content_hash, approved_draft_revision, approved_at, approved_by)
      ON recovery_pack_sources TO openround_runtime;
    GRANT SELECT, INSERT, DELETE ON recovery_pack_source_approvals TO openround_runtime;
    REVOKE UPDATE ON recovery_pack_source_approvals FROM openround_runtime;
  END IF;
END;
$$;
