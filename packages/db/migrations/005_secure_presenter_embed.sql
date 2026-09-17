ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS embed_allowed_origins text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE session_staff_credentials
  ADD COLUMN IF NOT EXISTS embed_policy_key_hash text,
  ADD COLUMN IF NOT EXISTS embed_allowed_origins text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE UNIQUE INDEX IF NOT EXISTS session_staff_embed_policy_key_uq
  ON session_staff_credentials (embed_policy_key_hash)
  WHERE embed_policy_key_hash IS NOT NULL;

UPDATE session_staff_credentials
SET embed_policy_key_hash = 'legacy-unavailable-' || id::text
WHERE role = 'presenter' AND embed_policy_key_hash IS NULL;

ALTER TABLE workspaces
  DROP CONSTRAINT IF EXISTS workspaces_embed_allowed_origins_limit,
  ADD CONSTRAINT workspaces_embed_allowed_origins_limit
    CHECK (cardinality(embed_allowed_origins) <= 10);

ALTER TABLE session_staff_credentials
  DROP CONSTRAINT IF EXISTS session_staff_embed_allowed_origins_limit,
  ADD CONSTRAINT session_staff_embed_allowed_origins_limit
    CHECK (cardinality(embed_allowed_origins) <= 10),
  DROP CONSTRAINT IF EXISTS session_staff_embed_policy_role_check,
  ADD CONSTRAINT session_staff_embed_policy_role_check CHECK (
    (role = 'presenter' AND embed_policy_key_hash IS NOT NULL)
    OR (role = 'cohost' AND embed_policy_key_hash IS NULL)
  );
