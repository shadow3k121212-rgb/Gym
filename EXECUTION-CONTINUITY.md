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
- Status: IN PROGRESS
- Last completed phase: **Phase 2 — Data model + sync correctness**

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
