-- Expand the existing forced-RLS parents; frozen practice never references a live Pack by FK.
ALTER TABLE followups ADD COLUMN IF NOT EXISTS recovery_pack_sequence jsonb;
ALTER TABLE followup_attempts
  ADD COLUMN IF NOT EXISTS intervention_index integer,
  ADD COLUMN IF NOT EXISTS advance_receipts jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE followup_answers ADD COLUMN IF NOT EXISTS submitted_version integer
  CHECK (submitted_version >= 0);

CREATE OR REPLACE FUNCTION openround_recovery_pack_practice_source_valid(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT value IS NULL OR (
    jsonb_typeof(value) = 'object'
    AND value ?& ARRAY['artifactType','packId','packVersionId','packVersion','contentHash','packTitle','publishedAt','sourceItemId','role']
    AND value - ARRAY['artifactType','packId','packVersionId','packVersion','contentHash','packTitle','publishedAt','sourceItemId','role']::text[] = '{}'::jsonb
    AND value ->> 'artifactType' = 'recovery_pack'
    AND value ->> 'role' IN ('delayed_probe', 'full_sequence')
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

CREATE OR REPLACE FUNCTION openround_recovery_pack_sequence_citation_valid(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (
    jsonb_typeof(value) = 'object'
    AND value - ARRAY['sourceName','sourceDigest','locator','excerpt']::text[] = '{}'::jsonb
    AND jsonb_typeof(value -> 'sourceName') = 'string'
    AND char_length(btrim(value ->> 'sourceName')) BETWEEN 1 AND 200
    AND jsonb_typeof(value -> 'sourceDigest') = 'string'
    AND value ->> 'sourceDigest' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(value -> 'locator') = 'string'
    AND char_length(btrim(value ->> 'locator')) BETWEEN 1 AND 120
    AND jsonb_typeof(value -> 'excerpt') = 'string'
    AND char_length(btrim(value ->> 'excerpt')) BETWEEN 1 AND 500
  ) IS TRUE;
$$;

CREATE OR REPLACE FUNCTION openround_recovery_pack_sequence_valid(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE card jsonb; citation jsonb; ids text[] := ARRAY[]::text[];
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) IS DISTINCT FROM 'object'
    OR NOT value ?& ARRAY['schemaVersion','interventions','citations']
    OR value - ARRAY['schemaVersion','interventions','citations']::text[] <> '{}'::jsonb
    OR (value -> 'schemaVersion' = '1'::jsonb) IS NOT TRUE
    OR jsonb_typeof(value -> 'interventions') IS DISTINCT FROM 'array'
    OR jsonb_typeof(value -> 'citations') IS DISTINCT FROM 'array'
  THEN RETURN false; END IF;
  IF jsonb_array_length(value -> 'interventions') NOT BETWEEN 1 AND 5
    OR jsonb_array_length(value -> 'citations') > 20
  THEN RETURN false; END IF;
  FOR card IN SELECT * FROM jsonb_array_elements(value -> 'interventions') LOOP
    IF (
      jsonb_typeof(card) = 'object'
      AND card - ARRAY['id','title','body','citations']::text[] = '{}'::jsonb
      AND openround_recovery_pack_practice_uuid_valid(card -> 'id')
      AND jsonb_typeof(card -> 'title') = 'string'
      AND char_length(btrim(card ->> 'title')) BETWEEN 1 AND 160
      AND jsonb_typeof(card -> 'body') = 'string'
      AND char_length(btrim(card ->> 'body')) BETWEEN 1 AND 2000
      AND jsonb_typeof(card -> 'citations') = 'array'
    ) IS NOT TRUE THEN RETURN false; END IF;
    IF card ->> 'id' = ANY(ids) OR jsonb_array_length(card -> 'citations') > 5
    THEN RETURN false; END IF;
    ids := array_append(ids, card ->> 'id');
    FOR citation IN SELECT * FROM jsonb_array_elements(card -> 'citations') LOOP
      IF NOT openround_recovery_pack_sequence_citation_valid(citation) THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  FOR citation IN SELECT * FROM jsonb_array_elements(value -> 'citations') LOOP
    IF NOT openround_recovery_pack_sequence_citation_valid(citation) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE followups DROP CONSTRAINT IF EXISTS followups_recovery_pack_sequence_check;
ALTER TABLE followups ADD CONSTRAINT followups_recovery_pack_sequence_check CHECK (
  (recovery_pack_sequence IS NULL AND COALESCE(recovery_pack_source ->> 'role', '') <> 'full_sequence')
  OR (purpose = 'assignment' AND recovery_pack_source IS NOT NULL
    AND recovery_pack_source ->> 'role' = 'full_sequence'
    AND recovery_pack_sequence IS NOT NULL
    AND openround_recovery_pack_sequence_valid(recovery_pack_sequence))
);

-- Recreate the parsed QuestionSchema's JSON property order for its provenance hash.
-- JSONB storage order is not the JSON.stringify order used by published Pack copies.
CREATE OR REPLACE FUNCTION openround_recovery_pack_question_json(value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE keys text[]; result text; kind text := jsonb_typeof(value);
BEGIN
  IF kind = 'array' THEN
    SELECT '[' || COALESCE(string_agg(openround_recovery_pack_question_json(item), ',' ORDER BY ordinal), '') || ']'
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS items(item, ordinal);
    RETURN result;
  ELSIF kind <> 'object' THEN RETURN value::text;
  END IF;
  IF value ? 'prompt' THEN
    keys := ARRAY['id','prompt','purpose','confidence','delivery','conceptKeys','linkedRecheckQuestionId',
      'timeLimitSeconds','basePoints','explanation','mediaId','mediaAlt','sourceCitations','recoveryPackSource',
      'type','choices','correctValue','tolerance','unit','min','max','minLabel','maxLabel'];
  ELSIF value ? 'isCorrect' THEN
    keys := ARRAY['id','label','isCorrect','feedback','misconceptionKey'];
  ELSIF value ? 'sourceDigest' THEN
    keys := ARRAY['sourceName','sourceDigest','locator','excerpt'];
  ELSIF value ->> 'artifactType' = 'recovery_pack' THEN
    keys := ARRAY['artifactType','packId','packVersionId','packVersion','sourceItemId','role','contentHash'];
  ELSE
    RAISE EXCEPTION 'invalid nested published Pack question JSON' USING ERRCODE = '23514';
  END IF;
  SELECT '{' || COALESCE(string_agg(to_jsonb(key)::text || ':' ||
    openround_recovery_pack_question_json(value -> key), ',' ORDER BY ordinal), '') || '}'
    INTO result FROM unnest(keys) WITH ORDINALITY AS fields(key, ordinal) WHERE value ? key;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION openround_recovery_pack_question_body(value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result jsonb := value - ARRAY['id','delivery','linkedRecheckQuestionId','recoveryPackSource']::text[];
BEGIN
  IF jsonb_typeof(value -> 'choices') = 'array' THEN
    result := jsonb_set(result, '{choices}', (
      SELECT jsonb_agg(choice - 'id' ORDER BY ordinal)
      FROM jsonb_array_elements(value -> 'choices') WITH ORDINALITY AS choices(choice, ordinal)
    ));
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_followup_source_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_content jsonb; copied jsonb; original jsonb; role text; item_index integer;
BEGIN
  IF NEW.recovery_pack_source IS NOT NULL THEN
    IF NOT openround_recovery_pack_practice_source_valid(NEW.recovery_pack_source) THEN
      RAISE EXCEPTION 'invalid frozen Pack practice source' USING ERRCODE = '23514';
    END IF;
    SELECT version.content INTO source_content
      FROM recovery_packs AS pack JOIN recovery_pack_versions AS version
        ON version.id = pack.current_version_id AND version.pack_id = pack.id
       AND version.workspace_id = pack.workspace_id
      WHERE pack.workspace_id = NEW.workspace_id
        AND pack.id = (NEW.recovery_pack_source ->> 'packId')::uuid
        AND version.id = (NEW.recovery_pack_source ->> 'packVersionId')::uuid
        AND version.version = (NEW.recovery_pack_source ->> 'packVersion')::numeric
        AND version.content_hash = NEW.recovery_pack_source ->> 'contentHash'
        AND version.content ->> 'title' = NEW.recovery_pack_source ->> 'packTitle'
        AND date_trunc('milliseconds', version.published_at) = (NEW.recovery_pack_source ->> 'publishedAt')::timestamptz;
    IF source_content IS NULL THEN
      RAISE EXCEPTION 'Pack practice source must be the current workspace version' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW.content -> 'questions') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Pack practice requires copied checkpoints' USING ERRCODE = '23514';
    END IF;
    IF NEW.recovery_pack_source ->> 'role' = 'delayed_probe' THEN
      IF (source_content -> 'delayedProbe' ->> 'id' = NEW.recovery_pack_source ->> 'sourceItemId') IS NOT TRUE
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
      THEN RAISE EXCEPTION 'Pack practice must contain one standalone copied delayed probe' USING ERRCODE = '23514';
      END IF;
    ELSE
      IF (NEW.recovery_pack_source ->> 'sourceItemId' = source_content -> 'diagnostic' ->> 'id') IS NOT TRUE
        OR NOT openround_recovery_pack_sequence_valid(NEW.recovery_pack_sequence)
        OR (NEW.recovery_pack_sequence = jsonb_build_object('schemaVersion', 1,
          'interventions', source_content -> 'interventions', 'citations', source_content -> 'citations')) IS NOT TRUE
        OR jsonb_array_length(NEW.content -> 'questions') <> 2
        OR COALESCE(NEW.content -> 'questions' -> 0 ->> 'delivery', 'main') <> 'main'
        OR (NEW.content -> 'questions' -> 1 ->> 'delivery' = 'recheck') IS NOT TRUE
        OR (NEW.content -> 'questions' -> 0 ->> 'linkedRecheckQuestionId' = NEW.content -> 'questions' -> 1 ->> 'id') IS NOT TRUE
        OR COALESCE(NEW.content -> 'questions' -> 1 -> 'linkedRecheckQuestionId', 'null'::jsonb) <> 'null'::jsonb
        OR (NEW.content -> 'questions' -> 0 ->> 'id' = NEW.content -> 'questions' -> 1 ->> 'id') IS NOT FALSE
      THEN RAISE EXCEPTION 'Pack sequence must freeze its current cards and linked diagnostic/recheck' USING ERRCODE = '23514';
      END IF;
      FOR item_index IN 0..1 LOOP
        role := CASE WHEN item_index = 0 THEN 'diagnostic' ELSE 'recheck' END;
        copied := NEW.content -> 'questions' -> item_index;
        original := source_content -> role;
        IF (
          copied -> 'recoveryPackSource' ->> 'artifactType' = 'recovery_pack'
          AND copied -> 'recoveryPackSource' ->> 'role' = role
          AND copied -> 'recoveryPackSource' ->> 'packId' = NEW.recovery_pack_source ->> 'packId'
          AND copied -> 'recoveryPackSource' ->> 'packVersionId' = NEW.recovery_pack_source ->> 'packVersionId'
          AND copied -> 'recoveryPackSource' -> 'packVersion' = NEW.recovery_pack_source -> 'packVersion'
          AND copied -> 'recoveryPackSource' ->> 'sourceItemId' = original ->> 'id'
          AND copied -> 'recoveryPackSource' ->> 'contentHash' = encode(sha256(convert_to(openround_recovery_pack_question_json(original), 'UTF8')), 'hex')
          AND openround_recovery_pack_question_body(copied) = openround_recovery_pack_question_body(original)
        ) IS NOT TRUE THEN
          RAISE EXCEPTION 'Pack sequence checkpoint content and provenance must match its source' USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END IF;
  ELSIF NEW.purpose = 'recovery' THEN
    IF NEW.source_quiz_version_id IS NULL THEN
      SELECT session.quiz_version_id INTO NEW.source_quiz_version_id FROM game_sessions AS session
      WHERE session.id = NEW.source_session_id AND session.workspace_id = NEW.workspace_id;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM reports AS report
      JOIN game_sessions AS session ON session.id = report.session_id AND session.workspace_id = report.workspace_id
      JOIN quiz_versions AS version ON version.id = session.quiz_version_id AND version.workspace_id = session.workspace_id
      WHERE report.id = NEW.source_report_id AND report.workspace_id = NEW.workspace_id
        AND session.id = NEW.source_session_id AND session.quiz_version_id = NEW.source_quiz_version_id
    ) THEN RAISE EXCEPTION 'recovery follow-up source must belong to the workspace and published version' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM quiz_versions AS version WHERE version.id = NEW.source_quiz_version_id AND version.workspace_id = NEW.workspace_id
  ) THEN RAISE EXCEPTION 'practice assignment source version must belong to the workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS followups_source_scope ON followups;
CREATE TRIGGER followups_source_scope
  BEFORE INSERT OR UPDATE OF purpose, workspace_id, source_session_id, source_report_id,
    source_quiz_version_id, recovery_pack_source, recovery_pack_sequence, content ON followups
  FOR EACH ROW EXECUTE FUNCTION enforce_followup_source_scope();

-- The pre-existing immutable trigger keeps enforcing content, source, receipt and schedule.
CREATE OR REPLACE FUNCTION enforce_followup_immutable_sequence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recovery_pack_sequence IS DISTINCT FROM OLD.recovery_pack_sequence THEN
    RAISE EXCEPTION 'follow-up intervention sequence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS followups_immutable_sequence ON followups;
CREATE TRIGGER followups_immutable_sequence BEFORE UPDATE ON followups
  FOR EACH ROW EXECUTE FUNCTION enforce_followup_immutable_sequence();

CREATE OR REPLACE FUNCTION openround_followup_advance_receipts_valid(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE receipt record; entry_count integer := 0;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  FOR receipt IN SELECT * FROM jsonb_each(value) LOOP
    entry_count := entry_count + 1;
    IF entry_count > 256 OR NOT openround_recovery_pack_practice_uuid_valid(to_jsonb(receipt.key))
      OR jsonb_typeof(receipt.value) IS DISTINCT FROM 'number'
    THEN RETURN false; END IF;
    IF (receipt.value #>> '{}')::numeric NOT BETWEEN 0 AND 2147483647
      OR trunc((receipt.value #>> '{}')::numeric) <> (receipt.value #>> '{}')::numeric
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE followup_attempts DROP CONSTRAINT IF EXISTS followup_attempts_phase_check;
ALTER TABLE followup_attempts ADD CONSTRAINT followup_attempts_phase_check
  CHECK (phase IN ('question_open', 'answer_reveal', 'intervention', 'completed'));
ALTER TABLE followup_attempts DROP CONSTRAINT IF EXISTS followup_attempts_intervention_index_check;
ALTER TABLE followup_attempts ADD CONSTRAINT followup_attempts_intervention_index_check CHECK (
  (phase = 'intervention' AND intervention_index IS NOT NULL AND intervention_index BETWEEN 0 AND 4)
  OR (phase <> 'intervention' AND intervention_index IS NULL)
);
ALTER TABLE followup_attempts DROP CONSTRAINT IF EXISTS followup_attempts_advance_receipts_check;
ALTER TABLE followup_attempts ADD CONSTRAINT followup_attempts_advance_receipts_check
  CHECK (openround_followup_advance_receipts_valid(advance_receipts));

CREATE OR REPLACE FUNCTION enforce_followup_attempt_sequence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phase = 'intervention' AND NOT EXISTS (
    SELECT 1 FROM followups AS followup WHERE followup.id = NEW.followup_id
      AND followup.workspace_id = NEW.workspace_id
      AND followup.recovery_pack_source ->> 'role' = 'full_sequence'
      AND NEW.current_index = 0
      AND NEW.intervention_index < jsonb_array_length(followup.recovery_pack_sequence -> 'interventions')
  ) THEN RAISE EXCEPTION 'intervention phase requires a frozen sequence and valid card index' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.advance_receipts IS DISTINCT FROM OLD.advance_receipts THEN
    IF NOT (OLD.advance_receipts <@ NEW.advance_receipts)
      OR (SELECT count(*) FROM jsonb_object_keys(NEW.advance_receipts)) <>
        (SELECT count(*) FROM jsonb_object_keys(OLD.advance_receipts)) + 1
      OR EXISTS (SELECT 1 FROM jsonb_each(NEW.advance_receipts) AS receipt
        WHERE NOT (OLD.advance_receipts ? receipt.key) AND receipt.value <> to_jsonb(OLD.version))
    THEN RAISE EXCEPTION 'advance receipts append the original version without rewriting history' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS followup_attempts_sequence_scope ON followup_attempts;
CREATE TRIGGER followup_attempts_sequence_scope BEFORE INSERT OR UPDATE ON followup_attempts
  FOR EACH ROW EXECUTE FUNCTION enforce_followup_attempt_sequence();

-- No new tables or policies: sequence, receipts and submitted fences inherit forced workspace
-- RLS, media ownership, account exports/deletion, assignment expiry and child cascades.
