BEGIN;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_color_check;
ALTER TABLE events ADD CONSTRAINT events_color_check CHECK(color IN ('sage','blue','peach','lavender','coral','rose','yellow','teal','orange','cyan','indigo','slate'));
ALTER TABLE calendars DROP CONSTRAINT IF EXISTS calendars_color_check;
ALTER TABLE calendars ADD CONSTRAINT calendars_color_check CHECK(color IN ('sage','blue','peach','lavender','coral','rose','yellow','teal','orange','cyan','indigo','slate'));
INSERT INTO schema_migrations(version) VALUES(8) ON CONFLICT DO NOTHING;
COMMIT;
