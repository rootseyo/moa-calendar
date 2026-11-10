BEGIN;
CREATE TABLE IF NOT EXISTS calendar_general_notes (
 calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE PRIMARY KEY,
 content text NOT NULL CHECK(length(content) BETWEEN 0 AND 5000),
 version integer NOT NULL DEFAULT 1,
 updated_by text NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES(23) ON CONFLICT DO NOTHING;
COMMIT;
