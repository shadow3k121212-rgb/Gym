BEGIN;

CREATE TABLE users (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted','suspended'))
);

CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  units TEXT NOT NULL DEFAULT 'kg' CHECK (units IN ('kg','lb')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE exercises (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  muscle_group TEXT NOT NULL,
  equipment TEXT NOT NULL,
  metadata_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE workout_plans (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX workout_plans_user_idx ON workout_plans(user_id, created_at DESC);

CREATE TABLE workout_plan_exercises (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL,
  target_sets INTEGER NOT NULL CHECK (target_sets > 0),
  target_reps INTEGER NOT NULL CHECK (target_reps > 0),
  UNIQUE(plan_id, position)
);

CREATE TABLE workout_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES workout_plans(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','camera','wearable')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workout_sessions_user_idempotency_idx
  ON workout_sessions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX workout_sessions_user_date_idx ON workout_sessions(user_id, started_at DESC);

CREATE TABLE workout_sets (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  set_index INTEGER NOT NULL CHECK (set_index > 0),
  reps NUMERIC(8,2) NOT NULL CHECK (reps >= 0),
  load_value NUMERIC(10,2) NOT NULL CHECK (load_value >= 0),
  load_unit TEXT NOT NULL CHECK (load_unit IN ('kg','lb')),
  completed_at TIMESTAMPTZ,
  rpe NUMERIC(4,2) CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  UNIQUE(session_id, exercise_id, set_index)
);
CREATE INDEX workout_sets_session_idx ON workout_sets(session_id);
CREATE INDEX workout_sets_exercise_idx ON workout_sets(exercise_id, completed_at DESC);

CREATE TABLE movement_events (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  schema_version INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','camera','wearable')),
  occurred_at TIMESTAMPTZ NOT NULL,
  confidence NUMERIC(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  model TEXT,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX movement_events_session_idx ON movement_events(session_id, occurred_at);
CREATE INDEX movement_events_exercise_idx ON movement_events(exercise_id, occurred_at DESC);

CREATE TABLE consents (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX consents_user_purpose_idx ON consents(user_id, purpose, granted_at DESC);

COMMIT;
