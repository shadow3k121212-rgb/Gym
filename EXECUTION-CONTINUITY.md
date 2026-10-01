# GYM Execution Continuity

## Execution rule
Work proceeds strictly in serial phases. A phase is not complete until:
- implementation is committed on the working branch
- automated tests cover the critical behavior
- CI is green on the resulting head
- known regressions are closed or explicitly documented
- this file is updated with evidence and the next phase is named

Do not skip ahead because a later feature is attractive. Build the foundation first, then move forward.

## Product standard
Every change should be:
- production-oriented rather than demo-oriented
- deterministic and testable
- backward-compatible where practical
- secure by default
- resilient to interruption, retries, offline state, malformed data, and partial failures
- designed so scaling later does not require unnecessary architectural rewrites
- honest about capabilities; no simulated AI/cloud claims
- accessible and usable on mobile, tablet, and desktop

## Phase sequence
1. Core workout loop hardening
2. Data model + sync correctness
3. Identity, sessions, authorization, account lifecycle
4. Reliability, offline recovery, observability
5. UX/accessibility/performance audit
6. Production infrastructure, deployment, backup/restore, security
7. Movement intelligence / camera foundation
8. Coach/progression intelligence
9. Analytics, experimentation, billing/support
10. Release candidate and production evidence

## Current checkpoint
- Branch: `product/foundation-10x`
- Completed foundation work: local-first workout UI, backend API, PostgreSQL schema/migrations, idempotent writes, CI, initial security hardening.
- Current phase: **Phase 3 — Identity, sessions, authorization, account lifecycle**
- Status: **Phase 4 — Reliability, offline recovery, observability**
- Last completed phase: **Phase 3 — Identity, sessions, authorization, account lifecycle**
- Phase 3 verification checkpoint: refresh-token rotation preserves the original absolute session expiry; rotated cookies advertise only remaining server lifetime; current-device revocation clears the refresh cookie and client auth state; production reset delivery is HTTPS-only; auth session listing distinguishes active/expired/revoked state; cross-account history isolation and password-reset multi-device invalidation have regression coverage.

## Phase 1 definition of done
- No silent state loss on normal user interactions
- Accidental set actions can be corrected safely
- Session lifecycle is explicit and recoverable
- Finish/discard behavior is deterministic
- Unit conversion remains canonical
- Browser persistence failures are surfaced
- Sample/demo data cannot contaminate real history
- Critical workflow tests exist
- CI is green

## Next phase after completion
Phase 4 — Reliability, offline recovery, observability

## Phase 2 completion log — 2026-10-01
Implemented:
- durable sync queue normalization with no hidden 20-item truncation
- deterministic queue deduplication and explicit removal helpers
- account-scoped pending cloud work; legacy unowned queue entries are never auto-assigned to another account
- explicit authentication-expiry handling on sync/history requests
- transient vs non-retryable cloud failure classification
- successful-sync response validation
- deterministic, validated remote-history merge with UUID/source/value/chronology checks
- account ownership markers for cloud-derived local history
- cursor pagination for cloud session history with stable `started_at,id` ordering
- explicit pagination limits and opaque cursor validation
- Postgres and memory repository pagination parity
- movement-event replay ownership enforcement
- session-ID identity conflict parity between memory and Postgres semantics
- offline, malformed-response, pagination, account-switch, idempotency and replay-security regression coverage

Verification evidence:
- CI run #259 passed on exact Phase 2 head `e63f9b5f2324b8651f17521c48f6451ecb3101ad`.
- Run #259 reported 33 frontend tests and 17 backend tests passing.
- Run #259 also passed PostgreSQL migrations/schema verification, HTTP smoke test, dependency audit, static checks, production build, and output verification.

Phase 2 status: COMPLETE.

## Phase 3 completion log — 2026-10-01

Implemented:
- explicit server-side refresh-session model with family-based rotation and replay revocation
- absolute refresh-session expiry preservation across rotations
- secure HttpOnly refresh-cookie transport with in-memory short-lived browser access state
- deterministic current-device, other-device, and all-device session revocation semantics
- non-enumerating, bounded password-reset flow with one-time tokens
- password reset invalidates existing authentication sessions
- transactional account deletion with deletion audit evidence and user-owned data cascade coverage
- authorization regression coverage for cross-user workout history, movement-event writes/replays, and auth-session management
- deterministic active/expired/revoked session status for API and client session management

Verification evidence:
- CI run #375 passed on exact Phase 3 head `b88f8158d18f3efea3f8a6c1ed09745c5f5c9c4e`.
- CI #375 passed unit/API tests, PostgreSQL migrations + schema verification, HTTP smoke, dependency audit, static checks, production build, and output verification.
- The preceding Phase 3 hardening head `09589d1972931446c6e2e327def08655f20020f0` was also verified by CI #364.

Phase 3 status: COMPLETE.

## Phase 3 definition of done
- Access/refresh session lifecycle has explicit expiry, revocation, and rotation semantics.
- Session tokens cannot be reused after revocation and server-side account status changes take effect consistently.
- Password/account recovery flow has safe, non-enumerating behavior and bounded token lifetime.
- Authorization is enforced consistently on every user-owned resource and replay path.
- Account deletion is transactional, explicit, auditable, and removes or anonymizes user-owned data according to the documented retention policy.
- Sign-out and multi-device session management have deterministic behavior.
- Client auth state does not depend on long-lived browser token persistence.
- Critical identity tests cover expiry, refresh rotation, revocation, disabled account, wrong-user resource access, recovery-token replay, and deletion behavior.

## Next phase work
- introduce a server-side refresh-session model with rotation/revocation
- move browser auth toward secure cookie-backed sessions and short-lived access state
- add session/device management primitives
- harden recovery and account lifecycle semantics
- add authorization regression tests across all resource paths

## Phase 1 completion log — 2026-10-01
Implemented:
- transactional local state commits with rollback on persistence failure
- explicit confirmation before discarding an active workout
- explicit confirmation before saving a partial workout
- transient undo for the latest set-completion action
- timer cleanup when a session/data is discarded
- persisted-state normalization/recovery for malformed v2 localStorage
- completed-set timestamp invariants during persisted-state recovery
- movement-event rep persistence and schema migration hardening
- corrected CI workflow timeout placement
- corrected product documentation that contradicted the implemented backend foundation
- fixed selector collection wiring so workout/settings event binding uses the collection helper consistently
- added static regression detection for accidental single-selector `forEach` calls
- extended migration integrity checks through migration 006

Verification evidence:
- CI run #141 passed all configured checks after the CI workflow fix.
- CI run #147 passed all configured checks after workout recovery hardening.
- CI run #160 passed all configured checks on the mutation-rollback head.
- CI run #176 passed all configured checks on final Phase 1 head `e89cac686305d81bae35ad573f9f3aaecf950dc7`.
- On run #176, unit/API tests, PostgreSQL migrations + schema verification, HTTP smoke, dependency audit, static checks, and production build/output verification passed.

Phase 1 status: COMPLETE.
Any later PR-context check remains verification-only; the direct branch CI for the resulting head is green.

## Phase 2 definition of done
- Sync outbox never silently drops unsynced user work.
- Queue operations are idempotent and deduplicated by stable session identity.
- Retry behavior distinguishes transient network/server failures from authentication failures.
- Expired/invalid auth does not leave the user in a misleading “synced” state.
- Cloud history merge is deterministic and cannot overwrite valid local data with malformed remote records.
- Sync persistence failures are surfaced truthfully.
- Pagination/limits have explicit semantics and no hidden truncation of durable work.
- Server and client schemas remain compatible through explicit versioned contracts.
- Critical sync/idempotency tests cover success, replay, conflict, retry, offline, malformed response, and auth-expiry cases.

## Next phase work
- audit and redesign the durable local sync queue
- make auth-expiry/re-auth behavior explicit
- harden remote history validation and merge semantics
- add regression tests for outbox retention and sync failure handling
- preserve the current local-first source-of-truth contract while cloud synchronization remains optional

## Phase 4 initial checkpoint — 2026-10-01

Status: IN PROGRESS.

Completed slices:
- durable sync retry metadata with attempts, next-at timestamps, last-error retention, and blocked-state retention for permanent failures
- bounded exponential backoff (5 seconds to 15 minutes) for transient sync failures
- authentication failures remain immediately retryable after re-authentication
- retry-reset primitive plus account/settings UI manual retry path for blocked retained workouts
- overlapping sync flushes are prevented; scheduled retries wake when the next due item becomes eligible
- retry metadata survives browser reload/state normalization without being stripped by storage migration
- structured HTTP request telemetry records request ID, method, route, status, and duration without credential material
- password-recovery delivery is bounded by a 5-second outbound timeout so a slow webhook cannot hold the request indefinitely

Verification evidence:
- CI run #387 passed on retry-layer head `7c000ffa6ea63525aa60f131ccfb67f748f38618`.
- CI run #389 passed on observability/timeout head `cbd1e7ab2a4c766908696f3b0849e3b1b8f60fff`.
- CI run #392 passed on continuity checkpoint head `25f68698ed7f40eb948e556a347d0bbe86827186`.
- CI run #399 passed on combined retry-storage-recovery head `f209ddafacb94ac7ebbf75297c46862fe2a540b1`.
- These CI runs passed unit/API tests, PostgreSQL migrations + schema verification, HTTP smoke, dependency audit, static checks, production build, and output verification.

Next Phase 4 implementation slice:
- add targeted client tests for scheduled retry/online/auth-event interaction and verify no duplicate flush side effects
- expose unowned legacy sync records separately from authenticated pending work so they remain visible without ever being auto-assigned
- extend observability with bounded sync outcome counters suitable for centralized production metrics, without collecting workout payloads.
