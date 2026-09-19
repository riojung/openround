ALTER TABLE followups
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS source_quiz_version_id uuid;

UPDATE followups AS followup
SET purpose = COALESCE(followup.purpose, 'recovery'),
    source_quiz_version_id = COALESCE(followup.source_quiz_version_id, session.quiz_version_id)
FROM game_sessions AS session
WHERE session.id = followup.source_session_id
  AND session.workspace_id = followup.workspace_id
  AND (followup.purpose IS NULL OR followup.source_quiz_version_id IS NULL);

ALTER TABLE followups
  ALTER COLUMN purpose SET DEFAULT 'recovery',
  ALTER COLUMN purpose SET NOT NULL,
  -- Keep the expand migration compatible with the previous application image,
  -- which derives recovery follow-ups from source_session_id and does not write
  -- this new column. The source-scope trigger below still prevents a null value
  -- from being persisted.
  ALTER COLUMN source_quiz_version_id DROP NOT NULL,
  ALTER COLUMN source_session_id DROP NOT NULL,
  ALTER COLUMN source_report_id DROP NOT NULL;

ALTER TABLE followups
  DROP CONSTRAINT IF EXISTS followups_source_quiz_version_fk;
ALTER TABLE followups
  ADD CONSTRAINT followups_source_quiz_version_fk
  FOREIGN KEY (source_quiz_version_id) REFERENCES quiz_versions(id) ON DELETE CASCADE;

ALTER TABLE followups
  DROP CONSTRAINT IF EXISTS followups_purpose_check,
  DROP CONSTRAINT IF EXISTS followups_source_shape_check,
  DROP CONSTRAINT IF EXISTS followups_concept_keys_check,
  DROP CONSTRAINT IF EXISTS followups_concept_shape_check;
ALTER TABLE followups
  ADD CONSTRAINT followups_purpose_check
    CHECK (purpose IN ('recovery', 'assignment')),
  ADD CONSTRAINT followups_source_shape_check
    CHECK (
      (purpose = 'recovery' AND source_session_id IS NOT NULL AND source_report_id IS NOT NULL)
      OR
      (purpose = 'assignment' AND source_session_id IS NULL AND source_report_id IS NULL)
    ),
  ADD CONSTRAINT followups_concept_shape_check
    CHECK (
      (purpose = 'recovery' AND cardinality(concept_keys) BETWEEN 1 AND 12)
      OR
      (purpose = 'assignment' AND cardinality(concept_keys) = 0)
    );

CREATE OR REPLACE FUNCTION enforce_followup_source_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.purpose = 'recovery' THEN
    -- The pre-017 writer omits source_quiz_version_id. Derive it before the
    -- validation below so rolling deploys and application rollbacks remain
    -- compatible with the expanded schema.
    IF NEW.source_quiz_version_id IS NULL THEN
      SELECT session.quiz_version_id
      INTO NEW.source_quiz_version_id
      FROM game_sessions AS session
      WHERE session.id = NEW.source_session_id
        AND session.workspace_id = NEW.workspace_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM reports AS report
      JOIN game_sessions AS session
        ON session.id = report.session_id
       AND session.workspace_id = report.workspace_id
      JOIN quiz_versions AS version
        ON version.id = session.quiz_version_id
       AND version.workspace_id = session.workspace_id
      WHERE report.id = NEW.source_report_id
        AND report.workspace_id = NEW.workspace_id
        AND session.id = NEW.source_session_id
        AND session.quiz_version_id = NEW.source_quiz_version_id
    ) THEN
      RAISE EXCEPTION 'recovery follow-up source must belong to the workspace and published version'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM quiz_versions AS version
    WHERE version.id = NEW.source_quiz_version_id
      AND version.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'practice assignment source version must belong to the workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS followups_source_scope ON followups;
CREATE TRIGGER followups_source_scope
  BEFORE INSERT OR UPDATE OF purpose, workspace_id, source_session_id, source_report_id,
    source_quiz_version_id
  ON followups
  FOR EACH ROW EXECUTE FUNCTION enforce_followup_source_scope();

CREATE OR REPLACE FUNCTION enforce_followup_immutable_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.source_quiz_version_id IS DISTINCT FROM OLD.source_quiz_version_id
    OR NEW.source_session_id IS DISTINCT FROM OLD.source_session_id
    OR NEW.source_report_id IS DISTINCT FROM OLD.source_report_id
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
    RAISE EXCEPTION 'follow-up content and schedule are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE followup_access_tokens
  DROP CONSTRAINT IF EXISTS followup_access_tokens_kind_check,
  DROP CONSTRAINT IF EXISTS followup_access_tokens_check,
  DROP CONSTRAINT IF EXISTS followup_access_tokens_kind_shape_check;
ALTER TABLE followup_access_tokens
  ADD CONSTRAINT followup_access_tokens_kind_check
    CHECK (kind IN ('personal', 'assignment_personal', 'accommodation')),
  ADD CONSTRAINT followup_access_tokens_kind_shape_check
    CHECK (
      (kind = 'personal' AND source_participant_id IS NOT NULL AND time_multiplier = 1.0)
      OR
      (kind = 'assignment_personal' AND source_participant_id IS NULL
        AND time_multiplier = 1.0 AND char_length(label) BETWEEN 1 AND 80)
      OR
      (kind = 'accommodation' AND source_participant_id IS NULL
        AND time_multiplier IN (1.5, 2.0))
    );

CREATE OR REPLACE FUNCTION enforce_followup_access_participant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  followup_purpose text;
BEGIN
  SELECT purpose INTO followup_purpose
  FROM followups
  WHERE id = NEW.followup_id
    AND workspace_id = NEW.workspace_id;

  IF followup_purpose IS NULL THEN
    RAISE EXCEPTION 'follow-up access must belong to the follow-up workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'personal' AND (
    followup_purpose <> 'recovery'
    OR NOT EXISTS (
      SELECT 1
      FROM participants AS participant
      JOIN followups AS followup ON followup.id = NEW.followup_id
      WHERE participant.id = NEW.source_participant_id
        AND participant.session_id = followup.source_session_id
        AND followup.workspace_id = NEW.workspace_id
    )
  ) THEN
    RAISE EXCEPTION 'follow-up participant must belong to the source session'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'assignment_personal' AND followup_purpose <> 'assignment' THEN
    RAISE EXCEPTION 'assignment personal access requires a practice assignment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS followup_access_participant_scope ON followup_access_tokens;
CREATE TRIGGER followup_access_participant_scope
  BEFORE INSERT OR UPDATE OF source_participant_id, followup_id, workspace_id, kind
  ON followup_access_tokens
  FOR EACH ROW EXECUTE FUNCTION enforce_followup_access_participant();

CREATE INDEX IF NOT EXISTS followups_workspace_source_version_created_idx
  ON followups (workspace_id, source_quiz_version_id, created_at DESC, id DESC);

ALTER TABLE product_events
  DROP CONSTRAINT IF EXISTS product_events_event_name_check;
ALTER TABLE product_events
  ADD CONSTRAINT product_events_event_name_check
  CHECK (event_name IN (
    'creation_started',
    'creation_completed',
    'round_published',
    'setup_recipe_selected',
    'host_setup_completed',
    'participant_joined',
    'first_answer_submitted',
    'response_saved_acknowledged',
    'question_locked',
    'insight_shown',
    'intervention_started',
    'recheck_opened',
    'report_viewed',
    'followup_shared',
    'practice_assignment_created',
    'practice_assignment_shared',
    'rehearsal_started',
    'rehearsal_completed'
  ));
