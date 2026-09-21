ALTER TABLE presentations
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS presentations_folder_idx
  ON presentations (workspace_id, folder_id);

CREATE OR REPLACE FUNCTION enforce_presentation_folder_workspace()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM folders
    WHERE id = NEW.folder_id AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'presentation folder must belong to the presentation workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS presentations_folder_workspace ON presentations;
CREATE TRIGGER presentations_folder_workspace
  BEFORE INSERT OR UPDATE OF folder_id, workspace_id ON presentations
  FOR EACH ROW EXECUTE FUNCTION enforce_presentation_folder_workspace();

CREATE TABLE IF NOT EXISTS library_favorites (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK (artifact_type IN ('round', 'presentation')),
  artifact_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, artifact_type, artifact_id)
);

CREATE INDEX IF NOT EXISTS library_favorites_user_idx
  ON library_favorites (user_id, workspace_id, created_at DESC);

ALTER TABLE library_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_favorites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_workspace_isolation ON library_favorites;
CREATE POLICY user_workspace_isolation ON library_favorites
  USING (
    current_setting('app.system_access', true) = 'on'
    OR (
      workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
      AND user_id::text = nullif(current_setting('app.user_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.system_access', true) = 'on'
    OR (
      workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
      AND user_id::text = nullif(current_setting('app.user_id', true), '')
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON library_favorites TO openround_runtime';
  END IF;
END $$;
