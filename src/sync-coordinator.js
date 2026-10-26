const MAX_TIMER_DELAY_MS = 2147483647;

export function createSyncCoordinator({
  flush,
  getNextRetryAt,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (typeof flush !== "function") throw new TypeError("flush must be a function");
  if (typeof getNextRetryAt !== "function") throw new TypeError("getNextRetryAt must be a function");

  let inFlight = null;
  let retryTimer = null;
  let disposed = false;

  function schedule() {
    if (disposed) return;
    if (retryTimer) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    const nextRetryAt = Number(getNextRetryAt());
    if (!Number.isFinite(nextRetryAt)) return;
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY_MS, nextRetryAt - Number(now())));
    retryTimer = setTimer(() => {
      retryTimer = null;
      return run();
    }, delay);
  }

  function run() {
    if (disposed) return Promise.resolve(false);
    if (inFlight) return inFlight;

    inFlight = Promise.resolve()
      .then(() => flush())
      .finally(() => {
        inFlight = null;
        schedule();
      });

    return inFlight;
  }

  function cancel() {
    disposed = true;
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = null;
  }

  return Object.freeze({
    run,
    schedule,
    cancel,
    isRunning: () => Boolean(inFlight)
  });
}
