import { getExercise } from "./data.js";
import { normalizeSyncQueue } from "./sync-queue.js";

export const STORAGE_KEY = "gym:state:v2";
const LEGACY_KEY = "gym:state:v1";

export function defaultState(history = []) {
  return {
    schemaVersion: 2,
    activeView: "dashboard",
    session: null,
    history,
    sampleData: history.length > 0,
    syncQueue: [],
    settings: { units: "kg", displayName: "Athlete" }
  };
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function finiteInRange(value, min, max, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.min(max, Math.max(min, next)) : fallback;
}

function normalizeSet(set, index) {
  if (!set || typeof set !== "object") return null;
  const completedAt = typeof set.completedAt === "string" && !Number.isNaN(Date.parse(set.completedAt))
    ? new Date(set.completedAt).toISOString()
    : null;
  const completed = Boolean(set.completed) && Boolean(completedAt);
  return {
    index: index + 1,
    reps: finiteInRange(set.reps, 0, 1000, 0),
    weightKg: finiteInRange(set.weightKg, 0, 1000, 0),
    completed,
    completedAt: completed ? completedAt : null,
    rpe: set.rpe === null || set.rpe === undefined || set.rpe === "" ? null : finiteInRange(set.rpe, 1, 10, 1)
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== "object" || typeof session.id !== "string") return null;
  if (!Array.isArray(session.exercises)) return null;
  const startedAt = typeof session.startedAt === "string" && !Number.isNaN(Date.parse(session.startedAt))
    ? new Date(session.startedAt).toISOString()
    : new Date().toISOString();
  const exercises = session.exercises
    .filter((item) => item && typeof item.exerciseId === "string" && getExercise(item.exerciseId))
    .map((item) => ({
      exerciseId: item.exerciseId,
      sets: Array.isArray(item.sets)
        ? item.sets.map((set, index) => normalizeSet(set, index)).filter(Boolean).slice(0, 50)
        : []
    }))
    .slice(0, 50);
  if (!exercises.length) return null;
  return {
    id: session.id.slice(0, 120),
    name: typeof session.name === "string" && session.name.trim() ? session.name.slice(0, 120) : "Workout",
    startedAt,
    completedAt: typeof session.completedAt === "string" && !Number.isNaN(Date.parse(session.completedAt)) && new Date(session.completedAt).getTime() >= Date.parse(startedAt)
      ? new Date(session.completedAt).toISOString()
      : null,
    source: ["manual", "camera", "wearable"].includes(session.source) ? session.source : "manual",
    exercises
  };
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.filter((item) => item && typeof item.id === "string").map((item) => ({
    id: item.id,
    date: typeof item.date === "string" ? item.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    name: typeof item.name === "string" ? item.name.slice(0, 120) : "Workout",
    volumeKg: finiteInRange(item.volumeKg, 0, 10000000, 0),
    sets: Math.floor(finiteInRange(item.sets, 0, 1000, 0)),
    source: typeof item.source === "string" ? item.source.slice(0, 30) : "manual"
  }));
}

function migrateLegacy(legacy) {
  if (!legacy || typeof legacy !== "object") return null;
  const history = Array.isArray(legacy.history)
    ? legacy.history.filter((item) => item && Number.isFinite(Number(item.volume))).map((item, index) => ({
        id: `legacy-${index}`,
        date: new Date(Date.now() - (6 - index) * 86400000).toISOString().slice(0, 10),
        name: "Imported session",
        volumeKg: Number(item.volume),
        sets: 0,
        source: "imported"
      }))
    : [];
  return { ...defaultState(history), sampleData: false };
}

export function loadState(storage = globalThis.localStorage) {
  const current = safeParse(storage?.getItem?.(STORAGE_KEY));
  if (current?.schemaVersion === 2) {
    const base = defaultState();
    return {
      ...base,
      ...current,
      activeView: ["dashboard", "workout", "progress", "library", "settings"].includes(current.activeView) ? current.activeView : "dashboard",
      session: normalizeSession(current.session),
      history: normalizeHistory(current.history),
      syncQueue: normalizeSyncQueue(current.syncQueue)
        .map((item) => ({ userId: item.userId, session: normalizeSession(item.session) }))
        .filter((item) => item.session),
      settings: {
        ...base.settings,
        ...(current.settings || {}),
        units: current.settings?.units === "lb" ? "lb" : "kg",
        displayName: typeof current.settings?.displayName === "string" && current.settings.displayName.trim()
          ? current.settings.displayName.slice(0, 50)
          : "Athlete"
      }
    };
  }
  const legacy = migrateLegacy(safeParse(storage?.getItem?.(LEGACY_KEY)));
  if (legacy) {
    persistState(legacy, storage);
    return legacy;
  }
  return defaultState([]);
}

export function persistState(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("GYM persistence error", error);
    return false;
  }
}

export function clearState(storage = globalThis.localStorage) {
  storage?.removeItem?.(STORAGE_KEY);
  storage?.removeItem?.(LEGACY_KEY);
}

export function exportState(state, download = true) {
  const payload = {
    product: "GYM Training OS",
    schemaVersion: state.schemaVersion,
    exportedAt: new Date().toISOString(),
    data: state
  };
  if (!download || typeof document === "undefined") return payload;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gym-data-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return payload;
}
