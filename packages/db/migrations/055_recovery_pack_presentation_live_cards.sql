-- Freeze creation eligibility and aggregate card attribution on the existing retained room.
-- No Pack foreign key: source deletion must not change a delivered Presentation snapshot.
ALTER TABLE presentation_live_sessions
  ADD COLUMN IF NOT EXISTS recovery_pack_cards_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recovery_pack_intervention jsonb;

ALTER TABLE presentation_session_timeline
  ADD COLUMN IF NOT EXISTS recovery_pack_intervention jsonb;

-- Legacy receipts retain NULL; new writers fingerprint command intent independently of the
-- current room state, so an exact retry remains recoverable after further advances or finish.
ALTER TABLE presentation_session_command_receipts
  ADD COLUMN IF NOT EXISTS request_hash char(64);

CREATE OR REPLACE FUNCTION openround_presentation_recovery_pack_intervention_valid(value jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT value IS NULL OR (
    jsonb_typeof(value) = 'object'
    AND value - ARRAY['type', 'reference']::text[] = '{}'::jsonb
    AND value ->> 'type' IN ('explain', 'example')
    AND jsonb_typeof(value -> 'reference') = 'object'
    AND value -> 'reference' ?& ARRAY[
      'insertionId', 'packId', 'packVersionId', 'packVersion', 'contentHash', 'cardId'
    ]
    AND (value -> 'reference') - ARRAY[
      'insertionId', 'packId', 'packVersionId', 'packVersion', 'contentHash', 'cardId'
    ]::text[] = '{}'::jsonb
    AND CASE WHEN jsonb_typeof(value -> 'reference' -> 'packVersion') = 'number'
      AND value -> 'reference' ->> 'packVersion' ~ '^[1-9][0-9]*$'
      THEN (value -> 'reference' ->> 'packVersion')::numeric <= 9007199254740991
      ELSE false END
    AND jsonb_typeof(value -> 'reference' -> 'contentHash') = 'string'
    AND jsonb_typeof(value -> 'reference' -> 'insertionId') = 'string'
    AND jsonb_typeof(value -> 'reference' -> 'packId') = 'string'
    AND jsonb_typeof(value -> 'reference' -> 'packVersionId') = 'string'
    AND jsonb_typeof(value -> 'reference' -> 'cardId') = 'string'
    AND value -> 'reference' ->> 'contentHash' ~ '^[0-9a-f]{64}$'
    AND value -> 'reference' ->> 'insertionId' ~
      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
    AND value -> 'reference' ->> 'packId' ~
      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
    AND value -> 'reference' ->> 'packVersionId' ~
      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
    AND value -> 'reference' ->> 'cardId' ~
      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
  ) IS TRUE;
$$;

ALTER TABLE presentation_live_sessions
  DROP CONSTRAINT IF EXISTS presentation_live_sessions_recovery_pack_intervention_check;
ALTER TABLE presentation_live_sessions
  ADD CONSTRAINT presentation_live_sessions_recovery_pack_intervention_check CHECK (
    openround_presentation_recovery_pack_intervention_valid(recovery_pack_intervention)
    AND (recovery_pack_intervention IS NULL OR
      (recovery_pack_cards_enabled AND phase = 'intervention' AND status = 'active'))
  );

ALTER TABLE presentation_session_timeline
  DROP CONSTRAINT IF EXISTS presentation_session_timeline_recovery_pack_intervention_check;
ALTER TABLE presentation_session_timeline
  ADD CONSTRAINT presentation_session_timeline_recovery_pack_intervention_check CHECK (
    openround_presentation_recovery_pack_intervention_valid(recovery_pack_intervention)
    AND (recovery_pack_intervention IS NULL OR event_type = 'intervention.presented')
  );

ALTER TABLE presentation_session_command_receipts
  DROP CONSTRAINT IF EXISTS presentation_session_command_receipts_request_hash_check;
ALTER TABLE presentation_session_command_receipts
  ADD CONSTRAINT presentation_session_command_receipts_request_hash_check
    CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION enforce_presentation_session_foundation_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.trust_mode IS DISTINCT FROM OLD.trust_mode
    OR NEW.settings IS DISTINCT FROM OLD.settings
    OR NEW.recovery_pack_cards_enabled IS DISTINCT FROM OLD.recovery_pack_cards_enabled
  THEN
    RAISE EXCEPTION 'presentation trust mode, settings and Recovery Pack eligibility are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS presentation_session_foundation_immutable ON presentation_live_sessions;
CREATE TRIGGER presentation_session_foundation_immutable
  BEFORE UPDATE OF trust_mode, settings, recovery_pack_cards_enabled ON presentation_live_sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_presentation_session_foundation_immutable();

-- An overlapping legacy writer does not know this column. Leaving intervention playback must
-- still clear its active selection while preserving the immutable timeline attribution.
CREATE OR REPLACE FUNCTION clear_presentation_recovery_pack_intervention()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.phase <> 'intervention' OR NEW.status <> 'active' THEN
    NEW.recovery_pack_intervention := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS presentation_session_clear_recovery_pack_intervention
  ON presentation_live_sessions;
CREATE TRIGGER presentation_session_clear_recovery_pack_intervention
  BEFORE UPDATE OF phase, status ON presentation_live_sessions
  FOR EACH ROW EXECUTE FUNCTION clear_presentation_recovery_pack_intervention();
