CREATE TABLE IF NOT EXISTS folders (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS folders_workspace_name_uq
  ON folders (workspace_id, lower(name));

ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS quizzes_folder_idx ON quizzes (workspace_id, folder_id);
CREATE INDEX IF NOT EXISTS quizzes_tags_idx ON quizzes USING gin (tags);

CREATE OR REPLACE FUNCTION enforce_quiz_folder_workspace()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM folders
    WHERE id = NEW.folder_id AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'quiz folder must belong to the quiz workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quizzes_folder_workspace ON quizzes;
CREATE TRIGGER quizzes_folder_workspace
  BEFORE INSERT OR UPDATE OF folder_id, workspace_id ON quizzes
  FOR EACH ROW EXECUTE FUNCTION enforce_quiz_folder_workspace();

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_isolation ON folders;
CREATE POLICY workspace_isolation ON folders
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON folders TO openround_runtime';
  END IF;
END $$;
