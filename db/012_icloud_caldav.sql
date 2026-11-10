BEGIN;

-- 1. Calendar Connections (external calendar account connections e.g. Apple iCloud)
CREATE TABLE IF NOT EXISTS calendar_connections (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  account_email text NOT NULL,
  encrypted_credentials text NOT NULL,
  connection_status text NOT NULL DEFAULT 'connected' CHECK(connection_status IN ('connected', 'invalid_credentials', 'error')),
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider, account_email)
);
CREATE INDEX IF NOT EXISTS calendar_connections_user ON calendar_connections(user_id);

-- 2. External Calendars (calendars discovered from the provider)
CREATE TABLE IF NOT EXISTS external_calendars (
  id text PRIMARY KEY,
  connection_id text NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  calendar_id text REFERENCES calendars(id) ON DELETE SET NULL,
  external_calendar_id text NOT NULL,
  calendar_url text NOT NULL,
  display_name text NOT NULL,
  color text,
  is_enabled boolean NOT NULL DEFAULT true,
  is_read_only boolean NOT NULL DEFAULT false,
  sync_direction text NOT NULL DEFAULT 'read_only' CHECK(sync_direction IN ('read_only', 'two_way')),
  sync_token text,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connection_id, external_calendar_id)
);
CREATE INDEX IF NOT EXISTS external_calendars_conn ON external_calendars(connection_id);
CREATE INDEX IF NOT EXISTS external_calendars_cal ON external_calendars(calendar_id);

-- 3. External Event Mappings (bidirectional mapping between local DWM event and external CalDAV UID/URL)
CREATE TABLE IF NOT EXISTS external_event_mappings (
  id text PRIMARY KEY,
  external_calendar_id text NOT NULL REFERENCES external_calendars(id) ON DELETE CASCADE,
  local_event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  external_event_uid text NOT NULL,
  external_object_url text NOT NULL,
  etag text,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(external_calendar_id, external_event_uid),
  UNIQUE(local_event_id)
);
CREATE INDEX IF NOT EXISTS external_event_mappings_cal_uid ON external_event_mappings(external_calendar_id, external_event_uid);

INSERT INTO schema_migrations(version) VALUES(12) ON CONFLICT DO NOTHING;

COMMIT;
