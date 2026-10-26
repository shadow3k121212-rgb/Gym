ALTER TABLE movement_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_request_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS movement_events_session_idempotency_idx
  ON movement_events(session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE movement_events
  DROP CONSTRAINT IF EXISTS movement_events_idempotency_request_hash_check;

ALTER TABLE movement_events
  ADD CONSTRAINT movement_events_idempotency_request_hash_check
  CHECK (
    idempotency_request_hash IS NULL
    OR idempotency_request_hash ~ '^[0-9a-f]{64}$'
  );
