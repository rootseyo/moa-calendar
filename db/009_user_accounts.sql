BEGIN;
CREATE TABLE IF NOT EXISTS user_accounts (
  provider text NOT NULL CHECK(provider IN ('google','kakao')),
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  token_expires bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_id)
);
CREATE INDEX IF NOT EXISTS user_accounts_user_id ON user_accounts(user_id);

-- Populate existing users if they match provider:id
INSERT INTO user_accounts (provider, provider_id, user_id)
SELECT split_part(id, ':', 1), split_part(id, ':', 2), id
FROM users
WHERE id LIKE 'google:%' OR id LIKE 'kakao:%'
ON CONFLICT (provider, provider_id) DO NOTHING;

INSERT INTO schema_migrations(version) VALUES(9) ON CONFLICT DO NOTHING;
COMMIT;
