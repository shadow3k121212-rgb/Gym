export function remoteSessionToHistory(session) {
  if (!session || typeof session.id !== "string") return null;
  const dateSource = session.completed_at || session.started_at;
  return {
    id: session.id,
    date: typeof dateSource === "string" ? dateSource.slice(0, 10) : "",
    name: typeof session.name === "string" ? session.name : "Workout",
    volumeKg: Math.round((Number(session.volume) || 0) * 10) / 10,
    sets: Math.max(0, Number(session.completed_sets) || 0),
    source: typeof session.source === "string" ? session.source : "manual"
  };
}

export function mergeHistory(localHistory, remoteSessions) {
  const merged = new Map(
    (Array.isArray(localHistory) ? localHistory : [])
      .filter((item) => item && item.id)
      .map((item) => [item.id, item])
  );

  for (const remote of Array.isArray(remoteSessions) ? remoteSessions : []) {
    const mapped = remoteSessionToHistory(remote);
    if (mapped) merged.set(mapped.id, { ...(merged.get(mapped.id) || {}), ...mapped });
  }

  return [...merged.values()].sort((a, b) => {
    const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
    return dateCompare || String(a.id).localeCompare(String(b.id));
  });
}
