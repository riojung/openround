-- Keep the accepted Presentation Pack update's pre-edit snapshot available for Undo while
-- its resulting revision remains current. Existing tenant RLS and parent cascades apply.
ALTER TABLE presentation_draft_mutations
  ADD COLUMN IF NOT EXISTS recovery_pack_update_source_revision bigint;

ALTER TABLE presentation_draft_mutations
  DROP CONSTRAINT IF EXISTS presentation_draft_mutations_recovery_pack_update_source_check;
ALTER TABLE presentation_draft_mutations
  ADD CONSTRAINT presentation_draft_mutations_recovery_pack_update_source_check CHECK (
    recovery_pack_update_source_revision IS NULL
    OR (
      recovery_pack_update_source_revision >= 0
      AND recovery_pack_update_source_revision = expected_revision
      AND resulting_revision = expected_revision + 1
    )
  );

CREATE INDEX IF NOT EXISTS presentation_draft_mutations_recovery_pack_undo_idx
  ON presentation_draft_mutations (
    workspace_id, presentation_id, resulting_revision, recovery_pack_update_source_revision
  )
  WHERE recovery_pack_update_source_revision IS NOT NULL;
