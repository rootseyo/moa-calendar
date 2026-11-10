BEGIN;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_color_check;
ALTER TABLE events ADD CONSTRAINT events_color_check CHECK (
 color IN ('sage','blue','peach','lavender','coral','rose','yellow','teal')
);
INSERT INTO schema_migrations(version) VALUES(5) ON CONFLICT DO NOTHING;
COMMIT;
