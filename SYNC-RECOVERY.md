# Sync Recovery and Local Retention Policy

## Product guarantee

A finished workout queued for cloud synchronization is user data, not disposable cache. GYM must never evict, truncate, or auto-delete a pending workout solely because it is old, repeatedly fails, or the retry limit is reached.

## Queue states

- **Ready**: eligible for a sync attempt now.
- **Scheduled**: a transient failure is waiting for its bounded retry time.
- **Blocked**: a permanent rejection or exhausted automatic retry budget requires user action.
- **Unowned**: legacy local work has no trusted authenticated account owner. It must never be silently attached to whichever account signs in next.
- **Stale warning**: a pending workout older than 24 hours. This is a visibility threshold only; it never changes retention or retry ownership.

## User recovery

- Settings shows ready, scheduled, blocked and stale counts for the authenticated account, plus the oldest pending record time.
- Blocked entries retain a short error classification and last-attempt time and can be explicitly retried by the user.
- Legacy/unowned entries remain a separate class; export is the supported safe recovery path until an explicit, verified migration flow exists.
- Local export remains available before account switching, manual recovery or local deletion.
- A server acknowledgement removes a queued item. If the acknowledgement was received but local queue persistence fails, the item is retained and may be replayed idempotently.

## Storage boundaries

The current beta queue is stored in localStorage, which has finite capacity and is not a secure vault. Persistence failures must be surfaced; do not introduce a queue-size cap that silently drops user work. Before substantially increasing offline payload sizes or supporting many years of local history, move the durable outbox to IndexedDB through a versioned migration with rollback/export coverage.

## Operations and future server retention

Local stale warnings are not a server-retention policy. Before production launch, define tenant-aware server retention, export/delete obligations, backup expiration and restore procedures together; legal/privacy policy must determine server retention rather than an arbitrary retry age. Any queue cleanup must distinguish confirmed acknowledgements from pending, blocked and unowned data.
