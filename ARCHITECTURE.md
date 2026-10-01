# Architecture

## Current foundation

- `src/app.js`: stateful workout UI, set-level logging, history, progress, account surface and sync outbox.
- `src/workout-engine.js`: deterministic domain calculations, progression helper, and versioned movement event.
- `src/units.js`: canonical kg storage with explicit kg/lb display/input conversion.
- `localStorage`: local beta persistence only; not a secure vault and not cross-device storage.
- `src/sw.js`: basic offline cache.
- `backend/src/server.js`: authenticated HTTP API with validation, rate limiting, authorization, idempotency and request metadata.
- `backend/src/repository.js`: PostgreSQL persistence with transaction-scoped session writes.
- `backend/migrations/`: versioned database schema and seed data.
- `scripts/`: zero-dependency dev server, static build, and checks.
- `.github/workflows/ci.yml`: unit/API/smoke/static/build pipeline.

## Target production boundaries

```text
Web / Mobile client
  ├─ Workout UI + accessible interaction layer
  ├─ Local repository (IndexedDB)
  ├─ Sensor adapter interface
  │    ├─ Manual input
  │    ├─ Camera pose estimator (on-device where feasible)
  │    └─ Wearable adapter (later)
  └─ Sync queue
       ↓ authenticated API
Identity + consent ─ Workout/session service ─ Progress analytics
       ↓                         ↓
Relational database          Event pipeline
                                  ↓
                       Feature extraction / model evaluation
```

## Movement event contract

Events are versioned and source-labelled. Production schema should include:

- stable user/session/exercise identifiers (pseudonymous where possible)
- event timestamp and client clock quality
- source: manual, camera, wearable
- rep count, set boundaries, load and units
- optional pose-derived features, model/version, confidence, and quality flags
- consent scope and retention class

Do **not** upload raw video by default. Prefer on-device inference and store only user-approved derived metrics. Make camera permission explicit, provide pause/delete controls, and document retention. Treat confidence as uncertainty, not truth.

## Production decisions still required

1. Production identity lifecycle: verification, recovery, revocation and secure refresh/session strategy.
2. Managed deployment, database backups, restore drills, retention and deletion workflows.
3. Distributed edge abuse controls and production observability.
4. Model evaluation datasets, exercise-specific thresholds, device coverage, and failure UX.
5. Privacy policy, terms, consent records, data export/deletion, and applicable legal review.
6. Operational runbooks, incident response, support workflow, and release rollback.

## Security baseline

Never commit secrets. Validate every API payload server-side. Enforce ownership checks on every user-scoped record. Keep health-related claims conservative. Add dependency and secret scanning before public launch.
