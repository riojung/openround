ALTER TABLE authoring_jobs
  ADD COLUMN IF NOT EXISTS applied_quiz_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'authoring_jobs_applied_quiz_id_fkey'
  ) THEN
    ALTER TABLE authoring_jobs
      ADD CONSTRAINT authoring_jobs_applied_quiz_id_fkey
      FOREIGN KEY (applied_quiz_id) REFERENCES quizzes(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS authoring_jobs_applied_quiz_unique_idx
  ON authoring_jobs (applied_quiz_id)
  WHERE applied_quiz_id IS NOT NULL;
