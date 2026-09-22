ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locale_explicit boolean NOT NULL DEFAULT false;
