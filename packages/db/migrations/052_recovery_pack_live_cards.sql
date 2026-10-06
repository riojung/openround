-- Aggregate attribution only: frozen Pack/card references, never participant responses or the
-- Pack's hidden question content. The owning session's existing forced workspace RLS, export,
-- deletion and retention cascade cover this field. No source FK: deleting a Pack must not erase
-- the evidence of an already-delivered session snapshot.
ALTER TABLE session_interventions
  ADD COLUMN IF NOT EXISTS recovery_pack_card jsonb;

ALTER TABLE session_interventions
  DROP CONSTRAINT IF EXISTS session_interventions_recovery_pack_card_check;
ALTER TABLE session_interventions
  ADD CONSTRAINT session_interventions_recovery_pack_card_check CHECK (
    recovery_pack_card IS NULL OR jsonb_typeof(recovery_pack_card) = 'object'
  );
