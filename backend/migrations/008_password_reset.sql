CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  CONSTRAINT password_reset_tokens_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_active_idx
  ON password_reset_tokens(user_id, expires_at)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx
  ON password_reset_tokens(expires_at);
