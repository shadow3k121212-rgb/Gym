# GYM API

The backend is the optional authenticated service foundation for the local-first beta. It is implemented as a small Node.js HTTP service backed by PostgreSQL; deployment and production identity hardening remain release gates.

## Local development

Requires Node.js 20+ and PostgreSQL.

```bash
cd backend
npm install
DATABASE_URL=postgresql://gym:gym@localhost:5432/gym npm run migrate
DATABASE_URL=postgresql://gym:gym@localhost:5432/gym npm test
```

Run the API with:

```bash
DATABASE_URL=postgresql://gym:gym@localhost:5432/gym \
JWT_SECRET='replace-with-a-32-character-minimum-secret' \
CORS_ORIGIN='http://localhost:4173' \
PASSWORD_RESET_WEBHOOK_URL='https://delivery.example.test/password-reset' \
PASSWORD_RESET_WEBHOOK_SECRET='replace-with-a-delivery-secret' \
npm start
```

## Current service contract

- `GET /v1/health` — liveness plus database reachability signal.
- `GET /v1/ready` — readiness; returns non-200 when the database is unavailable.
- `POST /v1/auth/register` — account creation with validated credentials and short-lived access token.
- `POST /v1/auth/login` — authentication with login failure throttling and a secure refresh session cookie.
- `POST /v1/auth/refresh` — rotating refresh-session exchange with reuse detection.
- `POST /v1/auth/logout` / `POST /v1/auth/logout-all` — deterministic session revocation.
- `GET /v1/auth/sessions` / `DELETE /v1/auth/sessions/:id` — device-session management.
- `POST /v1/auth/password-reset/request` / `POST /v1/auth/password-reset/confirm` — bounded, non-enumerating password recovery.
- `POST /v1/auth/delete-account` — password-confirmed transactional account deletion.
- `GET /v1/me` — authenticated current-user lookup.
- `POST /v1/sessions` — transactional session/set persistence with user-scoped idempotency.
- `GET /v1/sessions` — authenticated session history.
- `POST /v1/movement-events` — authenticated derived movement metrics with event-level idempotency.

## Data model

- `users`: id, created_at, status, email, password hash/salt, updated_at.
- `user_preferences`: user_id, units, timezone, updated_at.
- `exercises`: versioned exercise catalog.
- `workout_plans` and `workout_plan_exercises`: future reusable programming layer.
- `workout_sessions`: authenticated session record, completion timestamp, source and idempotency request hash.
- `workout_sets`: per-exercise set records with canonical kg storage, completion timestamp and RPE.
- `movement_events`: versioned manual/camera/wearable derived metrics, confidence/model metadata and event idempotency.
- `consents`: explicit purpose/policy records for future sensor and camera processing.

## Migration discipline

1. Use forward-only reviewed migrations with immutable numeric IDs.
2. `backend/scripts/migrate.mjs` owns the transaction for each migration and records it in `schema_migrations`.
3. CI applies all migrations to an ephemeral PostgreSQL instance and runs them twice to verify the ledger prevents accidental re-application.
4. Production schema changes require backups, a restore drill, and an explicit rollback/forward-fix plan.
5. Prefer expand → backfill → contract for breaking changes.

## Security model and production hardening

The service validates input server-side, scopes user-owned data by authenticated user, uses parameterized PostgreSQL queries, limits JSON bodies to 256 KiB, attaches request IDs/security headers, and rejects wildcard CORS in production startup configuration.

The current single-process auth throttling is beta-only. Production still requires centralized edge/account abuse controls, a managed email verification/recovery delivery provider, observability, managed secrets, dependency/security scanning, backups/restore drills, and formal privacy/retention controls. Browser access tokens are short-lived in-memory state; refresh tokens are HttpOnly cookies and are rotated/revoked server-side.

Raw camera video is outside the persistence model by default. Future computer-vision processing should prefer on-device inference where feasible and persist only approved derived metrics with model/version/confidence metadata.


### Password recovery delivery

Set `PASSWORD_RESET_WEBHOOK_URL` to an authenticated service that sends the recovery token through the product's managed email provider. The API always returns the same accepted response shape for valid-looking reset requests so account existence is not disclosed. In production, both the webhook URL and `PASSWORD_RESET_WEBHOOK_SECRET` are required at startup.
