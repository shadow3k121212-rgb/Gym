import test from "node:test";
import assert from "node:assert/strict";
import { mergeHistory, remoteSessionToHistory } from "../src/history-sync.js";

test("maps remote sessions into the local history contract", () => {
  assert.deepEqual(
    remoteSessionToHistory({
      id: "123e4567-e89b-12d3-a456-426614174001",
      started_at: "2026-10-01T12:00:00Z",
      completed_at: "2026-10-01T12:45:00Z",
      name: "Upper Strength",
      source: "manual",
      volume: "560",
      completed_sets: "8"
    }),
    { id:"123e4567-e89b-12d3-a456-426614174001", date:"2026-10-01", name:"Upper Strength", volumeKg:560, sets:8, source:"manual" }
  );
});

test("merges remote truth by session id without duplicating local history", () => {
  const merged = mergeHistory(
    [
      { id:"123e4567-e89b-12d3-a456-426614174001", date:"2026-10-01", name:"Local", volumeKg:500, sets:7, source:"manual" },
      { id:"123e4567-e89b-12d3-a456-426614174002", date:"2026-09-30", name:"Local-only", volumeKg:300, sets:4, source:"manual" }
    ],
    [
      { id:"123e4567-e89b-12d3-a456-426614174001", started_at:"2026-10-01T12:00:00Z", completed_at:"2026-10-01T12:45:00Z", name:"Cloud", source:"manual", volume:"560", completed_sets:"8" },
      { id:"123e4567-e89b-12d3-a456-426614174003", started_at:"2026-10-02T12:00:00Z", completed_at:null, name:"Cloud-only", source:"manual", volume:"200", completed_sets:"3" }
    ]
  );
  assert.deepEqual(merged.map((item) => item.id), ["123e4567-e89b-12d3-a456-426614174002","123e4567-e89b-12d3-a456-426614174001","123e4567-e89b-12d3-a456-426614174003"]);
  assert.equal(merged.find((item) => item.id === "123e4567-e89b-12d3-a456-426614174001").name, "Cloud");
  assert.equal(merged.find((item) => item.id === "123e4567-e89b-12d3-a456-426614174001").volumeKg, 560);
});
test("rejects malformed remote sessions without replacing valid local history", () => {
  assert.equal(remoteSessionToHistory({
    id:"123e4567-e89b-12d3-a456-426614174005",
    started_at:"not-a-date",
    completed_at:null,
    name:"Broken",
    source:"manual",
    volume:"100",
    completed_sets:"2"
  }), null);
  assert.equal(remoteSessionToHistory({
    id:"123e4567-e89b-12d3-a456-426614174006",
    started_at:"2026-10-01T12:00:00Z",
    completed_at:null,
    name:"Broken",
    source:"unknown",
    volume:"100",
    completed_sets:"2"
  }), null);
  assert.equal(remoteSessionToHistory({
    id:"123e4567-e89b-12d3-a456-426614174007",
    started_at:"2026-10-01T12:00:00Z",
    completed_at:null,
    name:"Broken",
    source:"manual",
    volume:"NaN",
    completed_sets:"2"
  }), null);

  const local = [{ id:"123e4567-e89b-12d3-a456-426614174004", date:"2026-10-01", name:"Trusted local", volumeKg:560, sets:8, source:"manual" }];
  const merged = mergeHistory(local, [{
    id:"123e4567-e89b-12d3-a456-426614174004",
    started_at:"still-invalid",
    completed_at:null,
    name:"Poison",
    source:"manual",
    volume:"1",
    completed_sets:"1"
  }]);
  assert.deepEqual(merged, local);
});

test("normalizes valid remote history values deterministically", () => {
  assert.deepEqual(
    remoteSessionToHistory({
      id:"123e4567-e89b-12d3-a456-426614174008",
      started_at:"2026-10-01T12:00:00Z",
      completed_at:"2026-10-01T12:45:00Z",
      name:"",
      source:"manual",
      volume:"560.567",
      completed_sets:"8.9"
    }),
    { id:"123e4567-e89b-12d3-a456-426614174008", date:"2026-10-01", name:"Workout", volumeKg:560.6, sets:8, source:"manual" }
  );
});
test("tags remote history with the authenticated cloud owner", () => {
  const owner = "123e4567-e89b-12d3-a456-426614174000";
  assert.deepEqual(
    remoteSessionToHistory({
      id:"123e4567-e89b-12d3-a456-426614174009",
      started_at:"2026-10-01T12:00:00Z",
      completed_at:null,
      name:"Owned",
      source:"manual",
      volume:"100",
      completed_sets:"2"
    }, owner),
    { id:"123e4567-e89b-12d3-a456-426614174009", date:"2026-10-01", name:"Owned", volumeKg:100, sets:2, source:"manual", cloudOwnerId:owner }
  );
});
