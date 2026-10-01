# Security policy

## Current beta boundaries

This repository is a client-side prototype. It has no authentication service, backend API, or server database. Local browser storage is not a secure vault and should not be used for secrets or highly sensitive information.

## Reporting

Until a dedicated security contact is published, report suspected vulnerabilities privately to the repository owner through GitHub's private vulnerability reporting feature if enabled. Do not publish exploit details in a public issue.

## Before adding a backend

- Enforce authentication and per-record authorization server-side.
- Validate request bodies and apply payload limits.
- Use parameterized database access and managed secrets.
- Add rate limits, abuse controls, audit events, and security headers.
- Provide account deletion and data export.
- Keep raw video out of storage by default; define explicit consent and retention if video processing is introduced.
- Add dependency, secret, and static-analysis scanning to CI.
- Test authorization boundaries and backup restoration.
