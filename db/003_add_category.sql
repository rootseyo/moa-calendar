BEGIN;

ALTER TABLE events ADD COLUMN IF NOT EXISTS category text DEFAULT '' CHECK (length(category) <= 50);

INSERT INTO schema_migrations(version) VALUES(3) ON CONFLICT DO NOTHING;

COMMIT;
