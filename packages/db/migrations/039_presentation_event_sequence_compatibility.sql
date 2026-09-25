-- Expand first so the write-blocking compatibility backfill can run in its own short transaction.
-- The offset preserves any historical timeline sequence that is ahead of revision plus child-row
-- cardinalities without making later optimized response writes plateau at that imported value.
ALTER TABLE presentation_live_sessions
  ADD COLUMN IF NOT EXISTS event_seq_offset bigint NOT NULL DEFAULT 0;

ALTER TABLE presentation_live_sessions
  DROP CONSTRAINT IF EXISTS presentation_live_sessions_event_seq_offset_check;
ALTER TABLE presentation_live_sessions
  ADD CONSTRAINT presentation_live_sessions_event_seq_offset_check
    CHECK (event_seq_offset >= 0) NOT VALID;
