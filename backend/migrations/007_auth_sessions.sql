CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  family_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  replaced_by_session_id UUID REFERENCES auth_sessions(id),
  revocation_reason TEXT,
  CONSTRAINT auth_sessions_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx
  ON auth_sessions(user_id, expires_at, revoked_at);

CREATE INDEX IF NOT EXISTS auth_sessions_family_idx
  ON auth_sessions(family_id);
