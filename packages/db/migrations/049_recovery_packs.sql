CREATE TABLE IF NOT EXISTS recovery_packs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  draft jsonb NOT NULL,
  draft_revision bigint NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  draft_schema_version integer NOT NULL DEFAULT 1 CHECK (draft_schema_version > 0),
  current_version_id uuid,
  published_draft_revision bigint CHECK (published_draft_revision >= 0),
  last_edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS recovery_pack_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pack_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  content jsonb NOT NULL,
  content_schema_version integer NOT NULL DEFAULT 1 CHECK (content_schema_version > 0),
  content_hash text NOT NULL,
  source_draft_revision bigint NOT NULL CHECK (source_draft_revision >= 0),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, version),
  UNIQUE (pack_id, content_hash),
  UNIQUE (workspace_id, pack_id, id),
  FOREIGN KEY (workspace_id, pack_id) REFERENCES recovery_packs(workspace_id, id) ON DELETE CASCADE
);

ALTER TABLE recovery_packs DROP CONSTRAINT IF EXISTS recovery_packs_current_version_fk;
ALTER TABLE recovery_packs ADD CONSTRAINT recovery_packs_current_version_fk
  FOREIGN KEY (workspace_id, id, current_version_id)
  REFERENCES recovery_pack_versions(workspace_id, pack_id, id);

CREATE TABLE IF NOT EXISTS recovery_pack_draft_history (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pack_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  draft jsonb NOT NULL,
  draft_schema_version integer NOT NULL DEFAULT 1 CHECK (draft_schema_version > 0),
  saved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  mutation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, revision),
  FOREIGN KEY (workspace_id, pack_id) REFERENCES recovery_packs(workspace_id, id) ON DELETE CASCADE
);

-- The result snapshot keeps acknowledged mutations replayable for their entire receipt lifetime,
-- even when the independently bounded history has already removed that revision.
CREATE TABLE IF NOT EXISTS recovery_pack_draft_mutations (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mutation_id uuid NOT NULL,
  pack_id uuid NOT NULL,
  expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
  resulting_revision bigint NOT NULL CHECK (resulting_revision >= 0),
  draft_hash text NOT NULL,
  resulting_draft jsonb NOT NULL,
  draft_schema_version integer NOT NULL DEFAULT 1 CHECK (draft_schema_version > 0),
  last_edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resulting_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, mutation_id),
  FOREIGN KEY (workspace_id, pack_id) REFERENCES recovery_packs(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS recovery_packs_workspace_updated_idx ON recovery_packs (workspace_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS recovery_pack_versions_pack_idx ON recovery_pack_versions (workspace_id, pack_id, version DESC);
CREATE INDEX IF NOT EXISTS recovery_pack_history_retention_idx ON recovery_pack_draft_history (workspace_id, pack_id, created_at);
CREATE INDEX IF NOT EXISTS recovery_pack_mutation_retention_idx ON recovery_pack_draft_mutations (workspace_id, pack_id, created_at);

CREATE OR REPLACE FUNCTION reject_recovery_pack_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'published Recovery Pack versions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS recovery_pack_versions_immutable ON recovery_pack_versions;
CREATE TRIGGER recovery_pack_versions_immutable BEFORE UPDATE ON recovery_pack_versions
  FOR EACH ROW EXECUTE FUNCTION reject_recovery_pack_version_mutation();

ALTER TABLE media_references DROP CONSTRAINT IF EXISTS media_references_owner_type_check;
ALTER TABLE media_references ADD CONSTRAINT media_references_owner_type_check CHECK (owner_type IN (
  'quiz_draft', 'quiz_version', 'quiz_history', 'presentation_draft',
  'presentation_version', 'presentation_history', 'recovery_pack_draft',
  'recovery_pack_version', 'recovery_pack_history', 'recovery_pack_mutation'
));

CREATE OR REPLACE FUNCTION openround_recovery_pack_media_ids(document jsonb)
RETURNS TABLE(media_id uuid) LANGUAGE sql IMMUTABLE AS $$
  SELECT DISTINCT candidate::uuid
  FROM (VALUES (document->'diagnostic'->>'mediaId'), (document->'recheck'->>'mediaId'),
               (document->'delayedProbe'->>'mediaId')) AS requested(candidate)
  WHERE candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$$;

-- An inserted Pack retains its original immutable content for update review. Its media must
-- remain referenced even when it is not one of the two questions currently shown in the Round.
CREATE OR REPLACE FUNCTION openround_quiz_media_ids(document jsonb)
RETURNS TABLE(media_id uuid) LANGUAGE sql IMMUTABLE AS $$
  SELECT DISTINCT candidate.media_id
  FROM (
    SELECT (question->>'mediaId')::uuid AS media_id
    FROM jsonb_array_elements(COALESCE(document->'questions', '[]'::jsonb)) AS question
    WHERE question->>'mediaId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    UNION ALL
    SELECT reference.media_id
    FROM jsonb_array_elements(COALESCE(document->'recoveryPackInsertions', '[]'::jsonb)) AS insertion
    CROSS JOIN LATERAL openround_recovery_pack_media_ids(insertion->'originalContent') AS reference
  ) AS candidate
$$;

CREATE OR REPLACE FUNCTION openround_replace_media_references(
  target_workspace_id uuid, target_owner_type text, target_owner_id uuid,
  document jsonb, document_format text, reject_missing boolean DEFAULT true
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  requested_media_ids uuid[];
  invalid_media_id uuid;
BEGIN
  IF document_format = 'quiz' THEN
    SELECT COALESCE(array_agg(media_id), ARRAY[]::uuid[]) INTO requested_media_ids FROM openround_quiz_media_ids(document);
  ELSIF document_format = 'presentation' THEN
    SELECT COALESCE(array_agg(media_id), ARRAY[]::uuid[]) INTO requested_media_ids FROM openround_presentation_media_ids(document);
  ELSIF document_format = 'recovery_pack' THEN
    SELECT COALESCE(array_agg(media_id), ARRAY[]::uuid[]) INTO requested_media_ids FROM openround_recovery_pack_media_ids(document);
  ELSE
    RAISE EXCEPTION 'unsupported media reference document format: %', document_format;
  END IF;

  -- Serialize reference acquisition with the asset deletion claim, which locks these rows.
  PERFORM 1 FROM media_assets
    WHERE workspace_id = target_workspace_id AND id = ANY(requested_media_ids) FOR SHARE;
  SELECT requested.media_id INTO invalid_media_id
  FROM unnest(requested_media_ids) AS requested(media_id)
  LEFT JOIN media_assets asset ON asset.workspace_id = target_workspace_id AND asset.id = requested.media_id
  WHERE asset.id IS NULL OR asset.scan_status = 'deleting' LIMIT 1;
  IF reject_missing AND invalid_media_id IS NOT NULL THEN
    RAISE EXCEPTION 'media asset % is unavailable in workspace %', invalid_media_id, target_workspace_id USING ERRCODE = '23503';
  END IF;
  DELETE FROM media_references WHERE workspace_id = target_workspace_id AND owner_type = target_owner_type AND owner_id = target_owner_id;
  INSERT INTO media_references (workspace_id, media_id, owner_type, owner_id)
  SELECT target_workspace_id, asset.id, target_owner_type, target_owner_id
  FROM unnest(requested_media_ids) AS requested(media_id)
  JOIN media_assets asset ON asset.workspace_id = target_workspace_id AND asset.id = requested.media_id AND asset.scan_status <> 'deleting'
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION openround_sync_recovery_pack_media()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  document jsonb;
  owner_id uuid;
BEGIN
  document := to_jsonb(NEW)->TG_ARGV[1];
  owner_id := (to_jsonb(NEW)->>TG_ARGV[2])::uuid;
  IF TG_ARGV[0] = 'recovery_pack_version' AND EXISTS (
    SELECT 1 FROM openround_recovery_pack_media_ids(document) requested
    LEFT JOIN media_assets asset ON asset.workspace_id = NEW.workspace_id AND asset.id = requested.media_id
    WHERE asset.id IS NULL OR asset.scan_status <> 'clean'
  ) THEN
    RAISE EXCEPTION 'Recovery Pack media must be clean before publishing' USING ERRCODE = '23503';
  END IF;
  PERFORM openround_replace_media_references(NEW.workspace_id, TG_ARGV[0], owner_id, document, 'recovery_pack');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recovery_packs_sync_media ON recovery_packs;
CREATE TRIGGER recovery_packs_sync_media AFTER INSERT OR UPDATE OF draft ON recovery_packs
  FOR EACH ROW EXECUTE FUNCTION openround_sync_recovery_pack_media('recovery_pack_draft', 'draft', 'id');
DROP TRIGGER IF EXISTS recovery_pack_versions_sync_media ON recovery_pack_versions;
CREATE TRIGGER recovery_pack_versions_sync_media AFTER INSERT ON recovery_pack_versions
  FOR EACH ROW EXECUTE FUNCTION openround_sync_recovery_pack_media('recovery_pack_version', 'content', 'id');
DROP TRIGGER IF EXISTS recovery_pack_history_sync_media ON recovery_pack_draft_history;
CREATE TRIGGER recovery_pack_history_sync_media AFTER INSERT OR UPDATE OF draft ON recovery_pack_draft_history
  FOR EACH ROW EXECUTE FUNCTION openround_sync_recovery_pack_media('recovery_pack_history', 'draft', 'id');
DROP TRIGGER IF EXISTS recovery_pack_mutations_sync_media ON recovery_pack_draft_mutations;
CREATE TRIGGER recovery_pack_mutations_sync_media AFTER INSERT ON recovery_pack_draft_mutations
  FOR EACH ROW EXECUTE FUNCTION openround_sync_recovery_pack_media('recovery_pack_mutation', 'resulting_draft', 'mutation_id');

DROP TRIGGER IF EXISTS recovery_packs_remove_media ON recovery_packs;
CREATE TRIGGER recovery_packs_remove_media BEFORE DELETE ON recovery_packs
  FOR EACH ROW EXECUTE FUNCTION openround_remove_owned_media_references('recovery_pack_draft');
DROP TRIGGER IF EXISTS recovery_pack_versions_remove_media ON recovery_pack_versions;
CREATE TRIGGER recovery_pack_versions_remove_media BEFORE DELETE ON recovery_pack_versions
  FOR EACH ROW EXECUTE FUNCTION openround_remove_owned_media_references('recovery_pack_version');
DROP TRIGGER IF EXISTS recovery_pack_history_remove_media ON recovery_pack_draft_history;
CREATE TRIGGER recovery_pack_history_remove_media BEFORE DELETE ON recovery_pack_draft_history
  FOR EACH ROW EXECUTE FUNCTION openround_remove_owned_media_references('recovery_pack_history');

CREATE OR REPLACE FUNCTION openround_remove_recovery_pack_mutation_media()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM media_references WHERE workspace_id = OLD.workspace_id
    AND owner_type = 'recovery_pack_mutation' AND owner_id = OLD.mutation_id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS recovery_pack_mutations_remove_media ON recovery_pack_draft_mutations;
CREATE TRIGGER recovery_pack_mutations_remove_media BEFORE DELETE ON recovery_pack_draft_mutations
  FOR EACH ROW EXECUTE FUNCTION openround_remove_recovery_pack_mutation_media();

ALTER TABLE recovery_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_packs FORCE ROW LEVEL SECURITY;
ALTER TABLE recovery_pack_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_pack_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE recovery_pack_draft_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_pack_draft_history FORCE ROW LEVEL SECURITY;
ALTER TABLE recovery_pack_draft_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_pack_draft_mutations FORCE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['recovery_packs', 'recovery_pack_versions', 'recovery_pack_draft_history', 'recovery_pack_draft_mutations'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), '''')) WITH CHECK (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), ''''))', table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON recovery_packs, recovery_pack_draft_history, recovery_pack_draft_mutations TO openround_runtime;
    GRANT SELECT, INSERT ON recovery_pack_versions TO openround_runtime;
    REVOKE UPDATE, DELETE ON recovery_pack_versions FROM openround_runtime;
  END IF;
END;
$$;
