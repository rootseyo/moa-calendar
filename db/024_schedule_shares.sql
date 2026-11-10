BEGIN;

CREATE TABLE IF NOT EXISTS schedule_shares (
  id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_id text REFERENCES calendars(id) ON DELETE SET NULL,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  period text NOT NULL CHECK(period IN ('day', 'week', 'month')),
  target_date date NOT NULL DEFAULT CURRENT_DATE,
  expires_at timestamptz,
  is_revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_shares_user ON schedule_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_schedule_shares_token ON schedule_shares(token);

CREATE TABLE IF NOT EXISTS schedule_share_visitors (
  id text PRIMARY KEY,
  share_id text NOT NULL REFERENCES schedule_shares(id) ON DELETE CASCADE,
  visitor_session_id text NOT NULL,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  ip text,
  user_agent text,
  device_info text NOT NULL DEFAULT '알 수 없는 환경',
  view_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_share_visitor UNIQUE (share_id, visitor_session_id)
);

CREATE INDEX IF NOT EXISTS idx_share_visitors_share ON schedule_share_visitors(share_id);

CREATE TABLE IF NOT EXISTS schedule_share_views (
  id text PRIMARY KEY,
  share_id text NOT NULL REFERENCES schedule_shares(id) ON DELETE CASCADE,
  visitor_id text NOT NULL REFERENCES schedule_share_visitors(id) ON DELETE CASCADE,
  ip text,
  user_agent text,
  referer text,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_share_views_share ON schedule_share_views(share_id);
CREATE INDEX IF NOT EXISTS idx_share_views_visitor ON schedule_share_views(visitor_id);

INSERT INTO schema_migrations(version) VALUES(24) ON CONFLICT DO NOTHING;

COMMIT;
