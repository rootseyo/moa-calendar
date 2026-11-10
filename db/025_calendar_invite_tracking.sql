BEGIN;

-- Add raw_token column to invites to support retrieving the link later
ALTER TABLE invites ADD COLUMN IF NOT EXISTS raw_token text;

-- Table to track signups/joins per invite link
CREATE TABLE IF NOT EXISTS invite_signups (
  id text PRIMARY KEY,
  invite_token text NOT NULL REFERENCES invites(token) ON DELETE CASCADE,
  calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_invite_token_user UNIQUE (invite_token, user_id)
);

CREATE INDEX IF NOT EXISTS idx_invite_signups_invite ON invite_signups(invite_token);
CREATE INDEX IF NOT EXISTS idx_invite_signups_calendar ON invite_signups(calendar_id);
CREATE INDEX IF NOT EXISTS idx_invite_signups_user ON invite_signups(user_id);

INSERT INTO schema_migrations(version) VALUES(25) ON CONFLICT DO NOTHING;

COMMIT;
