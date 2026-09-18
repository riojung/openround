CREATE TABLE IF NOT EXISTS session_interaction_settings (
  session_id uuid PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  signals_enabled boolean NOT NULL DEFAULT true,
  chat_enabled boolean NOT NULL DEFAULT false,
  chat_identity_mode text NOT NULL DEFAULT 'alias_public'
    CHECK (chat_identity_mode IN ('alias_public', 'alias_private')),
  slow_mode_seconds integer NOT NULL DEFAULT 5
    CHECK (slow_mode_seconds IN (0, 5, 15, 30)),
  presenter_feed_mode text NOT NULL DEFAULT 'pinned'
    CHECK (presenter_feed_mode IN ('off', 'pinned', 'live')),
  audience_seq bigint NOT NULL DEFAULT 0 CHECK (audience_seq >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS participant_signal_state (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  context_key text NOT NULL CHECK (char_length(context_key) BETWEEN 1 AND 160),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  signal text NOT NULL CHECK (signal IN ('got_it', 'unsure', 'need_example', 'too_fast')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, context_key, participant_id)
);

CREATE INDEX IF NOT EXISTS participant_signal_state_context_idx
  ON participant_signal_state (session_id, context_key, signal);

CREATE TABLE IF NOT EXISTS participant_signal_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  context_key text NOT NULL CHECK (char_length(context_key) BETWEEN 1 AND 160),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  signal text CHECK (signal IS NULL OR signal IN ('got_it', 'unsure', 'need_example', 'too_fast')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 160),
  audience_seq bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, idempotency_key),
  UNIQUE (session_id, audience_seq)
);

CREATE INDEX IF NOT EXISTS participant_signal_events_context_idx
  ON participant_signal_events (session_id, context_key, created_at, id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES participants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  staff_credential_id uuid REFERENCES session_staff_credentials(id) ON DELETE SET NULL,
  reply_to_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  author_alias text NOT NULL CHECK (char_length(author_alias) BETWEEN 1 AND 80),
  identity_mode_at_creation text NOT NULL
    CHECK (identity_mode_at_creation IN ('alias_public', 'alias_private')),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'removed')),
  pinned boolean NOT NULL DEFAULT false,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 160),
  audience_seq bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(participant_id, actor_id, staff_credential_id) = 1),
  UNIQUE (session_id, idempotency_key),
  UNIQUE (session_id, audience_seq)
);

CREATE INDEX IF NOT EXISTS chat_messages_session_cursor_idx
  ON chat_messages (session_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS chat_messages_participant_rate_idx
  ON chat_messages (session_id, participant_id, created_at DESC)
  WHERE participant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_messages_reply_idx
  ON chat_messages (reply_to_id, created_at, id)
  WHERE reply_to_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_message_reactions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (reaction IN ('like', 'love', 'insight', 'laugh')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, participant_id)
);

CREATE TABLE IF NOT EXISTS chat_message_reports (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, participant_id)
);

CREATE TABLE IF NOT EXISTS session_audience_restrictions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  muted_until timestamptz,
  banned_at timestamptz,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  staff_credential_id uuid REFERENCES session_staff_credentials(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, participant_id),
  CHECK (num_nonnulls(actor_id, staff_credential_id) <= 1)
);

CREATE TABLE IF NOT EXISTS audience_outbox (
  event_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  audience_seq bigint NOT NULL,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 100),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 160),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, audience_seq),
  UNIQUE (session_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS audience_outbox_pending_idx
  ON audience_outbox (created_at, event_id)
  WHERE delivered_at IS NULL;

ALTER TABLE session_interaction_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_signal_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_signal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_audience_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audience_outbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE session_interaction_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE participant_signal_state FORCE ROW LEVEL SECURITY;
ALTER TABLE participant_signal_events FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_message_reactions FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_message_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE session_audience_restrictions FORCE ROW LEVEL SECURITY;
ALTER TABLE audience_outbox FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'session_interaction_settings', 'participant_signal_state',
    'participant_signal_events', 'chat_messages', 'chat_message_reactions',
    'chat_message_reports', 'session_audience_restrictions', 'audience_outbox'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I USING (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), '''')) WITH CHECK (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), ''''))',
      table_name
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON session_interaction_settings, participant_signal_state, participant_signal_events, chat_messages, chat_message_reactions, chat_message_reports, session_audience_restrictions, audience_outbox TO openround_runtime';
  END IF;
END $$;
