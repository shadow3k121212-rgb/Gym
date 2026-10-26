CREATE TABLE IF NOT EXISTS account_deletion_audit (
  id UUID PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL CHECK (event_type IN ('account-deleted')),
  subject_digest TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_deletion_audit_occurred_idx
  ON account_deletion_audit(occurred_at DESC);
