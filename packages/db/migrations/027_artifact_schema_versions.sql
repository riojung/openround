-- Historical snapshots must retain the schema version they were written with; using the mutable
-- parent row's current version would make older recovery points ambiguous after a future upcast.
ALTER TABLE quiz_draft_history
  ADD COLUMN IF NOT EXISTS draft_schema_version integer NOT NULL DEFAULT 1
    CHECK (draft_schema_version > 0);

ALTER TABLE presentation_draft_history
  ADD COLUMN IF NOT EXISTS draft_schema_version integer NOT NULL DEFAULT 1
    CHECK (draft_schema_version > 0);

-- Round versions received this column in migration 002. Presentations were introduced later and
-- need the same immutable-content version marker.
ALTER TABLE presentation_versions
  ADD COLUMN IF NOT EXISTS content_schema_version integer NOT NULL DEFAULT 1
    CHECK (content_schema_version > 0);
