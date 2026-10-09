const SOURCES = new Set(["manual", "camera", "wearable"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validIsoDate(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function remoteSessionToHistory(session, cloudOwnerId = null) {
  if (!session || typeof session.id !== "string" || !UUID_PATTERN.test(session.id)) return null;
  const startedAt = validIsoDate(session.started_at);
  const completedAt = session.completed_at == null ? null : validIsoDate(session.completed_at);
  if (!startedAt || (session.completed_at != null && !completedAt)) return null;
  if (completedAt && new Date(completedAt) < new Date(startedAt)) return null;
  const isoDate = completedAt || startedAt;
  const volume = Number(session.volume);
  const sets = Number(session.completed_sets);
  const source = SOURCES.has(session.source) ? session.source : null;
  if (!Number.isFinite(volume) || volume < 0 || volume > 10000000 || !source) return null;
  return {
    id: session.id.toLowerCase(),
    date: isoDate.slice(0, 10),
    name: typeof session.name === "string" && session.name.trim() ? session.name.slice(0, 120) : "Workout",
    volumeKg: Math.round(volume * 10) / 10,
    sets: Number.isFinite(sets) ? Math.max(0, Math.min(1000, Math.floor(sets))) : 0,
    source,
    ...(typeof cloudOwnerId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cloudOwnerId)
      ? { cloudOwnerId: cloudOwnerId.toLowerCase() }
      : {})
  };
}

export function mergeHistory(localHistory, remoteSessions, cloudOwnerId = null) {
  const merged = new Map(
    (Array.isArray(localHistory) ? localHistory : [])
      .filter((item) => item && item.id)
      .map((item) => [item.id, item])
  );

  for (const remote of Array.isArray(remoteSessions) ? remoteSessions : []) {
    const mapped = remoteSessionToHistory(remote, cloudOwnerId);
    if (mapped) merged.set(mapped.id, { ...(merged.get(mapped.id) || {}), ...mapped });
  }

  return [...merged.values()].sort((a, b) => {
    const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
    return dateCompare || String(a.id).localeCompare(String(b.id));
  });
}