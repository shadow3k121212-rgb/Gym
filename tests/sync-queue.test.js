import test from "node:test";
import assert from "node:assert/strict";
import { enqueueSyncItem, normalizeSyncQueue, removeSyncItem } from "../src/sync-queue.js";

const session = (id, name = id) => ({ id, name });

test("normalizes queue entries, preserves all durable work, and deduplicates by session id", () => {
  const userId = "123e4567-e89b-12d3-a456-426614174000";
  const input = [
    { userId, session:session("q-1", "first") },
    null,
    { userId, session:session("q-2", "second") },
    { userId, session:session("q-1", "latest") },
    { id: 123 },
    { userId:null, session:session("q-25", "twenty-five") }
  ];
  const normalized = normalizeSyncQueue(input);
  assert.deepEqual(normalized, [
    { userId, session:session("q-1", "latest") },
    { userId, session:session("q-2", "second") },
    { userId:null, session:session("q-25", "twenty-five") }
  ]);

  const many = normalizeSyncQueue(Array.from({ length: 25 }, (_, i) => ({
    userId,
    session:session("q-" + i)
  })));
  assert.equal(many.length, 25);
});

test("enqueue replaces the same session without mutating the original queue", () => {
  const userId = "123e4567-e89b-12d3-a456-426614174000";
  const queue = [
    { userId, session:session("q-1", "one") },
    { userId, session:session("q-2", "two") }
  ];
  const next = enqueueSyncItem(queue, session("q-1", "updated"), userId);
  assert.deepEqual(next, [
    { userId, session:session("q-2", "two") },
    { userId, session:session("q-1", "updated") }
  ]);
  assert.deepEqual(queue, [
    { userId, session:session("q-1", "one") },
    { userId, session:session("q-2", "two") }
  ]);
});

test("remove deletes only the requested session", () => {
  const queue = [
    { userId:null, session:session("q-1") },
    { userId:null, session:session("q-2") },
    { userId:null, session:session("q-3") }
  ];
  assert.deepEqual(removeSyncItem(queue, "q-2"), [
    { userId:null, session:session("q-1") },
    { userId:null, session:session("q-3") }
  ]);
  assert.deepEqual(removeSyncItem(queue, "missing"), queue);
});

test("invalid owner ids are treated as unowned and cannot be adopted implicitly", () => {
  const queue = enqueueSyncItem([], session("q-1"), "not-a-user-id");
  assert.deepEqual(queue, [{ userId:null, session:session("q-1") }]);
});

test("legacy raw sessions remain preserved as unowned queue entries", () => {
  assert.deepEqual(
    normalizeSyncQueue([session("legacy-1")]),
    [{ userId:null, session:session("legacy-1") }]
  );
});
