ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS draft_schema_version integer NOT NULL DEFAULT 1
    CHECK (draft_schema_version > 0),
  ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS quizzes_workspace_id_unique_idx
  ON quizzes (workspace_id, id);

CREATE TABLE IF NOT EXISTS quiz_draft_mutations (
  mutation_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL,
  expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
  resulting_revision bigint NOT NULL CHECK (resulting_revision >= 0),
  draft_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, mutation_id),
  FOREIGN KEY (workspace_id, quiz_id)
    REFERENCES quizzes(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quiz_draft_history (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  draft jsonb NOT NULL,
  saved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  mutation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, revision),
  FOREIGN KEY (workspace_id, quiz_id)
    REFERENCES quizzes(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS quiz_history_retention_idx
  ON quiz_draft_history (workspace_id, quiz_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quiz_mutation_retention_idx
  ON quiz_draft_mutations (workspace_id, quiz_id, created_at DESC);

-- Existing Rounds enter recovery history at their current revision. The id is
-- deterministic so the migration remains idempotent without requiring pgcrypto.
INSERT INTO quiz_draft_history (
  id, workspace_id, quiz_id, revision, draft, saved_by, mutation_id, created_at
)
SELECT md5(quiz.workspace_id::text || ':' || quiz.id::text || ':' || quiz.draft_revision::text)::uuid,
       quiz.workspace_id, quiz.id, quiz.draft_revision, quiz.draft,
       quiz.last_edited_by, NULL, quiz.updated_at
FROM quizzes quiz
ON CONFLICT (quiz_id, revision) DO NOTHING;

ALTER TABLE quiz_draft_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_draft_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_draft_mutations FORCE ROW LEVEL SECURITY;
ALTER TABLE quiz_draft_history FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['quiz_draft_mutations', 'quiz_draft_history'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I USING (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), '''')) WITH CHECK (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), ''''))',
      table_name
    );
  END LOOP;
END $$;

ALTER TABLE media_references
  DROP CONSTRAINT IF EXISTS media_references_owner_type_check;
ALTER TABLE media_references
  ADD CONSTRAINT media_references_owner_type_check CHECK (owner_type IN (
    'quiz_draft', 'quiz_version', 'quiz_history', 'presentation_draft',
    'presentation_version', 'presentation_history'
  ));

CREATE OR REPLACE FUNCTION openround_sync_quiz_history_media()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM openround_replace_media_references(
    NEW.workspace_id, 'quiz_history', NEW.id, NEW.draft, 'quiz'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quiz_history_sync_media_references ON quiz_draft_history;
CREATE TRIGGER quiz_history_sync_media_references
  AFTER INSERT OR UPDATE OF draft ON quiz_draft_history
  FOR EACH ROW EXECUTE FUNCTION openround_sync_quiz_history_media();

DROP TRIGGER IF EXISTS quiz_history_remove_media_references ON quiz_draft_history;
CREATE TRIGGER quiz_history_remove_media_references
  BEFORE DELETE ON quiz_draft_history
  FOR EACH ROW EXECUTE FUNCTION openround_remove_owned_media_references('quiz_history');

SELECT openround_replace_media_references(
  workspace_id, 'quiz_history', id, draft, 'quiz', false
)
FROM quiz_draft_history;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON quiz_draft_mutations, quiz_draft_history TO openround_runtime';
  END IF;
END $$;
