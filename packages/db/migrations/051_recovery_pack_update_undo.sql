-- Pack update review is a draft-only operation. Retain its source revision while the accepted
-- update is current so an old pre-edit snapshot cannot be pruned before immediate Undo.
ALTER TABLE quiz_draft_mutations
  ADD COLUMN IF NOT EXISTS recovery_pack_update_source_revision bigint;

ALTER TABLE quiz_draft_mutations
  DROP CONSTRAINT IF EXISTS quiz_draft_mutations_recovery_pack_update_source_check;
ALTER TABLE quiz_draft_mutations
  ADD CONSTRAINT quiz_draft_mutations_recovery_pack_update_source_check CHECK (
    recovery_pack_update_source_revision IS NULL
    OR (
      recovery_pack_update_source_revision >= 0
      AND recovery_pack_update_source_revision = expected_revision
      AND resulting_revision = expected_revision + 1
    )
  );

CREATE INDEX IF NOT EXISTS quiz_draft_mutations_recovery_pack_undo_idx
  ON quiz_draft_mutations (
    workspace_id, quiz_id, resulting_revision, recovery_pack_update_source_revision
  )
  WHERE recovery_pack_update_source_revision IS NOT NULL;
