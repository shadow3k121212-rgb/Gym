import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateVolume, calculateCompletion, suggestProgression, summarizeSession,
  createMovementEvent, estimateOneRepMax, getNextOpenSet
} from "../src/workout-engine.js";

test("calculates set and session volume", () => {
  assert.equal(calculateVolume([{ reps: 8, weightKg: 70 }, { reps: 8, weightKg: 70 }]), 1120);
});

test("calculates completion from explicit set state", () => {
  assert.equal(calculateCompletion([{ targetSets: 3, sets: [{completed:true},{completed:true},{completed:true},{completed:true}] }]), 1);
  assert.equal(calculateCompletion([{ targetSets: 4, sets: [{completed:true},{completed:true},{completed:false},{completed:false}] }]), 0.5);
  assert.equal(calculateCompletion([]), 0);
});

test("only progresses when all planned sets are completed", () => {
  assert.equal(suggestProgression(70, 3, 4), 70);
  assert.equal(suggestProgression(70, 4, 4), 72.5);
});

test("summarizes explicit completed set records", () => {
  const result = summarizeSession([{ targetSets: 2, sets: [
    {reps:8, weightKg:50, completed:true},
    {reps:8, weightKg:50, completed:false}
  ] }]);
  assert.equal(result.volumeKg, 400);
  assert.equal(result.totalSets, 2);
  assert.equal(result.completedSets, 1);
  assert.equal(result.completion, 0.5);
});

test("estimates one rep max safely", () => {
  assert.equal(estimateOneRepMax(60, 10), 80);
  assert.equal(estimateOneRepMax(0, 10), 0);
});

test("finds the next incomplete set", () => {
  assert.equal(getNextOpenSet({sets:[{completed:true},{completed:false}]}).completed, false);
  assert.equal(getNextOpenSet({sets:[{completed:true}]}), null);
});

test("movement events have a versioned, source-labelled schema", () => {
  const event = createMovementEvent({
    sessionId:"s1", exerciseId:"bench", timestamp:"2026-10-01T12:00:00Z",
    reps:8, source:"manual"
  });
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.exerciseId, "bench");
  assert.equal(event.confidence, null);
});
