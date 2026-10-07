-- Frozen Pack practice has no source FK: deleting a Pack must not delete delivered practice.
-- Existing Round/recovery writers continue to omit these nullable expansion columns.
ALTER TABLE followups
  ADD COLUMN IF NOT EXISTS recovery_pack_source jsonb,
  ADD COLUMN IF NOT EXISTS creation_mutation_id uuid,
  ADD COLUMN IF NOT EXISTS creation_request_hash char(64);

CREATE OR REPLACE FUNCTION openround_recovery_pack_practice_uuid_valid(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (jsonb_typeof(value) = 'string' AND value #>> '{}' ~
    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$') IS TRUE;
$$;

CREATE OR REPLACE FUNCTION openround_recovery_pack_practice_source_valid(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT value IS NULL OR (
    jsonb_typeof(value) = 'object'
    AND value ?& ARRAY['artifactType','packId','packVersionId','packVersion','contentHash','packTitle','publishedAt','sourceItemId','role']
    AND value - ARRAY['artifactType','packId','packVersionId','packVersion','contentHash','packTitle','publishedAt','sourceItemId','role']::text[] = '{}'::jsonb
    AND value ->> 'artifactType' = 'recovery_pack'
    AND value ->> 'role' = 'delayed_probe'
    AND openround_recovery_pack_practice_uuid_valid(value -> 'packId')
    AND openround_recovery_pack_practice_uuid_valid(value -> 'packVersionId')
    AND openround_recovery_pack_practice_uuid_valid(value -> 'sourceItemId')
    AND jsonb_typeof(value -> 'contentHash') = 'string'
    AND value ->> 'contentHash' ~ '^[0-9a-f]{64}$'
    AND CASE WHEN jsonb_typeof(value -> 'packVersion') = 'number'
      THEN (value ->> 'packVersion')::numeric BETWEEN 1 AND 9007199254740991
        AND trunc((value ->> 'packVersion')::numeric) = (value ->> 'packVersion')::numeric
      ELSE false END
    AND jsonb_typeof(value -> 'packTitle') = 'string'
    AND char_length(btrim(value ->> 'packTitle')) BETWEEN 1 AND 160
    AND jsonb_typeof(value -> 'publishedAt') = 'string'
    AND value ->> 'publishedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?Z$'
  ) IS TRUE;
$$;

ALTER TABLE followups DROP CONSTRAINT IF EXISTS followups_practice_source_check;
ALTER TABLE followups ADD CONSTRAINT followups_practice_source_check CHECK (
  (recovery_pack_source IS NULL AND source_quiz_version_id IS NOT NULL
    AND creation_mutation_id IS NULL AND creation_request_hash IS NULL)
  OR
  (purpose = 'assignment' AND source_quiz_version_id IS NULL
    AND recovery_pack_source IS NOT NULL
    AND openround_recovery_pack_practice_source_valid(recovery_pack_source)
    AND creation_mutation_id IS NOT NULL
    AND creation_request_hash IS NOT NULL AND creation_request_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS followups_creation_mutation_uq
  ON followups (workspace_id, creation_mutation_id) WHERE creation_mutation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_followup_source_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recovery_pack_source IS NOT NULL THEN
    IF NOT openround_recovery_pack_practice_source_valid(NEW.recovery_pack_source) THEN
      RAISE EXCEPTION 'invalid frozen Pack practice source' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM recovery_packs AS pack
      JOIN recovery_pack_versions AS version
        ON version.id = pack.current_version_id AND version.pack_id = pack.id
       AND version.workspace_id = pack.workspace_id
      WHERE pack.workspace_id = NEW.workspace_id
        AND pack.id = (NEW.recovery_pack_source ->> 'packId')::uuid
        AND version.id = (NEW.recovery_pack_source ->> 'packVersionId')::uuid
        AND version.version = (NEW.recovery_pack_source ->> 'packVersion')::numeric
        AND version.content_hash = NEW.recovery_pack_source ->> 'contentHash'
        AND version.content ->> 'title' = NEW.recovery_pack_source ->> 'packTitle'
        AND date_trunc('milliseconds', version.published_at) = (NEW.recovery_pack_source ->> 'publishedAt')::timestamptz
        AND version.content -> 'delayedProbe' IS NOT NULL
        AND version.content -> 'delayedProbe' <> 'null'::jsonb
        AND version.content -> 'delayedProbe' ->> 'id' = NEW.recovery_pack_source ->> 'sourceItemId'
    ) THEN
      RAISE EXCEPTION 'Pack practice source must be the current workspace version with a delayed probe' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW.content -> 'questions') IS DISTINCT FROM 'array'
      OR jsonb_array_length(NEW.content -> 'questions') <> 1
      OR COALESCE(NEW.content -> 'questions' -> 0 ->> 'delivery', 'main') <> 'main'
      OR COALESCE(NEW.content -> 'questions' -> 0 -> 'linkedRecheckQuestionId', 'null'::jsonb) <> 'null'::jsonb
      OR (
        NEW.content -> 'questions' -> 0 -> 'recoveryPackSource' ->> 'artifactType' = 'recovery_pack'
        AND NEW.content -> 'questions' -> 0 -> 'recoveryPackSource' ->> 'role' = 'delayed_probe'
        AND NEW.content -> 'questions' -> 0 -> 'recoveryPackSource' ->> 'packId' = NEW.recovery_pack_source ->> 'packId'
        AND NEW.content -> 'questions' -> 0 -> 'recoveryPackSource' ->> 'packVersionId' = NEW.recovery_pack_source ->> 'packVersionId'
        AND NEW.content -> 'questions' -> 0 -> 'recoveryPackSource' -> 'packVersion' = NEW.recovery_pack_source -> 'packVersion'
        AND NEW.content -> 'questions' -> 0 -> 'recoveryPackSource' ->> 'sourceItemId' = NEW.recovery_pack_source ->> 'sourceItemId'
      ) IS NOT TRUE
    THEN
      RAISE EXCEPTION 'Pack practice must contain one standalone copied delayed probe' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.purpose = 'recovery' THEN
    IF NEW.source_quiz_version_id IS NULL THEN
      SELECT session.quiz_version_id INTO NEW.source_quiz_version_id
      FROM game_sessions AS session
      WHERE session.id = NEW.source_session_id AND session.workspace_id = NEW.workspace_id;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM reports AS report
      JOIN game_sessions AS session ON session.id = report.session_id AND session.workspace_id = report.workspace_id
      JOIN quiz_versions AS version ON version.id = session.quiz_version_id AND version.workspace_id = session.workspace_id
      WHERE report.id = NEW.source_report_id AND report.workspace_id = NEW.workspace_id
        AND session.id = NEW.source_session_id AND session.quiz_version_id = NEW.source_quiz_version_id
    ) THEN
      RAISE EXCEPTION 'recovery follow-up source must belong to the workspace and published version' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM quiz_versions AS version
    WHERE version.id = NEW.source_quiz_version_id AND version.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'practice assignment source version must belong to the workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS followups_source_scope ON followups;
CREATE TRIGGER followups_source_scope
  BEFORE INSERT OR UPDATE OF purpose, workspace_id, source_session_id, source_report_id,
    source_quiz_version_id, recovery_pack_source ON followups
  FOR EACH ROW EXECUTE FUNCTION enforce_followup_source_scope();

CREATE OR REPLACE FUNCTION enforce_followup_immutable_content()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.source_quiz_version_id IS DISTINCT FROM OLD.source_quiz_version_id
    OR NEW.source_session_id IS DISTINCT FROM OLD.source_session_id
    OR NEW.source_report_id IS DISTINCT FROM OLD.source_report_id
    OR NEW.recovery_pack_source IS DISTINCT FROM OLD.recovery_pack_source
    OR NEW.creation_mutation_id IS DISTINCT FROM OLD.creation_mutation_id
    OR NEW.creation_request_hash IS DISTINCT FROM OLD.creation_request_hash
    OR (OLD.recovery_pack_source IS NOT NULL AND NEW.generic_token_hash IS DISTINCT FROM OLD.generic_token_hash)
    OR NEW.trust_mode IS DISTINCT FROM OLD.trust_mode
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.concept_keys IS DISTINCT FROM OLD.concept_keys
    OR NEW.time_mode IS DISTINCT FROM OLD.time_mode
    OR NEW.opens_at IS DISTINCT FROM OLD.opens_at
    OR NEW.closes_at IS DISTINCT FROM OLD.closes_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'follow-up content, source, creation receipt and schedule are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE media_references DROP CONSTRAINT IF EXISTS media_references_owner_type_check;
ALTER TABLE media_references ADD CONSTRAINT media_references_owner_type_check CHECK (owner_type IN (
  'quiz_draft', 'quiz_version', 'quiz_history', 'presentation_draft', 'presentation_version',
  'presentation_history', 'recovery_pack_draft', 'recovery_pack_version', 'recovery_pack_history',
  'recovery_pack_mutation', 'followup'
));

CREATE OR REPLACE FUNCTION openround_sync_pack_practice_media()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recovery_pack_source IS NOT NULL THEN
    PERFORM openround_replace_media_references(NEW.workspace_id, 'followup', NEW.id, NEW.content, 'quiz');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS followups_sync_pack_practice_media ON followups;
CREATE TRIGGER followups_sync_pack_practice_media AFTER INSERT ON followups
  FOR EACH ROW EXECUTE FUNCTION openround_sync_pack_practice_media();
DROP TRIGGER IF EXISTS followups_remove_media_references ON followups;
CREATE TRIGGER followups_remove_media_references BEFORE DELETE ON followups
  FOR EACH ROW EXECUTE FUNCTION openround_remove_owned_media_references('followup');

-- No new tables or policies: followups and media_references retain forced workspace RLS,
-- existing access/attempt/answer cascades, and the assignment expiry/account-deletion lifecycle.
