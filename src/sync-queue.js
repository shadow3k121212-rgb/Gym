const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE_RETRY_DELAY_MS = 5 * 1000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;

function normalizeOwnerId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function normalizeAttempts(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1000 ? value : 0;
}

function normalizeRetryAt(value) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeEntry(item) {
  if (!item || typeof item !== "object") return null;
  const candidate = item.session && typeof item.session === "object" ? item.session : item;
  if (typeof candidate.id !== "string" || !candidate.id) return null;
  return {
    userId: normalizeOwnerId(item.session ? item.userId : null),
    session: candidate,
    attempts: normalizeAttempts(item.attempts),
    nextAttemptAt: normalizeRetryAt(item.nextAttemptAt),
    lastError: typeof item.lastError === "string" && item.lastError.length <= 200 ? item.lastError : null,
    blocked: item.blocked === true
  };
}

export function normalizeSyncQueue(queue) {
  if (!Array.isArray(queue)) return [];
  const byId = new Map();
  for (const raw of queue) {
    const entry = normalizeEntry(raw);
    if (entry) byId.set(entry.session.id, entry);
  }
  return [...byId.values()];
}

export function enqueueSyncItem(queue, session, userId = null) {
  if (!session || typeof session !== "object" || typeof session.id !== "string" || !session.id) {
    return normalizeSyncQueue(queue);
  }
  const next = normalizeSyncQueue(queue).filter((item) => item.session.id !== session.id);
  next.push({
    userId: normalizeOwnerId(userId),
    session,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    blocked: false
  });
  return next;
}

export function removeSyncItem(queue, sessionId) {
  if (typeof sessionId !== "string" || !sessionId) return normalizeSyncQueue(queue);
  return normalizeSyncQueue(queue).filter((item) => item.session.id !== sessionId);
}

export function getSyncRetryDelayMs(attempt, random = Math.random) {
  const safeAttempt = Math.max(1, normalizeAttempts(attempt));
  const ceiling = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** Math.min(12, safeAttempt - 1)));
  const sample = typeof random === "function" ? Number(random()) : 0.5;
  const jitter = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
  return Math.max(1, Math.floor(ceiling * jitter));
}

export function getDueSyncItems(queue, nowMs = Date.now()) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return normalizeSyncQueue(queue).filter((item) => {
    if (item.blocked) return false;
    if (!item.nextAttemptAt) return true;
    return Date.parse(item.nextAttemptAt) <= now;
  });
}

export function recordSyncFailure(queue, sessionId, {
  kind = "transient",
  reason = "sync-failed",
  nowMs = Date.now(),
  random = Math.random
} = {}) {
  const normalized = normalizeSyncQueue(queue);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return normalized.map((item) => {
    if (item.session.id !== sessionId) return item;
    const lastError = typeof reason === "string" ? reason.slice(0, 200) : "sync-failed";
    if (kind === "auth") {
      return { ...item, nextAttemptAt:null, lastError, blocked:false };
    }
    if (kind === "permanent") {
      return { ...item, nextAttemptAt:null, lastError, blocked:true };
    }
    const attempts = item.attempts + 1;
    return {
      ...item,
      attempts,
      nextAttemptAt:new Date(now + getSyncRetryDelayMs(attempts, random)).toISOString(),
      lastError,
      blocked:false
    };
  });
}

export function retrySyncItem(queue, sessionId) {
  return normalizeSyncQueue(queue).map((item) =>
    item.session.id === sessionId
      ? { ...item, attempts:0, nextAttemptAt:null, lastError:null, blocked:false }
      : item
  );
}

export function getNextSyncRetryAt(queue) {
  const times = normalizeSyncQueue(queue)
    .filter((item) => !item.blocked && item.nextAttemptAt)
    .map((item) => Date.parse(item.nextAttemptAt))
    .filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}
