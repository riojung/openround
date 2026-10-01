-- Persist only bounded, facilitator-selected dismissal reasons. Dismissals are
-- content-addressed and cascade with their source Round.
CREATE TABLE IF NOT EXISTS question_health_dismissals (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL,
  finding_id varchar(500) NOT NULL,
  rule_version smallint NOT NULL CHECK (rule_version > 0 AND rule_version <= 99),
  ruleset_version varchar(32) NOT NULL CHECK (length(ruleset_version) > 0),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (reason IN (
    'false_positive', 'intentional_choice', 'will_address_later'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    workspace_id, quiz_id, finding_id, rule_version, ruleset_version, content_hash
  ),
  FOREIGN KEY (workspace_id, quiz_id)
    REFERENCES quizzes(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS question_health_dismissals_quiz_idx
  ON question_health_dismissals (workspace_id, quiz_id, created_at DESC);

ALTER TABLE question_health_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_health_dismissals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS question_health_dismissals_workspace_isolation
  ON question_health_dismissals;
CREATE POLICY question_health_dismissals_workspace_isolation
  ON question_health_dismissals
  USING (
    current_setting('app.system_access', true) = 'on'
    OR (
      workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
      AND EXISTS (
        SELECT 1 FROM quizzes AS parent_quiz
        WHERE parent_quiz.workspace_id = question_health_dismissals.workspace_id
          AND parent_quiz.id = question_health_dismissals.quiz_id
      )
    )
  )
  WITH CHECK (
    current_setting('app.system_access', true) = 'on'
    OR (
      workspace_id::text = nullif(current_setting('app.workspace_id', true), '')
      AND EXISTS (
        SELECT 1 FROM quizzes AS parent_quiz
        WHERE parent_quiz.workspace_id = question_health_dismissals.workspace_id
          AND parent_quiz.id = question_health_dismissals.quiz_id
      )
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON question_health_dismissals TO openround_runtime';
  END IF;
END $$;
