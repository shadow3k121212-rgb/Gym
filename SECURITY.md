# Security policy

## Current beta architecture

GYM has a local-first web client plus an optional Node/PostgreSQL API foundation. The API is not deployed by this repository yet, so deployment controls remain release gates rather than implied guarantees.

The client stores workout state in browser localStorage. Treat that storage as user-visible application data, not a secure vault. Do not store passwords, access tokens, private keys, or other secrets in localStorage.

The current API foundation includes:

- server-side request validation and a 256 KiB JSON body limit
- password hashing with Node scrypt and per-user salts
- short-lived signed access tokens
- per-user session authorization checks
- idempotent session writes with payload-hash conflict detection
- request IDs, no-store/cache and baseline security headers
- login failure throttling suitable for a single-process beta, not distributed production
- PostgreSQL migrations and parameterized queries
- raw camera video excluded from the API data model by default

## Production blockers before handling real user data

1. Deploy behind TLS with HSTS and a fail-closed production CORS allow-list.
2. Replace browser-held access-token persistence with a secure refresh/session mechanism, such as an HttpOnly secure cookie plus short-lived in-memory access state.
3. Add centralized rate limiting / abuse protection at the edge and account-level controls for registration and authentication.
4. Add email verification, account recovery, session revocation, and device/session management.
5. Add dependency, secret, static-analysis, and container/IaC scanning in CI and review the results as release gates.
6. Add managed database backups, tested restore procedures, retention/deletion workflows, and audit logging.
7. Publish privacy, consent, retention, export, and deletion policies before collecting camera-derived movement data.
8. For computer vision, prefer on-device inference where feasible and store derived metrics with model/version/confidence metadata rather than raw video by default.

## Reporting

Until a dedicated security contact is published, report suspected vulnerabilities privately to the repository owner through GitHub's private vulnerability reporting feature when enabled. Do not publish exploit details in a public issue.
