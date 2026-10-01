const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeOwnerId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function normalizeEntry(item) {
  if (!item || typeof item !== "object") return null;
  if (item.session && typeof item.session === "object" && typeof item.session.id === "string" && item.session.id) {
    return { userId: normalizeOwnerId(item.userId), session: item.session };
  }
  if (typeof item.id === "string" && item.id) {
    return { userId: null, session: item };
  }
  return null;
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
  next.push({ userId: normalizeOwnerId(userId), session });
  return next;
}

export function removeSyncItem(queue, sessionId) {
  if (typeof sessionId !== "string" || !sessionId) return normalizeSyncQueue(queue);
  return normalizeSyncQueue(queue).filter((item) => item.session.id !== sessionId);
}
