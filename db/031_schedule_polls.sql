BEGIN;

CREATE TABLE IF NOT EXISTS schedule_polls (
  id text PRIMARY KEY,
  calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  creator_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  location text NOT NULL DEFAULT '' CHECK(length(location) <= 200),
  duration_minutes integer NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 15 AND 720),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'CONFIRMED', 'CLOSED')),
  confirmed_event_id text,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_schedule_polls_calendar ON schedule_polls(calendar_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_polls_token ON schedule_polls(token);

CREATE TABLE IF NOT EXISTS schedule_poll_options (
  id text PRIMARY KEY,
  poll_id text NOT NULL REFERENCES schedule_polls(id) ON DELETE CASCADE,
  start_time text NOT NULL,
  end_time text NOT NULL,
  CHECK(end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_schedule_poll_options_poll ON schedule_poll_options(poll_id, start_time);

CREATE TABLE IF NOT EXISTS schedule_poll_votes (
  id text PRIMARY KEY,
  poll_id text NOT NULL REFERENCES schedule_polls(id) ON DELETE CASCADE,
  option_id text NOT NULL REFERENCES schedule_poll_options(id) ON DELETE CASCADE,
  voter_key text NOT NULL,
  voter_name text NOT NULL CHECK(length(voter_name) BETWEEN 1 AND 40),
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  availability text NOT NULL CHECK(availability IN ('yes', 'maybe')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_poll_option_voter UNIQUE (option_id, voter_key)
);
CREATE INDEX IF NOT EXISTS idx_schedule_poll_votes_poll ON schedule_poll_votes(poll_id);

INSERT INTO schema_migrations(version) VALUES(31) ON CONFLICT DO NOTHING;
COMMIT;
