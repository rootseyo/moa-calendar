BEGIN;
CREATE TABLE IF NOT EXISTS calendar_migration_previews (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 target_calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 payload jsonb NOT NULL,
 result jsonb,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendar_migration_previews_user ON calendar_migration_previews(user_id);
CREATE TABLE IF NOT EXISTS calendar_migration_copies (
 target_calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 source_key text NOT NULL,
 local_event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 PRIMARY KEY(target_calendar_id, source_key)
);
INSERT INTO schema_migrations(version) VALUES(13) ON CONFLICT DO NOTHING;
COMMIT;
