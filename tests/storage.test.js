import test from "node:test";
import assert from "node:assert/strict";
import { defaultState, loadState, persistState, exportState, clearState, STORAGE_KEY } from "../src/storage.js";

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem:(key)=>data.has(key)?data.get(key):null, setItem:(key,value)=>data.set(key,value), removeItem:(key)=>data.delete(key) };
}
test("loads a clean v2 state with a durable sync queue", () => { const state = loadState(makeStorage()); assert.equal(state.schemaVersion, 2); assert.equal(state.session, null); assert.deepEqual(state.syncQueue, []); });
test("migrates old v1 history", () => {
  const state = loadState(makeStorage({"gym:state:v1":JSON.stringify({history:[{day:"Mon",volume:1000}]})}));
  assert.equal(state.schemaVersion, 2); assert.equal(state.history[0].volumeKg,1000); assert.equal(state.sampleData,false);
});
test("repairs malformed v2 state instead of trusting corrupted storage", () => {
  const storage = makeStorage({"gym:state:v2": JSON.stringify({
    schemaVersion: 2,
    activeView: "not-a-view",
    session: {
      id: "recovery-1",
      startedAt: "2026-10-01T10:00:00.000Z",
      completedAt: "2026-10-01T09:00:00.000Z",
      exercises: [{ exerciseId: "bench", sets: [{ reps: 8, weightKg: 70, completed: true }] }]
    },
    history: [{ id: "h1", volumeKg: "not-number" }, null],
    syncQueue: [{ id: "q1", exercises: [] }, null],
    settings: { units: "stones", displayName: "<script>" }
  })});
  const state = loadState(storage);
  assert.equal(state.activeView, "dashboard");
  assert.ok(state.session);
  assert.equal(state.session.completedAt, null);
  assert.equal(state.session.exercises[0].sets[0].completed, false);
  assert.equal(state.session.exercises[0].sets[0].completedAt, null);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].volumeKg, 0);
  assert.deepEqual(state.syncQueue, []);
  assert.equal(state.settings.units, "kg");
});

test("persists and exports without a browser", () => {
  const storage = makeStorage(); const state=defaultState(); state.settings.displayName="Test Athlete";
  assert.equal(persistState(state,storage),true); assert.ok(storage.getItem(STORAGE_KEY));
  assert.equal(exportState(state,false).data.settings.displayName,"Test Athlete");
});
test("clears current and legacy keys", () => {
  const storage=makeStorage({[STORAGE_KEY]:"{}", "gym:state:v1":"{}"}); clearState(storage);
  assert.equal(storage.getItem(STORAGE_KEY),null); assert.equal(storage.getItem("gym:state:v1"),null);
});
test("does not silently truncate durable history or sync queue", () => {
  const session = (id) => ({
    id,
    startedAt: "2026-10-01T10:00:00.000Z",
    completedAt: null,
    name: "Workout",
    source: "manual",
    exercises: [{ exerciseId: "bench", sets: [{ index: 1, reps: 8, weightKg: 70, completed: false, completedAt: null, rpe: null }] }]
  });
  const storage = makeStorage({"gym:state:v2": JSON.stringify({
    schemaVersion: 2,
    activeView: "dashboard",
    session: null,
    history: Array.from({ length: 120 }, (_, i) => ({ id: "h-" + i, date: "2026-10-01", name: "Workout", volumeKg: 100, sets: 1, source: "manual" })),
    syncQueue: Array.from({ length: 25 }, (_, i) => session("q-" + i)),
    settings: { units: "kg", displayName: "Athlete" }
  })});
  const state = loadState(storage);
  assert.equal(state.history.length, 120);
  assert.equal(state.syncQueue.length, 25);
});
