export function normalizeSyncQueue(queue) {
  if (!Array.isArray(queue)) return [];
  const byId = new Map();
  for (const item of queue) {
    if (item && typeof item === "object" && typeof item.id === "string" && item.id) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

export function enqueueSyncItem(queue, session) {
  if (!session || typeof session !== "object" || typeof session.id !== "string" || !session.id) {
    return normalizeSyncQueue(queue);
  }
  const next = normalizeSyncQueue(queue).filter((item) => item.id !== session.id);
  next.push(session);
  return next;
}

export function removeSyncItem(queue, sessionId) {
  if (typeof sessionId !== "string" || !sessionId) return normalizeSyncQueue(queue);
  return normalizeSyncQueue(queue).filter((item) => item.id !== sessionId);
}