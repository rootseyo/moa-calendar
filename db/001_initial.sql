BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS calendars (
 id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 50),
 owner text NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
 calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','editor','viewer')),
 PRIMARY KEY(calendar_id,user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_one_owner ON members(calendar_id) WHERE role='owner';
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS invites (
 token text PRIMARY KEY, calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('editor','viewer')), expires bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_calendar ON invites(calendar_id);
CREATE TABLE IF NOT EXISTS events (
 id text PRIMARY KEY, calendar_id text NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100), start text NOT NULL, "end" text NOT NULL,
 color text NOT NULL CHECK(color IN ('sage','blue','peach','lavender')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000), version integer NOT NULL DEFAULT 1,
 CHECK("end">start)
);
CREATE INDEX IF NOT EXISTS events_calendar_start ON events(calendar_id,start);
CREATE TABLE IF NOT EXISTS oauth (
 state text PRIMARY KEY, provider text NOT NULL, verifier text NOT NULL, next text NOT NULL, expires bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_actions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, admin_id text NOT NULL,
 action text NOT NULL, resource_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
COMMIT;
