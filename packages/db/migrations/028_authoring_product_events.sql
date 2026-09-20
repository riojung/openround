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
    'report_viewed',
    'followup_shared',
    'practice_assignment_created',
    'practice_assignment_shared',
    'rehearsal_started',
    'rehearsal_completed'
  ));

ALTER TABLE product_events
  DROP CONSTRAINT IF EXISTS product_events_dimensions_check;
ALTER TABLE product_events
  ADD CONSTRAINT product_events_dimensions_check
  CHECK (
    jsonb_typeof(dimensions) = 'object'
    AND dimensions - ARRAY[
      'creationPath', 'artifactType', 'recipe', 'scenario', 'segment', 'betaVersion',
      'durationBucket'
    ]::text[] = '{}'::jsonb
    AND (dimensions->>'creationPath' IS NULL OR dimensions->>'creationPath' IN (
      'starter', 'source', 'import', 'blank'
    ))
    AND (dimensions->>'artifactType' IS NULL OR dimensions->>'artifactType' IN (
      'round', 'presentation'
    ))
    AND (dimensions->>'recipe' IS NULL OR dimensions->>'recipe' IN (
      'recovery', 'friendly_competition', 'open_discussion'
    ))
    AND (dimensions->>'scenario' IS NULL OR dimensions->>'scenario' IN (
      'low_participation', 'split_room', 'confident_misconception'
    ))
    AND (dimensions->>'segment' IS NULL OR dimensions->>'segment' IN (
      'education', 'workplace'
    ))
    AND (dimensions->>'betaVersion' IS NULL OR dimensions->>'betaVersion' = 'p0-2026')
    AND (dimensions->>'durationBucket' IS NULL OR dimensions->>'durationBucket' IN (
      'under_1m', '1_to_5m', '5_to_15m', 'over_15m'
    ))
  );
