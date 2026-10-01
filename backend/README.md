# Backend design — planned, not deployed

The public beta remains local-first. This folder documents the proposed service boundary; it does not claim that a backend exists.

## Suggested initial stack

- TypeScript API service with schema validation.
- PostgreSQL for users, exercise catalog, workout plans, sessions, sets, and consent records.
- Object storage only for explicitly user-uploaded assets; no raw camera video by default.
- Managed identity provider or carefully implemented email/OAuth authentication.
- Versioned REST API; idempotency keys for session writes and a sync cursor for offline clients.

## Initial relational model

- `users`: id, created_at, status
- `user_preferences`: user_id, units, timezone, updated_at
- `exercises`: id, slug, name, muscle_group, equipment, metadata_version
- `workout_plans`: id, user_id, name, created_at, archived_at
- `workout_plan_exercises`: id, plan_id, exercise_id, position, target_sets, target_reps
- `workout_sessions`: id, user_id, plan_id, started_at, completed_at, client_id, idempotency_key
- `workout_sets`: id, session_id, exercise_id, set_index, reps, load_value, load_unit, completed_at, source
- `movement_events`: id, session_id, exercise_id, schema_version, source, occurred_at, confidence, metrics_json
- `consents`: id, user_id, purpose, policy_version, granted_at, revoked_at

## Migration discipline

1. Use forward-only, reviewed migrations with immutable migration IDs.
2. Apply migrations in CI against an ephemeral PostgreSQL instance.
3. Back up before production schema changes; verify restore procedures.
4. Prefer expand → backfill → contract for breaking changes.
5. Keep a rollback or forward-fix plan and document data-loss risks.
6. Add constraints and indexes based on observed query patterns.

## Data integrity and privacy

- Every user-owned query must scope by authenticated user ID.
- Use foreign keys and transaction boundaries for session/set writes.
- Unique constraint: `(user_id, idempotency_key)` for non-null idempotency keys.
- Store weight units explicitly; do not assume all clients use kilograms.
- Make timestamps timezone-aware and preserve the original event time.
- Keep derived camera metrics distinct from manual claims; include model version and confidence.
- Define retention and deletion semantics before collecting any camera-derived data.
