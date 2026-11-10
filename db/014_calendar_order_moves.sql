BEGIN;
CREATE TABLE IF NOT EXISTS calendar_order (user_id text NOT NULL,calendar_id text NOT NULL,sort_order integer NOT NULL,PRIMARY KEY(user_id,calendar_id),FOREIGN KEY(calendar_id,user_id) REFERENCES members(calendar_id,user_id) ON DELETE CASCADE);
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS source_provider text NOT NULL DEFAULT 'moa' CHECK(source_provider IN ('moa','google','icloud'));
UPDATE calendars c SET source_provider='google' WHERE source_provider='moa' AND EXISTS(SELECT 1 FROM events e WHERE e.calendar_id=c.id AND e.category='구글');
UPDATE calendars c SET source_provider='icloud' WHERE EXISTS(SELECT 1 FROM external_calendars ec WHERE ec.calendar_id=c.id);
CREATE TABLE IF NOT EXISTS calendar_move_jobs (
 event_id text PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 source_calendar_id text NOT NULL,
 target_calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 source_external_id text REFERENCES external_calendars(id) ON DELETE SET NULL,
 remote_url text,
 remote_etag text,
 source_deleted boolean NOT NULL DEFAULT false,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES(14) ON CONFLICT DO NOTHING;
COMMIT;
