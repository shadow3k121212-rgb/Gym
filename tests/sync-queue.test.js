import test from "node:test";
import assert from "node:assert/strict";
import { enqueueSyncItem, normalizeSyncQueue, removeSyncItem } from "../src/sync-queue.js";

const session = (id, name = id) => ({ id, name });

test("normalizes queue entries, preserves all durable work, and deduplicates by session id", () => {
  const input = [
    session("q-1", "first"),
    null,
    session("q-2", "second"),
    session("q-1", "latest"),
    { id: 123 },
    session("q-25", "twenty-five")
  ];
  const normalized = normalizeSyncQueue(input);
  assert.deepEqual(normalized, [
    session("q-1", "latest"),
    session("q-2", "second"),
    session("q-25", "twenty-five")
  ]);

  const many = normalizeSyncQueue(Array.from({ length: 25 }, (_, i) => session("q-" + i)));
  assert.equal(many.length, 25);
});

test("enqueue replaces the same session without reordering unrelated work", () => {
  const queue = [session("q-1", "one"), session("q-2", "two")];
  const next = enqueueSyncItem(queue, session("q-1", "updated"));
  assert.deepEqual(next, [session("q-2", "two"), session("q-1", "updated")]);
  assert.deepEqual(queue, [session("q-1", "one"), session("q-2", "two")]);
});

test("remove deletes only the requested session", () => {
  const queue = [session("q-1"), session("q-2"), session("q-3")];
  assert.deepEqual(removeSyncItem(queue, "q-2"), [session("q-1"), session("q-3")]);
  assert.deepEqual(removeSyncItem(queue, "missing"), queue);
});

test("invalid enqueue and removal inputs are safe no-ops", () => {
  const queue = [session("q-1")];
  assert.deepEqual(enqueueSyncItem(queue, null), queue);
  assert.deepEqual(enqueueSyncItem(queue, { id: "" }), queue);
  assert.deepEqual(removeSyncItem(queue, ""), queue);
});
