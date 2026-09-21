CREATE TABLE IF NOT EXISTS collaboration_groups (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS collaboration_group_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (workspace_id, group_id)
    REFERENCES collaboration_groups(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collaboration_group_artifacts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id uuid NOT NULL,
  artifact_type text NOT NULL CHECK (artifact_type IN ('round', 'presentation')),
  artifact_id uuid NOT NULL,
  added_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, artifact_type, artifact_id),
  FOREIGN KEY (workspace_id, group_id)
    REFERENCES collaboration_groups(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collaboration_group_messages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, group_id)
    REFERENCES collaboration_groups(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collaboration_group_schedule (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id uuid NOT NULL,
  artifact_type text NOT NULL CHECK (artifact_type IN ('round', 'presentation')),
  artifact_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('live_session', 'round_assignment')),
  scheduled_for timestamptz NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'round_assignment' OR artifact_type = 'round'),
  FOREIGN KEY (workspace_id, group_id)
    REFERENCES collaboration_groups(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS collaboration_groups_workspace_updated_idx
  ON collaboration_groups (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS collaboration_group_members_user_idx
  ON collaboration_group_members (workspace_id, user_id, joined_at);
CREATE INDEX IF NOT EXISTS collaboration_group_artifacts_group_idx
  ON collaboration_group_artifacts (workspace_id, group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS collaboration_group_messages_group_idx
  ON collaboration_group_messages (workspace_id, group_id, created_at);
CREATE INDEX IF NOT EXISTS collaboration_group_schedule_group_idx
  ON collaboration_group_schedule (workspace_id, group_id, scheduled_for);

ALTER TABLE collaboration_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_group_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_group_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE collaboration_group_members FORCE ROW LEVEL SECURITY;
ALTER TABLE collaboration_group_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE collaboration_group_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE collaboration_group_schedule FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'collaboration_groups', 'collaboration_group_members',
    'collaboration_group_artifacts', 'collaboration_group_messages',
    'collaboration_group_schedule'
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON collaboration_groups, collaboration_group_members, collaboration_group_artifacts, collaboration_group_messages, collaboration_group_schedule TO openround_runtime';
  END IF;
END $$;
