import test from "node:test";
import assert from "node:assert/strict";
import { createSyncCoordinator } from "../src/sync-coordinator.js";

test("coalesces concurrent flush triggers and schedules one future retry", async () => {
  let now = 1000;
  const timers = [];
  let flushCalls = 0;
  const coordinator = createSyncCoordinator({
    flush: async () => {
      flushCalls += 1;
    },
    getNextRetryAt: () => 1200,
    now: () => now,
    setTimer: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    }
  });

  await Promise.all([coordinator.run(), coordinator.run(), coordinator.run()]);
  assert.equal(flushCalls, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 200);

  const firstTimer = timers[0];
  const timerRun = firstTimer.callback();
  timers.splice(0, 1);
  await timerRun;
  assert.equal(flushCalls, 2);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 200);

  coordinator.cancel();
  assert.equal(timers.length, 0);
  now = 5000;
  timers[0]?.callback?.();
  assert.equal(flushCalls, 2);
});

test("reuses the same in-flight promise for callers", async () => {
  let release;
  let flushCalls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const coordinator = createSyncCoordinator({
    flush: async () => {
      flushCalls += 1;
      await gate;
    },
    getNextRetryAt: () => null
  });

  const first = coordinator.run();
  const second = coordinator.run();
  assert.equal(first, second);
  release();
  await first;
  assert.equal(flushCalls, 1);
});
