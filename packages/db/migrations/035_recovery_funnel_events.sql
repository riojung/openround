ALTER TABLE product_events
  DROP CONSTRAINT IF EXISTS product_events_event_name_check;

ALTER TABLE product_events
  ADD CONSTRAINT product_events_event_name_check
  CHECK (event_name IN (
    'creation_started',
    'creation_completed',
    'first_block_created',
    'draft_save_failed',
    'draft_conflict',
    'publish_blocked',
    'creation_abandoned',
    'presentation_host_started',
    'presentation_reconnected',
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
    'linked_recheck_opened',
    'report_reconciled',
    'report_viewed',
    'followup_shared',
    'practice_assignment_created',
    'practice_assignment_shared',
    'rehearsal_started',
    'rehearsal_completed'
  ));

ALTER TABLE product_events
  DROP CONSTRAINT IF EXISTS product_events_recovery_artifact_check;
ALTER TABLE product_events
  ADD CONSTRAINT product_events_recovery_artifact_check
  CHECK (
    event_name NOT IN ('linked_recheck_opened', 'report_reconciled')
    OR (
      dimensions ? 'artifactType'
      AND COALESCE(jsonb_typeof(dimensions -> 'artifactType') = 'string', false)
      AND dimensions->>'artifactType' IN ('round', 'presentation')
    )
  );
