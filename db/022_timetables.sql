BEGIN;
CREATE TABLE timetables (
 id text PRIMARY KEY,
 calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 50),
 start_date text NOT NULL,
 end_date text NOT NULL CHECK(end_date>=start_date),
 version integer NOT NULL DEFAULT 1
);
CREATE INDEX timetables_calendar ON timetables(calendar_id);
CREATE TABLE timetable_lessons (
 id text PRIMARY KEY,
 series_id text NOT NULL,
 timetable_id text NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
 title text NOT NULL,
 weekdays integer[] NOT NULL,
 start_time text NOT NULL,
 end_time text NOT NULL,
 color text NOT NULL,
 notes text NOT NULL DEFAULT '',
 start_date text NOT NULL,
 end_date text NOT NULL,
 version integer NOT NULL DEFAULT 1
);
CREATE INDEX timetable_lessons_series ON timetable_lessons(series_id);
ALTER TABLE events ADD COLUMN timetable_id text REFERENCES timetables(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN lesson_id text REFERENCES timetable_lessons(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN occurrence_date text;
ALTER TABLE events ADD COLUMN timetable_exception boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX events_lesson_date ON events(lesson_id,occurrence_date);
INSERT INTO schema_migrations(version) VALUES(22) ON CONFLICT DO NOTHING;
COMMIT;
