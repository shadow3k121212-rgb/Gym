import test from "node:test";
import assert from "node:assert/strict";
import { calculateVolume, calculateCompletion, suggestProgression, summarizeSession, createMovementEvent } from "../src/workout-engine.js";

test("calculates training volume", () => {
  assert.equal(calculateVolume([{ reps: 8, weightKg: 70 }, { reps: 8, weightKg: 70 }]), 1120);
});

test("clamps completion to the planned target", () => {
  assert.equal(calculateCompletion([{ targetSets: 3, completedSets: 4 }]), 1);
  assert.equal(calculateCompletion([{ targetSets: 4, completedSets: 2 }]), 0.5);
});

test("only progresses when the planned sets are completed", () => {
  assert.equal(suggestProgression(70, 3, 4), 70);
  assert.equal(suggestProgression(70, 4, 4), 72.5);
});

test("summarizes a session deterministically", () => {
  const result = summarizeSession([{ targetSets: 3, completedSets: 2, sets: [{reps:8, weightKg:50},{reps:8, weightKg:50}] }]);
  assert.deepEqual(result, { volumeKg: 800, totalSets: 2, completedExercises: 0, completion: 2/3 });
});

test("movement events keep a versioned schema", () => {
  const event = createMovementEvent({ sessionId:"s1", exerciseId:"bench", timestamp:"2026-10-01T12:00:00Z", reps:8, source:"manual" });
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.exerciseId, "bench");
  assert.equal(event.confidence, null);
});
