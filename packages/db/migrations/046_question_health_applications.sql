-- Record only the bounded field diff and revision provenance for approved draft edits.
-- Published quiz_versions remain untouched. The source Round owns retention and deletion.
CREATE TABLE IF NOT EXISTS question_health_applications (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL,
  application_id uuid NOT NULL,
  finding_id varchar(500) NOT NULL,
  rule_version smallint NOT NULL CHECK (rule_version > 0 AND rule_version <= 99),
  ruleset_version varchar(32) NOT NULL CHECK (length(ruleset_version) > 0),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  source_revision bigint NOT NULL CHECK (source_revision >= 0),
  applied_revision bigint NOT NULL CHECK (applied_revision = source_revision + 1),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  changes jsonb NOT NULL CHECK (
    jsonb_typeof(changes) = 'array'
    AND jsonb_array_length(changes) BETWEEN 1 AND 2
    AND octet_length(changes::text) <= 6_000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, application_id),
  FOREIGN KEY (workspace_id, quiz_id)
    REFERENCES quizzes(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS question_health_applications_quiz_idx
  ON question_health_applications (workspace_id, quiz_id, created_at DESC);

-- Distinguish an undo receipt from an unrelated history restore using the same client UUID.
ALTER TABLE quiz_draft_mutations
  ADD COLUMN IF NOT EXISTS question_health_undo_application_id uuid;

ALTER TABLE question_health_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_health_applications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS question_health_applications_workspace_isolation
  ON question_health_applications;
CREATE POLICY question_health_applications_workspace_isolation
  ON question_health_applications
  USING (
    current_setting('app.system_access', true) = 'on'
    OR (
      workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
      AND EXISTS (
        SELECT 1 FROM quizzes AS parent_quiz
        WHERE parent_quiz.workspace_id = question_health_applications.workspace_id
          AND parent_quiz.id = question_health_applications.quiz_id
      )
    )
  )
  WITH CHECK (
    current_setting('app.system_access', true) = 'on'
    OR (
      workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
      AND EXISTS (
        SELECT 1 FROM quizzes AS parent_quiz
        WHERE parent_quiz.workspace_id = question_health_applications.workspace_id
          AND parent_quiz.id = question_health_applications.quiz_id
      )
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON question_health_applications TO openround_runtime';
  END IF;
END $$;
