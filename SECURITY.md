# Security policy

## Current beta architecture

GYM has a local-first web client plus an optional Node/PostgreSQL API foundation. The API is not deployed by this repository yet, so deployment controls remain release gates rather than implied guarantees.

The client stores workout state in browser localStorage. Treat that storage as user-visible application data, not a secure vault. Do not store passwords, access tokens, private keys, or other secrets in localStorage.

The current API foundation includes:

- server-side request validation and a 256 KiB JSON body limit
- password hashing with Node scrypt and per-user salts
- short-lived signed access tokens bound to revocable server-side sessions
- rotating HttpOnly refresh sessions with reuse detection
- per-user session authorization checks
- additive workspace/membership schema with authenticated membership listing and gym-workspace creation
- owner/admin-scoped roster and invitation management; single-use hashed invitation tokens require matching account email and expire
- production invite delivery is fail-closed at startup unless an HTTPS webhook and secret are configured
- tenant membership results isolated to the authenticated account; current workout history APIs remain user-private
- idempotent session writes with payload-hash conflict detection
- request IDs, no-store/cache and baseline security headers
- login failure throttling suitable for a single-process beta, not distributed production
- PostgreSQL migrations and parameterized queries
- raw camera video excluded from the API data model by default

The current tenant foundation is not yet full team-sharing support: membership status administration, ownership transfer, tenant-scoped workout authorization, billing and RLS defense-in-depth remain unimplemented. Do not grant coaches or gym administrators blanket access to members' private workout history.

## Remaining production blockers before handling real user data

1. Deploy behind TLS with HSTS and a fail-closed production CORS allow-list; production runtime already refuses wildcard CORS.
2. Put password-recovery delivery behind a managed, authenticated email provider or delivery service. The API currently exposes a non-enumerating reset workflow and accepts an optional `PASSWORD_RESET_WEBHOOK_URL`; delivery configuration is still an infrastructure responsibility.
3. Add centralized rate limiting / abuse protection at the edge and account-level controls for registration and authentication; the current process-local throttling is beta-grade.
4. Add dependency, secret, static-analysis, and container/IaC scanning in CI and review the results as release gates.
5. Add managed database backups, tested restore procedures, retention/deletion workflows, and operational audit review.
6. Publish privacy, consent, retention, export, and deletion policies before collecting camera-derived movement data.
7. For computer vision, prefer on-device inference where feasible and store derived metrics with model/version/confidence metadata rather than raw video by default.

## Reporting

Until a dedicated security contact is published, report suspected vulnerabilities privately to the repository owner through GitHub's private vulnerability reporting feature when enabled. Do not publish exploit details in a public issue.
