import test from "node:test";
import assert from "node:assert/strict";
import { defaultState, loadState, persistState, exportState, clearState, STORAGE_KEY } from "../src/storage.js";

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key)
  };
}

test("loads a clean v2 state", () => {
  const storage = makeStorage();
  const state = loadState(storage);
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.session, null);
});

test("migrates the old v1 history shape", () => {
  const storage = makeStorage({
    "gym:state:v1": JSON.stringify({
      history: [{ day: "Mon", volume: 1000 }]
    })
  });
  const state = loadState(storage);
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.history[0].volumeKg, 1000);
  assert.equal(state.sampleData, false);
});

test("persists a state and exports it without requiring a browser", () => {
  const storage = makeStorage();
  const state = defaultState();
  state.settings.displayName = "Test Athlete";
  assert.equal(persistState(state, storage), true);
  assert.equal(storage.getItem(STORAGE_KEY) !== null, true);
  const payload = exportState(state, false);
  assert.equal(payload.data.settings.displayName, "Test Athlete");
});

test("clearState removes both current and legacy keys", () => {
  const storage = makeStorage({
    [STORAGE_KEY]: "{}",
    "gym:state:v1": "{}"
  });
  clearState(storage);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.getItem("gym:state:v1"), null);
});
