import test from "node:test";
import assert from "node:assert/strict";

function installStorage(values) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    },
    configurable: true,
    writable: true
  });
  return descriptor;
}

function restoreStorage(descriptor) {
  if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
  else delete globalThis.sessionStorage;
}

test("marks HTTP 401 responses as authentication-required", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorageDescriptor = installStorage(new Map([
    ["gym:access-token", "expired-token"],
    ["gym:auth-user-id", "123e4567-e89b-12d3-a456-426614174000"]
  ]));
  const originalConfig = globalThis.__GYM_CONFIG__;

  globalThis.__GYM_CONFIG__ = { apiBaseUrl: "https://api.example.test" };
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Authentication required." } }), {
    status: 401,
    headers: { "content-type":"application/json" }
  });

  try {
    const module = await import("../src/api.js?auth-test=" + Date.now());
    module.setAuthSession("expired-token", "123e4567-e89b-12d3-a456-426614174000");
    const result = await module.listCloudSessions(50);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.authRequired, true);
    assert.equal(result.message, "Authentication required.");
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage(originalStorageDescriptor);
    globalThis.__GYM_CONFIG__ = originalConfig;
  }
});

test("passes the opaque cursor through cloud history pagination", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorageDescriptor = installStorage(new Map([
    ["gym:access-token", "token"],
    ["gym:auth-user-id", "123e4567-e89b-12d3-a456-426614174000"]
  ]));
  const originalConfig = globalThis.__GYM_CONFIG__;
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
    module.setAuthSession("token", "123e4567-e89b-12d3-a456-426614174000");
    const result = await module.listCloudSessions(100, "opaque.cursor");
    assert.equal(result.ok, true);
    assert.match(requestedUrl, /limit=100/);
    assert.match(requestedUrl, /before=opaque.cursor/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage(originalStorageDescriptor);
    globalThis.__GYM_CONFIG__ = originalConfig;
  }
});
test("treats a successful HTTP response without the synced session as malformed", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorageDescriptor = installStorage(new Map([
    ["gym:access-token", "token"],
    ["gym:auth-user-id", "123e4567-e89b-12d3-a456-426614174000"]
  ]));
  const originalConfig = globalThis.__GYM_CONFIG__;
  globalThis.__GYM_CONFIG__ = { apiBaseUrl: "https://api.example.test" };
  globalThis.fetch = async () => new Response(JSON.stringify({ ok:true }), {
    status:201,
    headers:{ "content-type":"application/json" }
  });

  try {
    const module = await import("../src/api.js?malformed-sync=" + Date.now());
    module.setAuthSession("token", "123e4567-e89b-12d3-a456-426614174000");
    const result = await module.syncSession({ id:"123e4567-e89b-12d3-a456-426614174001" });
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
    assert.equal(result.malformedResponse, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage(originalStorageDescriptor);
    globalThis.__GYM_CONFIG__ = originalConfig;
  }
});
test("stores the authenticated cloud user identity after login", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorageDescriptor = installStorage(new Map());
  const originalConfig = globalThis.__GYM_CONFIG__;
  globalThis.__GYM_CONFIG__ = { apiBaseUrl:"https://api.example.test" };
  globalThis.fetch = async () => new Response(JSON.stringify({
    user:{ id:"123e4567-e89b-12d3-a456-426614174000", email:"athlete@example.com" },
    accessToken:"header.payload.signature"
  }), {
    status:200,
    headers:{ "content-type":"application/json" }
  });

  try {
    const module = await import("../src/api.js?login-test=" + Date.now());
    const result = await module.login("athlete@example.com", "correct horse battery staple");
    assert.equal(result.ok, true);
    assert.equal(module.getCurrentUserId(), "123e4567-e89b-12d3-a456-426614174000");
    assert.equal(module.hasAuth(), true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage(originalStorageDescriptor);
    globalThis.__GYM_CONFIG__ = originalConfig;
  }
});
test("classifies retryable and permanent cloud failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorageDescriptor = installStorage(new Map([
    ["gym:access-token", "token"],
    ["gym:auth-user-id", "123e4567-e89b-12d3-a456-426614174000"]
  ]));
  const originalConfig = globalThis.__GYM_CONFIG__;
  globalThis.__GYM_CONFIG__ = { apiBaseUrl:"https://api.example.test" };
  let status = 503;
  globalThis.fetch = async () => new Response(JSON.stringify({ error:{ message:"failure" } }), {
    status,
    headers:{ "content-type":"application/json" }
  });

  try {
    const module = await import("../src/api.js?retry-test=" + Date.now());
    module.setAuthSession("token", "123e4567-e89b-12d3-a456-426614174000");
    const retryable = await module.listCloudSessions(50);
    assert.equal(retryable.retryable, true);
    status = 409;
    const permanent = await module.listCloudSessions(50);
    assert.equal(permanent.retryable, false);
    assert.equal(permanent.authRequired, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage(originalStorageDescriptor);
    globalThis.__GYM_CONFIG__ = originalConfig;
  }
});
test("classifies network failures as retryable", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorageDescriptor = installStorage(new Map([
    ["gym:access-token", "token"],
    ["gym:auth-user-id", "123e4567-e89b-12d3-a456-426614174000"]
  ]));
  const originalConfig = globalThis.__GYM_CONFIG__;
  globalThis.__GYM_CONFIG__ = { apiBaseUrl:"https://api.example.test" };
  globalThis.fetch = async () => {
    throw new TypeError("network offline");
  };

  try {
    const module = await import("../src/api.js?offline-test=" + Date.now());
    module.setAuthSession("token", "123e4567-e89b-12d3-a456-426614174000");
    const result = await module.listCloudSessions(50);
    assert.equal(result.ok, false);
    assert.equal(result.retryable, true);
    assert.equal(result.authRequired, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage(originalStorageDescriptor);
    globalThis.__GYM_CONFIG__ = originalConfig;
  }
});
