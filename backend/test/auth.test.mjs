import test from "node:test";
import assert from "node:assert/strict";
import {
  createRefreshToken,
  getRefreshTtlSeconds,
  hashPassword,
  hashRefreshToken,
  issueAccessToken,
  refreshExpiry,
  verifyAccessToken,
  verifyPassword
} from "../src/auth.js";

const secret = "test-secret-that-is-at-least-32-characters-long";
const userId = "123e4567-e89b-12d3-a456-426614174000";
const sessionId = "123e4567-e89b-12d3-a456-426614174001";

test("password hashing verifies correctly and rejects wrong passwords", async () => {
  const credentials = await hashPassword("correct horse battery staple");
  assert.notEqual(credentials.hash, "correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", credentials.salt, credentials.hash), true);
  assert.equal(await verifyPassword("wrong password", credentials.salt, credentials.hash), false);
});

test("refresh tokens are high-entropy opaque values and hashed at rest", () => {
  const token = createRefreshToken();
  assert.equal(typeof token, "string");
  assert.ok(token.length >= 64);
  assert.notEqual(token, hashRefreshToken(token));
  assert.equal(hashRefreshToken(token), hashRefreshToken(token));
});

test("access tokens require and preserve a session binding", () => {
  const now = Date.parse("2026-10-01T18:00:00.000Z");
  const token = issueAccessToken(userId, secret, now, sessionId);
  const parsed = verifyAccessToken(token, secret, now + 60_000);
  assert.deepEqual(parsed, {
    userId,
    sessionId,
    issuedAt: Math.floor(now / 1000),
    expiresAt: Math.floor(now / 1000) + 900
  });

  const legacyToken = issueAccessToken(userId, secret, now);
  assert.equal(verifyAccessToken(legacyToken, secret, now + 60_000), null);
  assert.equal(verifyAccessToken(token, secret, now + 901_000), null);
});

test("refresh expiry is bounded to the configured lifecycle", () => {
  const now = Date.parse("2026-10-01T18:00:00.000Z");
  assert.equal(
    refreshExpiry(now).getTime(),
    now + getRefreshTtlSeconds() * 1000
  );
});
