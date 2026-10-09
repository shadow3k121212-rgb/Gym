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
test("refreshes the access session once after a protected 401 and retries the request", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorageDescriptor = installStorage(new Map());
  const originalConfig = globalThis.__GYM_CONFIG__;
  globalThis.__GYM_CONFIG__ = { apiBaseUrl:"https://api.example.test" };
  let calls = 0;
  const responses = [
    new Response(JSON.stringify({ error:{ message:"Authentication required." } }), {
      status:401,
      headers:{ "content-type":"application/json" }
    }),
    new Response(JSON.stringify({
      user:{ id:"123e4567-e89b-12d3-a456-426614174000" },
      accessToken:"refreshed-token"
    }), {
      status:200,
      headers:{ "content-type":"application/json" }
    }),
    new Response(JSON.stringify({ sessions:[], nextCursor:null }), {
      status:200,
      headers:{ "content-type":"application/json" }
    })
  ];
  globalThis.fetch = async () => responses[calls++];

  try {
    const module = await import("../src/api.js?auto-refresh-test=" + Date.now());
    module.setAuthSession("expired-token", "123e4567-e89b-12d3-a456-426614174000");
    const result = await module.listCloudSessions(20);
    assert.equal(result.ok, true);
    assert.equal(calls, 3);
    assert.equal(module.hasAuth(), true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage(originalStorageDescriptor);
    globalThis.__GYM_CONFIG__ = originalConfig;
  }
});
test("deduplicates concurrent access-session refreshes", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorageDescriptor = installStorage(new Map());
  const originalConfig = globalThis.__GYM_CONFIG__;
  globalThis.__GYM_CONFIG__ = { apiBaseUrl:"https://api.example.test" };

  let refreshCalls = 0;
  let protectedCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/v1/auth/refresh")) {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(JSON.stringify({
        user:{ id:"123e4567-e89b-12d3-a456-426614174000" },
        accessToken:"refreshed-token"
      }), { status:200, headers:{ "content-type":"application/json" } });
    }
    protectedCalls += 1;
    if (protectedCalls <= 2) {
      return new Response(JSON.stringify({ error:{ message:"Authentication required." } }), {
        status:401,
        headers:{ "content-type":"application/json" }
      });
    }
    return new Response(JSON.stringify({ sessions:[], nextCursor:null }), {
      status:200,
      headers:{ "content-type":"application/json" }
    });
  };

  try {
    const module = await import("../src/api.js?concurrent-refresh-test=" + Date.now());
    module.setAuthSession("expired-token", "123e4567-e89b-12d3-a456-426614174000");
    const [first, second] = await Promise.all([
      module.listCloudSessions(20),
      module.listCloudSessions(20)
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(refreshCalls, 1);
    assert.equal(protectedCalls, 4);
    assert.equal(module.hasAuth(), true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage(originalStorageDescriptor);
    globalThis.__GYM_CONFIG__ = originalConfig;
  }
});

test("uses credentialed cookie transport instead of browser token storage", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorageDescriptor = installStorage(new Map());
  const originalConfig = globalThis.__GYM_CONFIG__;
  globalThis.__GYM_CONFIG__ = { apiBaseUrl:"https://api.example.test" };
  let seen = null;
  globalThis.fetch = async (_url, options) => {
    seen = options;
    return new Response(JSON.stringify({ sessions:[], nextCursor:null }), {
      status:200,
      headers:{ "content-type":"application/json" }
    });
  };

  try {
    const module = await import("../src/api.js?cookie-transport-test=" + Date.now());
    module.setAuthSession("short-lived-access-token", "123e4567-e89b-12d3-a456-426614174000");
    const result = await module.listCloudSessions(20);
    assert.equal(result.ok,true);
    assert.equal(seen.credentials,"include");
    assert.match(seen.headers.authorization,/^Bearer /);
    assert.equal(globalThis.sessionStorage.getItem("gym:access-token"),null);
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage(originalStorageDescriptor);
    globalThis.__GYM_CONFIG__ = originalConfig;
  }
});

test("uses authenticated tenant APIs with pagination and safe invitation methods", async () => {
  const originalFetch=globalThis.fetch;
  const originalStorageDescriptor=installStorage(new Map());
  const originalConfig=globalThis.__GYM_CONFIG__;
  globalThis.__GYM_CONFIG__={apiBaseUrl:"https://api.example.test"};
  const calls=[];
  globalThis.fetch=async (url,options={})=>{
    calls.push({url:String(url),options});
    let body={};
    if(String(url).includes("/members?")) body={members:[],nextCursor:null};
    else if(String(url).includes("/invitations?")) body={invitations:[],nextCursor:null};
    else if(String(url).endsWith("/tenant-invitations/accept")) body={tenant:{id:"t-1",role:"member"}};
    else if(options.method==="POST"&&String(url).endsWith("/invitations")) body={invitation:{id:"i-1"},developmentToken:"dev-token"};
    else if(options.method==="DELETE") body={invitation:{id:"i-1",status:"revoked"}};
    else if(options.method==="POST"&&String(url).endsWith("/v1/tenants")) body={tenant:{id:"t-1"}};
    else body={tenants:[]};
    return new Response(JSON.stringify(body),{status:options.method==="POST"&&String(url).endsWith("/v1/tenants")?201:200,headers:{"content-type":"application/json"}});
  };
  try {
    const module=await import("../src/api.js?tenant-wrapper-test="+Date.now());
    module.setAuthSession("tenant-access-token","123e4567-e89b-12d3-a456-426614174000");
    const tenantId="123e4567-e89b-12d3-a456-426614174010";
    const [tenants,members,invitations,created,issued,revoked,accepted]=await Promise.all([
      module.listTenants(),
      module.listTenantMembers(tenantId,50,"member.cursor"),
      module.listTenantInvitations(tenantId,25,"invite.cursor"),
      module.createTenant("Central Fitness","central-fitness"),
      module.createTenantInvitation(tenantId,"coach@example.com","coach"),
      module.revokeTenantInvitation(tenantId,"123e4567-e89b-12d3-a456-426614174099"),
      module.acceptTenantInvitation("opaque-invitation-token")
    ]);
    assert.equal(tenants.ok,true);
    assert.equal(members.ok,true);
    assert.equal(invitations.ok,true);
    assert.equal(created.ok,true);
    assert.equal(issued.ok,true);
    assert.equal(revoked.ok,true);
    assert.equal(accepted.ok,true);
    assert.match(calls.find(x=>x.url.includes("/members?")).url,/limit=50/);
    assert.match(calls.find(x=>x.url.includes("/members?")).url,/before=member.cursor/);
    assert.equal(calls.find(x=>x.url.endsWith("/invitations")&&x.options.method==="POST").options.method,"POST");
    const deleteCall=calls.find(x=>x.options.method==="DELETE" && new URL(x.url).pathname.includes("/invitations/"));
    assert.equal(deleteCall?.options.method,"DELETE");
    assert.equal(calls.find(x=>x.url.endsWith("/tenant-invitations/accept")).options.credentials,"include");
    for(const {options} of calls){
      assert.equal(options.credentials,"include");
      assert.match(options.headers.authorization,/^Bearer tenant-access-token$/);
    }
    const inviteCall=calls.find(x=>x.url.endsWith("/invitations")&&x.options.method==="POST");
    assert.deepEqual(JSON.parse(inviteCall.options.body),{email:"coach@example.com",role:"coach"});
    const acceptedCall=calls.find(x=>x.url.endsWith("/tenant-invitations/accept"));
    assert.deepEqual(JSON.parse(acceptedCall.options.body),{token:"opaque-invitation-token"});
  } finally {
    globalThis.fetch=originalFetch;
    restoreStorage(originalStorageDescriptor);
    globalThis.__GYM_CONFIG__=originalConfig;
  }
});
