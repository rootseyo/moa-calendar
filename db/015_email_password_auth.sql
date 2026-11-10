BEGIN;
CREATE TABLE IF NOT EXISTS local_accounts (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 email text NOT NULL UNIQUE,
 password_hash text NOT NULL,
 terms_accepted_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(length(email) BETWEEN 3 AND 254)
);
INSERT INTO schema_migrations(version) VALUES(15) ON CONFLICT DO NOTHING;
COMMIT;
