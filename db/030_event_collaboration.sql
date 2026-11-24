BEGIN;

ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_by text REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('going', 'maybe', 'declined')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON event_rsvps(event_id);

CREATE TABLE IF NOT EXISTS event_comments (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_event_comments_event ON event_comments(event_id, created_at);

CREATE TABLE IF NOT EXISTS event_reactions (
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK(length(emoji) BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_event_reactions_event ON event_reactions(event_id);

CREATE TABLE IF NOT EXISTS calendar_activities (
  id text PRIMARY KEY,
  calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  event_id text,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  actor_name text NOT NULL DEFAULT '멤버',
  action text NOT NULL CHECK(action IN ('create', 'update', 'delete', 'comment', 'rsvp', 'poll_confirm')),
  summary text NOT NULL CHECK(length(summary) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calendar_activities_cal ON calendar_activities(calendar_id, created_at DESC);

INSERT INTO schema_migrations(version) VALUES(30) ON CONFLICT DO NOTHING;
COMMIT;
