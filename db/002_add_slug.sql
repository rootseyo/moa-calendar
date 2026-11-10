BEGIN;

ALTER TABLE calendars ADD COLUMN IF NOT EXISTS slug text;

UPDATE calendars SET slug = substring(id from 1 for 8) WHERE slug IS NULL;

ALTER TABLE calendars DROP CONSTRAINT IF EXISTS calendars_slug_format;
ALTER TABLE calendars ADD CONSTRAINT calendars_slug_format CHECK (slug IS NULL OR slug ~ '^[a-z0-9_-]{2,50}$');

CREATE UNIQUE INDEX IF NOT EXISTS calendars_slug_idx ON calendars(slug);

INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;

COMMIT;
