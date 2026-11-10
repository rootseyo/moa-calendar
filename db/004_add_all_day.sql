BEGIN;
ALTER TABLE events ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_all_day_midnight;
ALTER TABLE events ADD CONSTRAINT events_all_day_midnight CHECK (
 NOT all_day OR (right(start,6)='T00:00' AND right("end",6)='T00:00')
);
INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
COMMIT;
