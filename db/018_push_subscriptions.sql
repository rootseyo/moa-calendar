BEGIN;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_sub_user_id ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS reminder_dispatch_logs (
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  due_time text NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, due_time)
);

CREATE INDEX IF NOT EXISTS reminder_dispatch_time ON reminder_dispatch_logs(dispatched_at);

INSERT INTO schema_migrations(version) VALUES(18) ON CONFLICT DO NOTHING;

COMMIT;
