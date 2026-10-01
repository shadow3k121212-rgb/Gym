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
- Current phase: **Phase 1 — Core workout loop hardening**
- Status: IN PROGRESS

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
Phase 2 — Data model + sync correctness
