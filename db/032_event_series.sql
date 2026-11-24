BEGIN;

ALTER TABLE events ADD COLUMN IF NOT EXISTS series_id text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_rule jsonb;
CREATE INDEX IF NOT EXISTS idx_events_series_id ON events(calendar_id, series_id) WHERE series_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES(32) ON CONFLICT DO NOTHING;
COMMIT;
