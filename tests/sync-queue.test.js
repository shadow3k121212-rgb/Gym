import test from "node:test";
import assert from "node:assert/strict";
import { enqueueSyncItem, getDueSyncItems, getNextSyncRetryAt, getSyncRetryDelayMs, normalizeSyncQueue, recordSyncFailure, removeSyncItem, retrySyncItem } from "../src/sync-queue.js";

const session = (id, name = id) => ({ id, name });

test("normalizes queue entries, preserves all durable work, and deduplicates by session id", () => {
  const userId = "123e4567-e89b-12d3-a456-426614174000";
  const input = [
    { userId, session:session("q-1", "first") },
    null,
    { userId, session:session("q-2", "second") },
    { userId, session:session("q-1", "latest") },
    { id: 123 },
    { userId:null, session:session("q-25", "twenty-five") }
  ];
  const normalized = normalizeSyncQueue(input);
  assert.deepEqual(normalized, [
    { userId, session:session("q-1", "latest"), attempts:0, nextAttemptAt:null, lastError:null, blocked:false },
    { userId, session:session("q-2", "second"), attempts:0, nextAttemptAt:null, lastError:null, blocked:false },
    { userId:null, session:session("q-25", "twenty-five"), attempts:0, nextAttemptAt:null, lastError:null, blocked:false }
  ]);

  const many = normalizeSyncQueue(Array.from({ length: 25 }, (_, i) => ({
    userId,
    session:session("q-" + i)
  })));
  assert.equal(many.length, 25);
});

test("enqueue replaces the same session without mutating the original queue", () => {
  const userId = "123e4567-e89b-12d3-a456-426614174000";
  const queue = [
    { userId, session:session("q-1", "one") },
    { userId, session:session("q-2", "two") }
  ];
  const next = enqueueSyncItem(queue, session("q-1", "updated"), userId);
  assert.deepEqual(next, [
    { userId, session:session("q-2", "two"), attempts:0, nextAttemptAt:null, lastError:null, blocked:false },
    { userId, session:session("q-1", "updated"), attempts:0, nextAttemptAt:null, lastError:null, blocked:false }
  ]);
  assert.deepEqual(queue, [
    { userId, session:session("q-1", "one") },
    { userId, session:session("q-2", "two") }
  ]);
});

test("remove deletes only the requested session", () => {
  const queue = [
    { userId:null, session:session("q-1") },
    { userId:null, session:session("q-2") },
    { userId:null, session:session("q-3") }
  ];
  assert.deepEqual(removeSyncItem(queue, "q-2"), [
    { userId:null, session:session("q-1"), attempts:0, nextAttemptAt:null, lastError:null, blocked:false },
    { userId:null, session:session("q-3"), attempts:0, nextAttemptAt:null, lastError:null, blocked:false }
  ]);
  assert.deepEqual(removeSyncItem(queue, "missing"), queue);
});

test("invalid owner ids are treated as unowned and cannot be adopted implicitly", () => {
  const queue = enqueueSyncItem([], session("q-1"), "not-a-user-id");
  assert.deepEqual(queue, [{ userId:null, session:session("q-1"), attempts:0, nextAttemptAt:null, lastError:null, blocked:false }]);
});

test("legacy raw sessions remain preserved as unowned queue entries", () => {
  assert.deepEqual(
    normalizeSyncQueue([session("legacy-1")]),
    [{ userId:null, session:session("legacy-1") }]
  );
});

test("backoff is exponential and capped", () => {
  assert.equal(getSyncRetryDelayMs(1), 5000);
  assert.equal(getSyncRetryDelayMs(2), 10000);
  assert.equal(getSyncRetryDelayMs(3), 20000);
  assert.equal(getSyncRetryDelayMs(100), 15 * 60 * 1000);
});

test("transient failures persist retry state without dropping the session", () => {
  const userId = "123e4567-e89b-12d3-a456-426614174000";
  const queue = enqueueSyncItem([], session("q-retry"), userId);
  const now = Date.parse("2026-10-01T00:00:00.000Z");
  const failed = recordSyncFailure(queue, "q-retry", { kind:"transient", reason:"network", nowMs:now });
  assert.equal(failed.length, 1);
  assert.equal(failed[0].attempts, 1);
  assert.equal(failed[0].lastError, "network");
  assert.equal(failed[0].blocked, false);
  assert.equal(failed[0].nextAttemptAt, "2026-10-01T00:00:05.000Z");
  assert.equal(getNextSyncRetryAt(failed), Date.parse("2026-10-01T00:00:05.000Z"));
  assert.equal(getDueSyncItems(failed, now).length, 0);
  assert.equal(getDueSyncItems(failed, now + 5000).length, 1);
});

test("auth failures remain immediately retryable after re-authentication", () => {
  const queue = enqueueSyncItem([], session("q-auth"));
  const failed = recordSyncFailure(queue, "q-auth", { kind:"auth", reason:"expired", nowMs:0 });
  assert.equal(failed[0].nextAttemptAt, null);
  assert.equal(failed[0].blocked, false);
  assert.equal(getDueSyncItems(failed, 0).length, 1);
});

test("permanent sync failures stay retained but blocked until explicitly retried", () => {
  const queue = enqueueSyncItem([], session("q-blocked"));
  const blocked = recordSyncFailure(queue, "q-blocked", { kind:"permanent", reason:"conflict", nowMs:0 });
  assert.equal(blocked[0].blocked, true);
  assert.equal(blocked[0].lastError, "conflict");
  assert.equal(getDueSyncItems(blocked, Number.MAX_SAFE_INTEGER).length, 0);
  const retried = retrySyncItem(blocked, "q-blocked");
  assert.equal(retried[0].blocked, false);
  assert.equal(retried[0].attempts, 0);
  assert.equal(getDueSyncItems(retried, 0).length, 1);
});
