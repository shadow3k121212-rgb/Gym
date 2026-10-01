# Production backend architecture

## Service boundaries

**API**
Authentication, authorization, validation, rate limits, idempotency, pagination and versioning.

**Domain**
Workout plans, sessions, sets and derived movement events. Domain logic remains independent from HTTP.

**Persistence**
PostgreSQL with forward-only migrations. Every user-owned query is scoped by authenticated user ID.

**Analytics**
Asynchronous event projection for training trends. Model-derived metrics remain separate from manually entered facts.

**Future movement intelligence**
Camera frames should be processed on-device where technically practical. Upload raw video only through an explicit product decision, consent flow, retention policy and security review.

## Request lifecycle

1. Authenticate request.
2. Resolve user identity and authorization scope.
3. Validate payload against the API contract.
4. Check idempotency for mutating operations.
5. Execute transactional domain command.
6. Persist event/record.
7. Enqueue analytics projection.
8. Return versioned response with correlation ID.

## Non-functional requirements

- p95 read latency target: < 300 ms under expected beta load.
- All timestamps timezone-aware.
- Structured application logs with request/correlation IDs.
- No secrets in repository.
- Audit important auth/consent/data deletion events.
- Health endpoint excludes secrets and user data.
- Backups and restore drills before treating the backend as production.

## Computer-vision data policy

Store derived metrics such as rep count, tempo, range-of-motion proxy, symmetry proxy, confidence and model version. Do not silently store raw video. The UI must distinguish measured data, estimated data and user-entered data.
