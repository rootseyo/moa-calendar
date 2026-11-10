BEGIN;
CREATE TABLE IF NOT EXISTS calendar_month_notes (
 calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 month text NOT NULL CHECK(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 content text NOT NULL CHECK(length(content) BETWEEN 0 AND 5000),
 version integer NOT NULL DEFAULT 1,
 updated_by text NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(calendar_id,month)
);
INSERT INTO schema_migrations(version) VALUES(21) ON CONFLICT DO NOTHING;
COMMIT;
