BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires bigint NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS calendar_ical_feeds (
  calendar_id text PRIMARY KEY REFERENCES calendars(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calendar_ical_feeds_token ON calendar_ical_feeds(token);

INSERT INTO schema_migrations(version) VALUES(33) ON CONFLICT DO NOTHING;
COMMIT;
