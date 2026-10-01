export const STORAGE_KEY = "gym:state:v2";
const LEGACY_KEY = "gym:state:v1";

export function defaultState(history = []) {
  return {
    schemaVersion: 2,
    activeView: "dashboard",
    session: null,
    history,
    sampleData: history.length > 0,
    settings: { units: "kg", displayName: "Athlete" }
  };
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
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
  if (current?.schemaVersion === 2) return current;
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
