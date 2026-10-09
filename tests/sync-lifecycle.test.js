import test from "node:test";
import assert from "node:assert/strict";
import { createSyncCoordinator } from "../src/sync-coordinator.js";
import { wireSyncLifecycle } from "../src/sync-lifecycle.js";

test("coalesces online storms and auth-change events during online recovery", async () => {
  const target = new EventTarget();
  let authenticated = false;
  let refreshCalls = 0;
  let flushCalls = 0;
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });

  const coordinator = createSyncCoordinator({
    flush: async () => {
      flushCalls += 1;
    },
    getNextRetryAt: () => null
  });

  const dispose = wireSyncLifecycle({
    target,
    hasAuth: () => authenticated,
    refreshAuth: async () => {
      refreshCalls += 1;
      await refreshGate;
      authenticated = true;
    },
    flushSyncQueue: () => coordinator.run()
  });

  target.dispatchEvent(new Event("online"));
  target.dispatchEvent(new Event("online"));
  target.dispatchEvent(new Event("gym:auth-changed"));
  assert.equal(refreshCalls, 1);
  assert.equal(flushCalls, 0);

  releaseRefresh();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(refreshCalls, 1);
  assert.equal(flushCalls, 1);

  target.dispatchEvent(new Event("gym:auth-changed"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(flushCalls, 2);

  dispose();
  coordinator.cancel();
});
