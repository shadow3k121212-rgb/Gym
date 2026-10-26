# GYM release gates

This document defines the minimum evidence required before moving GYM from a local-first public beta to a production service.

## Gate 0 — Product truth

- [ ] Product copy clearly distinguishes local beta capabilities from cloud, AI, and computer-vision roadmap items.
- [ ] Sample/preview data cannot be mistaken for personal history.
- [ ] Core workout flow works on desktop and narrow mobile layouts.
- [ ] Export and local-data deletion are verified manually.
- [ ] Accessibility review covers keyboard navigation, focus visibility, labels, contrast, and reduced-motion expectations.

## Gate 1 — Backend readiness

- [ ] Production API is deployed with TLS and a real health/readiness endpoint.
- [ ] PostgreSQL is provisioned from versioned migrations.
- [ ] DATABASE_URL and JWT_SECRET come from a managed secret store.
- [ ] Production CORS_ORIGIN is an explicit allow-list value, never *.
- [ ] Database backup schedule exists and a restore drill has been completed.
- [ ] Rollback procedure is documented and tested.

## Gate 2 — Identity and security

- [ ] Email verification and account recovery are implemented.
- [ ] Refresh/session strategy uses secure cookie/session controls; browser persistent storage is not used for long-lived credentials.
- [ ] Authentication and registration abuse controls are centralized and observable.
- [ ] Session revocation/device management is implemented.
- [ ] Dependency, secret, SAST, and supply-chain checks are green.
- [ ] Security response/contact process is published.

## Gate 3 — Data correctness

- [ ] Workout units are canonicalized and conversions have tests.
- [ ] Completed sessions persist both session and set completion timestamps.
- [ ] Idempotent writes replay only identical payloads and reject changed payloads.
- [ ] User ownership is enforced for every user-scoped record.
- [ ] Export/import and deletion behavior have explicit versioned schemas.
- [ ] Movement-event schema/version compatibility is covered by tests.

## Gate 4 — Movement intelligence

- [ ] Camera permission UX is explicit.
- [ ] Raw video retention/storage behavior is documented and consented.
- [ ] Exercise-specific movement metrics have evaluation datasets and thresholds.
- [ ] Model/version/confidence are stored with derived metrics.
- [ ] Inference failures degrade safely to manual logging.
- [ ] No medical or injury diagnosis claims are made from model output.

## Gate 5 — Observability and operations

- [ ] Request IDs are searchable in logs.
- [ ] Error rate, latency, auth failures, sync failures, and database health have monitoring.
- [ ] Alerts have owners and runbooks.
- [ ] Migration and rollback procedure is exercised on a production-like environment.
- [ ] Support workflow exists for account/data issues.

## Evidence standard

A checkbox is not considered complete from code inspection alone. Record the commit, CI run, environment, and manual/E2E evidence that proves the gate. Unknowns remain blockers.
