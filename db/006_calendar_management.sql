BEGIN;
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT 'sage' CHECK(color IN ('sage','blue','peach','lavender','coral','rose','yellow','teal'));
ALTER TABLE invites ADD COLUMN IF NOT EXISTS created_at bigint NOT NULL DEFAULT (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
CREATE TABLE IF NOT EXISTS removed_members (
 calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 removed_at bigint NOT NULL,
 PRIMARY KEY(calendar_id,user_id)
);
INSERT INTO schema_migrations(version) VALUES(6) ON CONFLICT DO NOTHING;
COMMIT;
