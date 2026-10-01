# Architecture

## Current foundation

- `src/app.js`: lightweight client-side view rendering and interactions.
- `src/workout-engine.js`: deterministic domain calculations, progression helper, and versioned movement event.
- `localStorage`: prototype persistence only; not suitable for sensitive data or cross-device sync.
- `src/sw.js`: basic offline cache.
- `scripts/`: zero-dependency dev server, static build, and checks.

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

1. Identity, account recovery, and authorization model.
2. Database schema, migrations, backups, and deletion workflows.
3. API validation, rate limits, idempotency, and audit logging.
4. Model evaluation datasets, exercise-specific thresholds, device coverage, and failure UX.
5. Privacy policy, terms, consent records, data export/deletion, and applicable legal review.
6. Observability, incident response, support workflow, and release rollback.

## Security baseline

Never commit secrets. Validate every API payload server-side. Enforce ownership checks on every user-scoped record. Keep health-related claims conservative. Add dependency and secret scanning before public launch.
