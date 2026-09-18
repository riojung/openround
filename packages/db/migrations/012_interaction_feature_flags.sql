ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS round_experiences_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS audience_pulse_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS room_chat_enabled boolean NOT NULL DEFAULT true;
