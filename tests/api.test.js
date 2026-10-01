import test from "node:test";
import assert from "node:assert/strict";

test("marks HTTP 401 responses as authentication-required", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.sessionStorage;
  const originalConfig = globalThis.__GYM_CONFIG__;

  const values = new Map([["gym:access-token", "expired-token"]]);
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  globalThis.__GYM_CONFIG__ = { apiBaseUrl: "https://api.example.test" };
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Authentication required." } }), {
    status: 401,
    headers: { "content-type": "application/json" }
  });

  try {
    const module = await import("../src/api.js?test=" + Date.now());
    const result = await module.listCloudSessions(50);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.authRequired, true);
    assert.equal(result.message, "Authentication required.");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.sessionStorage = originalStorage;
    globalThis.__GYM_CONFIG__ = originalConfig;
  }
});
