const OUTCOMES = Object.freeze([
  "success",
  "transient_failure",
  "auth_failure",
  "permanent_failure",
  "retry_exhausted",
  "manual_retry"
]);

function createCounters() {
  return Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]));
}

const counters = createCounters();

function boundedInteger(value, min, max, fallback = 0) {
  const next = Number(value);
  return Number.isInteger(next) ? Math.min(max, Math.max(min, next)) : fallback;
}

function statusClass(status) {
  if (status == null) return "network";
  const code = Number(status);
  if (!Number.isInteger(code)) return "unknown";
  if (code >= 200 && code <= 299) return "2xx";
  if (code >= 400 && code <= 499) return "4xx";
  if (code >= 500 && code <= 599) return "5xx";
  return "other";
}

export function recordSyncOutcome(outcome, metadata = {}) {
  const normalizedOutcome = OUTCOMES.includes(outcome) ? outcome : "transient_failure";
  counters[normalizedOutcome] += 1;

  const detail = Object.freeze({
    schemaVersion: 1,
    outcome: normalizedOutcome,
    statusClass: statusClass(metadata.status),
    attempt: boundedInteger(metadata.attempt, 0, 1000),
    queueDepth: boundedInteger(metadata.queueDepth, 0, 10000),
    blocked: metadata.blocked === true,
    durationMs: boundedInteger(metadata.durationMs, 0, 300000)
  });

  const target = globalThis.window ?? globalThis;
  if (typeof target?.dispatchEvent === "function" && typeof globalThis.CustomEvent === "function") {
    target.dispatchEvent(new CustomEvent("gym:sync-outcome", { detail }));
  }

  return detail;
}

export function snapshotSyncMetrics() {
  return Object.freeze({
    schemaVersion: 1,
    total: OUTCOMES.reduce((sum, outcome) => sum + counters[outcome], 0),
    outcomes: Object.freeze({ ...counters })
  });
}

export function resetSyncMetrics() {
  for (const outcome of OUTCOMES) counters[outcome] = 0;
}

export function subscribeSyncOutcomes(listener, target = globalThis.window ?? globalThis) {
  if (typeof listener !== "function" || typeof target?.addEventListener !== "function") {
    return () => {};
  }
  const handler = (event) => listener(event.detail);
  target.addEventListener("gym:sync-outcome", handler);
  return () => target.removeEventListener("gym:sync-outcome", handler);
}
