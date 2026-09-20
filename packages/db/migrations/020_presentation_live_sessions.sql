CREATE TABLE IF NOT EXISTS presentation_live_sessions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  presentation_id uuid NOT NULL,
  presentation_version_id uuid NOT NULL,
  title text NOT NULL,
  content_snapshot jsonb NOT NULL,
  join_code char(7) NOT NULL UNIQUE CHECK (join_code ~ '^[0-9]{7}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  phase text NOT NULL DEFAULT 'lobby'
    CHECK (phase IN ('lobby', 'content', 'question_open', 'question_reveal', 'finished')),
  current_block_index integer NOT NULL DEFAULT -1 CHECK (current_block_index >= -1),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, presentation_id, presentation_version_id)
    REFERENCES presentation_versions(workspace_id, presentation_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS presentation_live_participants (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 32),
  token_hash char(64) NOT NULL UNIQUE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, session_id, id),
  FOREIGN KEY (workspace_id, session_id)
    REFERENCES presentation_live_sessions(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS presentation_live_responses (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  block_id uuid NOT NULL,
  question_id uuid NOT NULL,
  response jsonb NOT NULL,
  correct boolean,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, participant_id, block_id),
  FOREIGN KEY (workspace_id, session_id)
    REFERENCES presentation_live_sessions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, session_id, participant_id)
    REFERENCES presentation_live_participants(workspace_id, session_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS presentation_session_timeline (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL
    CHECK (event_type IN ('presentation.started', 'content.presented', 'question.launched',
                          'question.revealed', 'presentation.finished')),
  block_index integer,
  block_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, sequence),
  FOREIGN KEY (workspace_id, session_id)
    REFERENCES presentation_live_sessions(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS presentation_live_sessions_workspace_idx
  ON presentation_live_sessions (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS presentation_live_participants_session_idx
  ON presentation_live_participants (workspace_id, session_id, joined_at);
CREATE INDEX IF NOT EXISTS presentation_live_responses_session_idx
  ON presentation_live_responses (workspace_id, session_id, block_id);
CREATE INDEX IF NOT EXISTS presentation_session_timeline_session_idx
  ON presentation_session_timeline (workspace_id, session_id, sequence);

ALTER TABLE presentation_live_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_live_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_live_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_session_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_live_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE presentation_live_participants FORCE ROW LEVEL SECURITY;
ALTER TABLE presentation_live_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE presentation_session_timeline FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'presentation_live_sessions', 'presentation_live_participants',
    'presentation_live_responses', 'presentation_session_timeline'
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON presentation_live_sessions, presentation_live_participants, presentation_live_responses, presentation_session_timeline TO openround_runtime';
  END IF;
END $$;
