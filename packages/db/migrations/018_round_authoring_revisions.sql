ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS draft_revision bigint NOT NULL DEFAULT 0
  CHECK (draft_revision >= 0),
  ADD COLUMN IF NOT EXISTS published_draft_revision bigint
  CHECK (published_draft_revision IS NULL OR published_draft_revision >= 0);

ALTER TABLE quiz_versions
  ADD COLUMN IF NOT EXISTS source_draft_revision bigint
  CHECK (source_draft_revision IS NULL OR source_draft_revision >= 0);

UPDATE quizzes
SET published_draft_revision = draft_revision
WHERE current_version_id IS NOT NULL
  AND published_draft_revision IS NULL;

-- Published payloads remain immutable, but this release adds bookkeeping that older
-- versions could not have recorded. Temporarily suspend the UPDATE guard only for the
-- one-time metadata backfill; the surrounding migration transaction guarantees the
-- trigger is restored if any statement fails.
ALTER TABLE quiz_versions DISABLE TRIGGER quiz_versions_immutable;

UPDATE quiz_versions AS version
SET source_draft_revision = quiz.published_draft_revision
FROM quizzes AS quiz
WHERE quiz.current_version_id = version.id
  AND version.source_draft_revision IS NULL;

ALTER TABLE quiz_versions ENABLE TRIGGER quiz_versions_immutable;
