BEGIN;
CREATE TABLE IF NOT EXISTS daily_briefing_preferences (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  briefing_time text NOT NULL DEFAULT '08:00' CHECK(briefing_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  location_name text NOT NULL DEFAULT '서울' CHECK(length(location_name) BETWEEN 1 AND 80),
  latitude double precision NOT NULL DEFAULT 37.5665,
  longitude double precision NOT NULL DEFAULT 126.9780,
  last_sent_date text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_briefing_enabled ON daily_briefing_preferences(enabled, briefing_time) WHERE enabled = true;
INSERT INTO schema_migrations(version) VALUES(29) ON CONFLICT DO NOTHING;
COMMIT;
