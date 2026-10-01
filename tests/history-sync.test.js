import test from "node:test";
import assert from "node:assert/strict";
import { mergeHistory, remoteSessionToHistory } from "../src/history-sync.js";

test("maps remote sessions into the local history contract", () => {
  assert.deepEqual(
    remoteSessionToHistory({
      id: "1",
      started_at: "2026-10-01T12:00:00Z",
      completed_at: "2026-10-01T12:45:00Z",
      name: "Upper Strength",
      source: "manual",
      volume: "560",
      completed_sets: "8"
    }),
    { id:"1", date:"2026-10-01", name:"Upper Strength", volumeKg:560, sets:8, source:"manual" }
  );
});

test("merges remote truth by session id without duplicating local history", () => {
  const merged = mergeHistory(
    [
      { id:"1", date:"2026-10-01", name:"Local", volumeKg:500, sets:7, source:"manual" },
      { id:"2", date:"2026-09-30", name:"Local-only", volumeKg:300, sets:4, source:"manual" }
    ],
    [
      { id:"1", started_at:"2026-10-01T12:00:00Z", completed_at:"2026-10-01T12:45:00Z", name:"Cloud", source:"manual", volume:"560", completed_sets:"8" },
      { id:"3", started_at:"2026-10-02T12:00:00Z", completed_at:null, name:"Cloud-only", source:"manual", volume:"200", completed_sets:"3" }
    ]
  );
  assert.deepEqual(merged.map((item) => item.id), ["2","1","3"]);
  assert.equal(merged.find((item) => item.id === "1").name, "Cloud");
  assert.equal(merged.find((item) => item.id === "1").volumeKg, 560);
});
