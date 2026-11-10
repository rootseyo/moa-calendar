BEGIN;
CREATE TABLE IF NOT EXISTS monthly_items (
 id text PRIMARY KEY,
 calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND month >= '0001-01'),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
 notes text NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
 is_todo boolean NOT NULL DEFAULT false,
 completed boolean NOT NULL DEFAULT false CHECK(is_todo OR NOT completed),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monthly_items_calendar_month ON monthly_items(calendar_id,month,created_at);
INSERT INTO schema_migrations(version) VALUES(17) ON CONFLICT DO NOTHING;
COMMIT;
