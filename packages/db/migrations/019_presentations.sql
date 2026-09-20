CREATE TABLE IF NOT EXISTS presentations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  draft jsonb NOT NULL,
  draft_revision bigint NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  draft_schema_version integer NOT NULL DEFAULT 1 CHECK (draft_schema_version > 0),
  current_version_id uuid,
  published_draft_revision bigint CHECK (published_draft_revision >= 0),
  last_edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS presentation_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  presentation_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  content jsonb NOT NULL,
  content_hash text NOT NULL,
  source_draft_revision bigint NOT NULL CHECK (source_draft_revision >= 0),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (presentation_id, version),
  UNIQUE (presentation_id, content_hash),
  UNIQUE (workspace_id, presentation_id, id),
  FOREIGN KEY (workspace_id, presentation_id)
    REFERENCES presentations(workspace_id, id) ON DELETE CASCADE
);

ALTER TABLE presentations
  DROP CONSTRAINT IF EXISTS presentations_current_version_fk;
ALTER TABLE presentations
  ADD CONSTRAINT presentations_current_version_fk
  FOREIGN KEY (workspace_id, id, current_version_id)
  REFERENCES presentation_versions(workspace_id, presentation_id, id);

CREATE TABLE IF NOT EXISTS presentation_draft_mutations (
  mutation_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  presentation_id uuid NOT NULL,
  expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
  resulting_revision bigint NOT NULL CHECK (resulting_revision > 0),
  draft_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, mutation_id),
  FOREIGN KEY (workspace_id, presentation_id)
    REFERENCES presentations(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS presentation_draft_history (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  presentation_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  draft jsonb NOT NULL,
  saved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  mutation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (presentation_id, revision),
  FOREIGN KEY (workspace_id, presentation_id)
    REFERENCES presentations(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS presentations_workspace_updated_idx
  ON presentations (workspace_id, updated_at DESC)
  WHERE status <> 'archived';
CREATE INDEX IF NOT EXISTS presentation_versions_presentation_idx
  ON presentation_versions (workspace_id, presentation_id, version DESC);
CREATE INDEX IF NOT EXISTS presentation_history_retention_idx
  ON presentation_draft_history (workspace_id, presentation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS presentation_mutation_retention_idx
  ON presentation_draft_mutations (workspace_id, presentation_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_presentation_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'published presentation versions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS presentation_versions_immutable ON presentation_versions;
CREATE TRIGGER presentation_versions_immutable
  BEFORE UPDATE ON presentation_versions
  FOR EACH ROW EXECUTE FUNCTION reject_presentation_version_mutation();

ALTER TABLE presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_draft_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_draft_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentations FORCE ROW LEVEL SECURITY;
ALTER TABLE presentation_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE presentation_draft_mutations FORCE ROW LEVEL SECURITY;
ALTER TABLE presentation_draft_history FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'presentations', 'presentation_versions', 'presentation_draft_mutations',
    'presentation_draft_history'
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON presentations, presentation_draft_mutations, presentation_draft_history TO openround_runtime';
    EXECUTE 'GRANT SELECT, INSERT ON presentation_versions TO openround_runtime';
    EXECUTE 'REVOKE UPDATE, DELETE ON presentation_versions FROM openround_runtime';
  END IF;
END $$;
