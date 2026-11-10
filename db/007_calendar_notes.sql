BEGIN;
CREATE TABLE IF NOT EXISTS calendar_notes (
 calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 date text NOT NULL CHECK(date ~ '^\d{4}-\d{2}-\d{2}$'),
 content text NOT NULL CHECK(length(content) BETWEEN 0 AND 5000),
 version integer NOT NULL DEFAULT 1,
 updated_by text NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(calendar_id,date)
);
INSERT INTO schema_migrations(version) VALUES(7) ON CONFLICT DO NOTHING;
COMMIT;
