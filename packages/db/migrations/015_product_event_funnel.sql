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
    'rehearsal_started',
    'rehearsal_completed'
  ));
