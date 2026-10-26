ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS idempotency_request_hash TEXT;

ALTER TABLE workout_sessions
  DROP CONSTRAINT IF EXISTS workout_sessions_idempotency_request_hash_check;

ALTER TABLE workout_sessions
  ADD CONSTRAINT workout_sessions_idempotency_request_hash_check
  CHECK (
    idempotency_request_hash IS NULL
    OR idempotency_request_hash ~ '^[0-9a-f]{64}$'
  );
