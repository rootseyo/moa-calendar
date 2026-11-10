BEGIN;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS token_scope text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_calendar_generation integer NOT NULL DEFAULT 0;
ALTER TABLE oauth ADD COLUMN IF NOT EXISTS linked_user_id text;
ALTER TABLE oauth ADD COLUMN IF NOT EXISTS google_generation integer;
INSERT INTO schema_migrations(version) VALUES(11) ON CONFLICT DO NOTHING;
COMMIT;
