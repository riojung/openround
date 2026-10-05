-- Published content remains immutable. Remove an archived artifact through its
-- parent cascade, while preserving assignments and existing runtime grants.
ALTER TABLE followups
  DROP CONSTRAINT IF EXISTS followups_source_quiz_version_fk;
ALTER TABLE followups
  ADD CONSTRAINT followups_source_quiz_version_fk
  FOREIGN KEY (source_quiz_version_id) REFERENCES quiz_versions(id) ON DELETE NO ACTION;

-- Polymorphic links need the same existence/locking guarantee as foreign keys.
CREATE OR REPLACE FUNCTION openround_lock_library_artifact_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  artifact_exists boolean;
BEGIN
  IF NEW.artifact_type = 'round' THEN
    SELECT true INTO artifact_exists FROM public.quizzes
    WHERE workspace_id = NEW.workspace_id AND id = NEW.artifact_id
    FOR KEY SHARE;
  ELSIF NEW.artifact_type = 'presentation' THEN
    SELECT true INTO artifact_exists FROM public.presentations
    WHERE workspace_id = NEW.workspace_id AND id = NEW.artifact_id
    FOR KEY SHARE;
  END IF;
  IF artifact_exists IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'library item must exist in the link workspace' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS library_favorites_artifact_scope ON library_favorites;
CREATE TRIGGER library_favorites_artifact_scope
  BEFORE INSERT OR UPDATE OF workspace_id, artifact_type, artifact_id ON library_favorites
  FOR EACH ROW EXECUTE FUNCTION openround_lock_library_artifact_link();

DROP TRIGGER IF EXISTS collaboration_group_artifacts_artifact_scope ON collaboration_group_artifacts;
CREATE TRIGGER collaboration_group_artifacts_artifact_scope
  BEFORE INSERT OR UPDATE OF workspace_id, artifact_type, artifact_id ON collaboration_group_artifacts
  FOR EACH ROW EXECUTE FUNCTION openround_lock_library_artifact_link();

DROP TRIGGER IF EXISTS collaboration_group_schedule_artifact_scope ON collaboration_group_schedule;
CREATE TRIGGER collaboration_group_schedule_artifact_scope
  BEFORE INSERT OR UPDATE OF workspace_id, artifact_type, artifact_id ON collaboration_group_schedule
  FOR EACH ROW EXECUTE FUNCTION openround_lock_library_artifact_link();

-- The delete must remove every user's favorite. The trigger's fixed scope is the
-- deleted parent row; elevated RLS access never escapes this function call.
CREATE OR REPLACE FUNCTION openround_remove_library_artifact_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET app.system_access = 'on'
AS $$
DECLARE
  deleted_artifact_type text;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME NOT IN ('quizzes', 'presentations') THEN
    RAISE EXCEPTION 'library cleanup requires an artifact parent' USING ERRCODE = '23514';
  END IF;
  deleted_artifact_type := CASE WHEN TG_TABLE_NAME = 'quizzes' THEN 'round' ELSE 'presentation' END;
  DELETE FROM public.library_favorites
  WHERE workspace_id = OLD.workspace_id AND artifact_type = deleted_artifact_type AND artifact_id = OLD.id;
  DELETE FROM public.collaboration_group_artifacts
  WHERE workspace_id = OLD.workspace_id AND artifact_type = deleted_artifact_type AND artifact_id = OLD.id;
  DELETE FROM public.collaboration_group_schedule
  WHERE workspace_id = OLD.workspace_id AND artifact_type = deleted_artifact_type AND artifact_id = OLD.id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION openround_remove_library_artifact_links() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION openround_remove_library_artifact_links() FROM openround_runtime';
  END IF;
END $$;

DROP TRIGGER IF EXISTS quizzes_remove_library_links ON quizzes;
CREATE TRIGGER quizzes_remove_library_links
  AFTER DELETE ON quizzes
  FOR EACH ROW EXECUTE FUNCTION openround_remove_library_artifact_links();

DROP TRIGGER IF EXISTS presentations_remove_library_links ON presentations;
CREATE TRIGGER presentations_remove_library_links
  AFTER DELETE ON presentations
  FOR EACH ROW EXECUTE FUNCTION openround_remove_library_artifact_links();
