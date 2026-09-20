CREATE UNIQUE INDEX IF NOT EXISTS media_assets_workspace_id_idx
  ON media_assets (workspace_id, id);

CREATE TABLE IF NOT EXISTS media_references (
  workspace_id uuid NOT NULL,
  media_id uuid NOT NULL,
  owner_type text NOT NULL CHECK (owner_type IN (
    'quiz_draft', 'quiz_version', 'presentation_draft',
    'presentation_version', 'presentation_history'
  )),
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, media_id, owner_type, owner_id),
  FOREIGN KEY (workspace_id, media_id)
    REFERENCES media_assets(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS media_references_owner_idx
  ON media_references (workspace_id, owner_type, owner_id);

CREATE OR REPLACE FUNCTION openround_quiz_media_ids(document jsonb)
RETURNS TABLE(media_id uuid)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT DISTINCT (question->>'mediaId')::uuid
  FROM jsonb_array_elements(COALESCE(document->'questions', '[]'::jsonb)) AS question
  WHERE question->>'mediaId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$$;

CREATE OR REPLACE FUNCTION openround_presentation_media_ids(document jsonb)
RETURNS TABLE(media_id uuid)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT DISTINCT candidate.media_id::uuid
  FROM (
    SELECT CASE
      WHEN block->>'kind' = 'content' THEN block->>'mediaId'
      ELSE block->'question'->>'mediaId'
    END AS media_id
    FROM jsonb_array_elements(COALESCE(document->'blocks', '[]'::jsonb)) AS block
  ) AS candidate
  WHERE candidate.media_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$$;

CREATE OR REPLACE FUNCTION openround_replace_media_references(
  target_workspace_id uuid,
  target_owner_type text,
  target_owner_id uuid,
  document jsonb,
  document_format text,
  reject_missing boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  requested_media_ids uuid[];
  invalid_media_id uuid;
BEGIN
  IF document_format = 'quiz' THEN
    SELECT COALESCE(array_agg(media_id), ARRAY[]::uuid[])
    INTO requested_media_ids
    FROM openround_quiz_media_ids(document);
  ELSIF document_format = 'presentation' THEN
    SELECT COALESCE(array_agg(media_id), ARRAY[]::uuid[])
    INTO requested_media_ids
    FROM openround_presentation_media_ids(document);
  ELSE
    RAISE EXCEPTION 'unsupported media reference document format: %', document_format;
  END IF;

  SELECT requested.media_id
  INTO invalid_media_id
  FROM unnest(requested_media_ids) AS requested(media_id)
  LEFT JOIN media_assets asset
    ON asset.workspace_id = target_workspace_id AND asset.id = requested.media_id
  WHERE asset.id IS NULL
  LIMIT 1;

  IF reject_missing AND invalid_media_id IS NOT NULL THEN
    RAISE EXCEPTION 'media asset % is unavailable in workspace %',
      invalid_media_id, target_workspace_id
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM media_references
  WHERE workspace_id = target_workspace_id
    AND owner_type = target_owner_type
    AND owner_id = target_owner_id;

  INSERT INTO media_references (workspace_id, media_id, owner_type, owner_id)
  SELECT target_workspace_id, asset.id, target_owner_type, target_owner_id
  FROM unnest(requested_media_ids) AS requested(media_id)
  JOIN media_assets asset
    ON asset.workspace_id = target_workspace_id AND asset.id = requested.media_id
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION openround_sync_quiz_draft_media()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM openround_replace_media_references(
    NEW.workspace_id, 'quiz_draft', NEW.id, NEW.draft, 'quiz'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION openround_sync_quiz_version_media()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM openround_replace_media_references(
    NEW.workspace_id, 'quiz_version', NEW.id, NEW.content, 'quiz'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION openround_sync_presentation_draft_media()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM openround_replace_media_references(
    NEW.workspace_id, 'presentation_draft', NEW.id, NEW.draft, 'presentation'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION openround_sync_presentation_version_media()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM openround_replace_media_references(
    NEW.workspace_id, 'presentation_version', NEW.id, NEW.content, 'presentation'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION openround_sync_presentation_history_media()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM openround_replace_media_references(
    NEW.workspace_id, 'presentation_history', NEW.id, NEW.draft, 'presentation'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION openround_remove_owned_media_references()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM media_references
  WHERE workspace_id = OLD.workspace_id
    AND owner_type = TG_ARGV[0]
    AND owner_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS quizzes_sync_media_references ON quizzes;
CREATE TRIGGER quizzes_sync_media_references
  AFTER INSERT OR UPDATE OF draft ON quizzes
  FOR EACH ROW EXECUTE FUNCTION openround_sync_quiz_draft_media();

DROP TRIGGER IF EXISTS quiz_versions_sync_media_references ON quiz_versions;
CREATE TRIGGER quiz_versions_sync_media_references
  AFTER INSERT ON quiz_versions
  FOR EACH ROW EXECUTE FUNCTION openround_sync_quiz_version_media();

DROP TRIGGER IF EXISTS presentations_sync_media_references ON presentations;
CREATE TRIGGER presentations_sync_media_references
  AFTER INSERT OR UPDATE OF draft ON presentations
  FOR EACH ROW EXECUTE FUNCTION openround_sync_presentation_draft_media();

DROP TRIGGER IF EXISTS presentation_versions_sync_media_references ON presentation_versions;
CREATE TRIGGER presentation_versions_sync_media_references
  AFTER INSERT ON presentation_versions
  FOR EACH ROW EXECUTE FUNCTION openround_sync_presentation_version_media();

DROP TRIGGER IF EXISTS presentation_history_sync_media_references ON presentation_draft_history;
CREATE TRIGGER presentation_history_sync_media_references
  AFTER INSERT OR UPDATE OF draft ON presentation_draft_history
  FOR EACH ROW EXECUTE FUNCTION openround_sync_presentation_history_media();

DROP TRIGGER IF EXISTS quizzes_remove_media_references ON quizzes;
CREATE TRIGGER quizzes_remove_media_references
  BEFORE DELETE ON quizzes
  FOR EACH ROW EXECUTE FUNCTION openround_remove_owned_media_references('quiz_draft');

DROP TRIGGER IF EXISTS quiz_versions_remove_media_references ON quiz_versions;
CREATE TRIGGER quiz_versions_remove_media_references
  BEFORE DELETE ON quiz_versions
  FOR EACH ROW EXECUTE FUNCTION openround_remove_owned_media_references('quiz_version');

DROP TRIGGER IF EXISTS presentations_remove_media_references ON presentations;
CREATE TRIGGER presentations_remove_media_references
  BEFORE DELETE ON presentations
  FOR EACH ROW EXECUTE FUNCTION openround_remove_owned_media_references('presentation_draft');

DROP TRIGGER IF EXISTS presentation_versions_remove_media_references ON presentation_versions;
CREATE TRIGGER presentation_versions_remove_media_references
  BEFORE DELETE ON presentation_versions
  FOR EACH ROW EXECUTE FUNCTION openround_remove_owned_media_references('presentation_version');

DROP TRIGGER IF EXISTS presentation_history_remove_media_references ON presentation_draft_history;
CREATE TRIGGER presentation_history_remove_media_references
  BEFORE DELETE ON presentation_draft_history
  FOR EACH ROW EXECUTE FUNCTION openround_remove_owned_media_references('presentation_history');

SELECT openround_replace_media_references(workspace_id, 'quiz_draft', id, draft, 'quiz', false)
FROM quizzes;

SELECT openround_replace_media_references(workspace_id, 'quiz_version', id, content, 'quiz', false)
FROM quiz_versions;

SELECT openround_replace_media_references(
  workspace_id, 'presentation_draft', id, draft, 'presentation', false
)
FROM presentations;

SELECT openround_replace_media_references(
  workspace_id, 'presentation_version', id, content, 'presentation', false
)
FROM presentation_versions;

SELECT openround_replace_media_references(
  workspace_id, 'presentation_history', id, draft, 'presentation', false
)
FROM presentation_draft_history;

ALTER TABLE media_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_references FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_isolation ON media_references;
CREATE POLICY workspace_isolation ON media_references
  USING (
    current_setting('app.system_access', true) = 'on'
    OR workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
  )
  WITH CHECK (
    current_setting('app.system_access', true) = 'on'
    OR workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON media_references TO openround_runtime';
  END IF;
END $$;
