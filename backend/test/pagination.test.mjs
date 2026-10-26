import test from "node:test";
import assert from "node:assert/strict";
import { decodeSessionCursor, encodeSessionCursor, normalizePageLimit, PaginationError } from "../src/pagination.js";

test("round-trips stable session cursors", () => {
  const cursor = encodeSessionCursor({
    startedAt:new Date("2026-10-01T12:00:00.000Z"),
    id:"123e4567-e89b-12d3-a456-426614174000"
  });
  assert.deepEqual(decodeSessionCursor(cursor), {
    startedAt:"2026-10-01T12:00:00.000Z",
    id:"123e4567-e89b-12d3-a456-426614174000"
  });
});

test("rejects malformed cursors and out-of-range limits", () => {
  assert.throws(() => decodeSessionCursor("broken"), PaginationError);
  const malformed = Buffer.from(JSON.stringify({
    startedAt:"not-a-date",
    id:"not-a-uuid"
  })).toString("base64url");
  assert.throws(() => decodeSessionCursor(malformed), PaginationError);
  assert.equal(normalizePageLimit("50"), 50);
  assert.throws(() => normalizePageLimit("0"), PaginationError);
  assert.throws(() => normalizePageLimit("101", 20, 100), PaginationError);
});
