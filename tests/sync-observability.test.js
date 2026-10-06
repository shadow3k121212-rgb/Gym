import test from "node:test";
import assert from "node:assert/strict";
import {
  recordSyncOutcome,
  resetSyncMetrics,
  snapshotSyncMetrics,
  subscribeSyncOutcomes
} from "../src/sync-observability.js";

test("records only bounded low-cardinality sync outcome fields", () => {
  resetSyncMetrics();
  const detail = recordSyncOutcome("transient_failure", {
    status: 503,
    attempt: 999999,
    queueDepth: 999999,
    blocked: true,
    durationMs: 999999
  });

  assert.deepEqual(detail, {
    schemaVersion: 1,
    outcome: "transient_failure",
    statusClass: "5xx",
    attempt: 1000,
    queueDepth: 10000,
    blocked: true,
    durationMs: 300000
  });

  assert.deepEqual(snapshotSyncMetrics(), {
    schemaVersion: 1,
    total: 1,
    outcomes: {
      success: 0,
      transient_failure: 1,
      auth_failure: 0,
      permanent_failure: 0,
      retry_exhausted: 0,
      manual_retry: 0
    }
  });
});

test("normalizes unknown outcomes and status classes", () => {
  resetSyncMetrics();
  const detail = recordSyncOutcome("tenant-123-session-456", { status: 418, attempt: 2 });
  assert.equal(detail.outcome, "transient_failure");
  assert.equal(detail.statusClass, "4xx");
  assert.equal(detail.attempt, 2);
});

test("emits a safe browser event without exposing identifiers or workout payloads", () => {
  resetSyncMetrics();
  const seen = [];
  const target = new EventTarget();
  const unsubscribe = subscribeSyncOutcomes((detail) => seen.push(detail), target);
  recordSyncOutcome("success", { status: 201, attempt: 1, queueDepth: 3, durationMs: 42 });
  unsubscribe();

  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], {
    schemaVersion: 1,
    outcome: "success",
    statusClass: "2xx",
    attempt: 1,
    queueDepth: 3,
    blocked: false,
    durationMs: 42
  });
  assert.equal("sessionId" in seen[0], false);
  assert.equal("userId" in seen[0], false);
});
