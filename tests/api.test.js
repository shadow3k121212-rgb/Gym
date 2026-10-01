import test from "node:test";
import assert from "node:assert/strict";

test("marks HTTP 401 responses as authentication-required", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.sessionStorage;
  const originalConfig = globalThis.__GYM_CONFIG__;

  const values = new Map([["gym:access-token", "expired-token"], ["gym:auth-user-id", "123e4567-e89b-12d3-a456-426614174000"]]);
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
test("passes the opaque cursor through cloud history pagination", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.sessionStorage;
  const originalConfig = globalThis.__GYM_CONFIG__;
  const values = new Map([
    ["gym:access-token", "token"],
    ["gym:auth-user-id", "123e4567-e89b-12d3-a456-426614174000"]
  ]);
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  globalThis.__GYM_CONFIG__ = { apiBaseUrl: "https://api.example.test" };
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ sessions:[], nextCursor:null }), {
      status:200,
      headers:{ "content-type":"application/json" }
    });
  };

  try {
    const module = await import("../src/api.js?pagination-test=" + Date.now());
    const result = await module.listCloudSessions(100, "opaque.cursor");
    assert.equal(result.ok, true);
    assert.match(requestedUrl, /limit=100/);
    assert.match(requestedUrl, /before=opaque.cursor/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.sessionStorage = originalStorage;
    globalThis.__GYM_CONFIG__ = originalConfig;
  }
});
