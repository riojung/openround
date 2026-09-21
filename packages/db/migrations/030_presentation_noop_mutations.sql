ALTER TABLE presentation_draft_mutations
  DROP CONSTRAINT IF EXISTS presentation_draft_mutations_resulting_revision_check;

ALTER TABLE presentation_draft_mutations
  ADD CONSTRAINT presentation_draft_mutations_resulting_revision_check
  CHECK (resulting_revision >= 0);
