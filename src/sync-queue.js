const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE_RETRY_DELAY_MS = 5 * 1000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;
const MAX_AUTOMATIC_RETRY_ATTEMPTS = 12;

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

function normalizeLastAttemptAt(value) {
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
    lastAttemptAt: normalizeLastAttemptAt(item.lastAttemptAt),
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
    lastAttemptAt: null,
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
    const lastAttemptAt = new Date(now).toISOString();
    if (kind === "auth") {
      return { ...item, nextAttemptAt:null, lastAttemptAt, lastError, blocked:false };
    }
    if (kind === "permanent") {
      return { ...item, nextAttemptAt:null, lastAttemptAt, lastError, blocked:true };
    }
    const attempts = item.attempts + 1;
    if (attempts >= MAX_AUTOMATIC_RETRY_ATTEMPTS) {
      return {
        ...item,
        attempts,
        nextAttemptAt:null,
        lastAttemptAt,
        lastError:"retry-exhausted:" + lastError,
        blocked:true
      };
    }
    return {
      ...item,
      attempts,
      nextAttemptAt:new Date(now + getSyncRetryDelayMs(attempts, random)).toISOString(),
      lastAttemptAt,
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

export function getMaxAutomaticRetryAttempts() {
  return MAX_AUTOMATIC_RETRY_ATTEMPTS;
}

export function getNextSyncRetryAt(queue) {
  const times = normalizeSyncQueue(queue)
    .filter((item) => !item.blocked && item.nextAttemptAt)
    .map((item) => Date.parse(item.nextAttemptAt))
    .filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}

export function summarizeSyncQueue(queue, { userId = null, nowMs = Date.now() } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const ownerId = normalizeOwnerId(userId);
  const normalized = normalizeSyncQueue(queue);
  const owned = ownerId ? normalized.filter((item) => item.userId === ownerId) : [];
  const unowned = normalized.filter((item) => !item.userId);
  const oldestTimes = owned
    .map((item) => {
      const completedAt = item.session.completedAt;
      const startedAt = item.session.startedAt;
      const raw = typeof completedAt === "string" && Number.isFinite(Date.parse(completedAt))
        ? completedAt
        : startedAt;
      const timestamp = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
      return Number.isFinite(timestamp) && timestamp <= now ? timestamp : Number.NaN;
    })
    .filter(Number.isFinite);
  const oldestPendingAt = oldestTimes.length ? new Date(Math.min(...oldestTimes)).toISOString() : null;
  const staleCount = owned.filter((item) => {
    const raw = typeof item.session.completedAt === "string" && Number.isFinite(Date.parse(item.session.completedAt))
      ? item.session.completedAt
      : item.session.startedAt;
    const timestamp = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
    return Number.isFinite(timestamp) && timestamp <= now && now - timestamp >= 24 * 60 * 60 * 1000;
  }).length;

  return Object.freeze({
    ownedCount: owned.length,
    unownedCount: unowned.length,
    blockedCount: owned.filter((item) => item.blocked).length,
    dueCount: getDueSyncItems(owned, now).length,
    scheduledCount: owned.filter((item) =>
      !item.blocked && item.nextAttemptAt && Date.parse(item.nextAttemptAt) > now
    ).length,
    staleCount,
    oldestPendingAt
  });
}
