BEGIN;
ALTER TABLE events ADD COLUMN IF NOT EXISTS reminder_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS reminder_minutes integer NOT NULL DEFAULT 10 CHECK (reminder_minutes IN (10,30,1440) OR (reminder_minutes BETWEEN 60 AND 1380 AND reminder_minutes % 60 = 0));
INSERT INTO schema_migrations(version) VALUES(16) ON CONFLICT DO NOTHING;
COMMIT;
