ALTER TABLE movement_events
  ADD COLUMN IF NOT EXISTS reps NUMERIC(8,2) NOT NULL DEFAULT 0;

ALTER TABLE movement_events
  ADD CONSTRAINT movement_events_reps_check
  CHECK (reps >= 0 AND reps <= 1000);
