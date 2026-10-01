import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MemoryRepository } from "../src/memory-repository.js";
import { createApi } from "../src/server.js";
import { hashRefreshToken } from "../src/auth.js";

async function makeServer() {
  const repo = new MemoryRepository();
  const server = createServer(createApi({ repo, jwtSecret:"test-secret-that-is-at-least-32-characters-long", corsOrigin:"*" }));
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { repo, server, base:`http://127.0.0.1:${port}` };
}

async function request(base, path, options={}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { "content-type":"application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw:text }; }
  }
  return { status:response.status, body, headers:response.headers };
}

test("registers, authenticates, and reads the current user", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"athlete@example.com",password:"correct horse battery staple"})
  });
  assert.equal(registered.status, 201);
  assert.match(registered.body.accessToken, /^.+\..+\..+$/);

  const me = await request(testServer.base, "/v1/me", {
    headers:{authorization:`Bearer ${registered.body.accessToken}`}
  });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "athlete@example.com");
});

test("exposes liveness and readiness separately", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const health = await request(testServer.base, "/v1/health");
  const ready = await request(testServer.base, "/v1/ready");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.ok(health.headers.get("x-request-id"));
  assert.equal(health.headers.get("x-frame-options"), "DENY");
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(ready.status, 200);
  assert.equal(ready.body.ready, true);
});

test("rejects malformed date-time input with a client error", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"dates@example.com",password:"correct horse battery staple"})
  });
  const response = await request(testServer.base, "/v1/sessions", {
    method:"POST",
    headers:{authorization:`Bearer ${registered.body.accessToken}`,"idempotency-key":"dates-invalid-123456"},
    body:JSON.stringify({id:"123e4567-e89b-12d3-a456-426614174100",startedAt:"not-a-date",source:"manual",name:"Broken",exercises:[]})
  });
  assert.equal(response.status, 400);
});

test("rejects weak passwords", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const response = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"athlete@example.com",password:"too-short"})
  });
  assert.equal(response.status, 400);
});

test("rate-limits repeated invalid logins", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"ratelimit@example.com",password:"correct horse battery staple"})
  });
  let response;
  for (let i=0; i<6; i += 1) {
    response = await request(testServer.base, "/v1/auth/login", {
      method:"POST", body:JSON.stringify({email:"ratelimit@example.com",password:"incorrect password 123"})
    });
  }
  assert.equal(response.status, 429);
  assert.ok(response.body.error.details.retryAfter > 0);
});

test("persists a session and returns the same result for the same idempotency key", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"athlete@example.com",password:"correct horse battery staple"})
  });
  const token=registered.body.accessToken;
  const session={
    id:"123e4567-e89b-12d3-a456-426614174000",
    startedAt:"2026-10-01T12:00:00.000Z",
    completedAt:"2026-10-01T12:05:00.000Z",
    source:"manual",
    name:"Upper Strength",
    exercises:[{exerciseId:"bench",sets:[{index:1,reps:8,weightKg:70,completed:true,completedAt:"2026-10-01T12:05:00.000Z",rpe:8}]}]
  };

  const first=await request(testServer.base,"/v1/sessions",{
    method:"POST",headers:{authorization:`Bearer ${token}`,"idempotency-key":"session-write-123456"},
    body:JSON.stringify(session)
  });
  const second=await request(testServer.base,"/v1/sessions",{
    method:"POST",headers:{authorization:`Bearer ${token}`,"idempotency-key":"session-write-123456"},
    body:JSON.stringify(session)
  });
  assert.equal(first.status,201);
  assert.equal(second.status,200);
  const list=await request(testServer.base,"/v1/sessions",{headers:{authorization:`Bearer ${token}`}});
  assert.equal(list.status,200);
  assert.equal(list.body.sessions.length,1);
  assert.equal(Number(list.body.sessions[0].volume),560);
  assert.equal(list.body.sessions[0].completed_at, "2026-10-01T12:05:00.000Z");
});

test("rejects reusing an idempotency key with a different payload", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"conflict@example.com",password:"correct horse battery staple"})
  });
  const token = registered.body.accessToken;
  const base = {
    id:"123e4567-e89b-12d3-a456-426614174002",
    startedAt:"2026-10-01T13:00:00Z",
    completedAt:"2026-10-01T13:05:00Z",
    source:"manual",
    name:"Conflict Test",
    exercises:[{exerciseId:"bench",sets:[{index:1,reps:8,weightKg:70,completed:true,completedAt:"2026-10-01T13:05:00Z",rpe:8}]}]
  };
  const first=await request(testServer.base,"/v1/sessions",{
    method:"POST",headers:{authorization:`Bearer ${token}`,"idempotency-key":"conflict-write-123456"},
    body:JSON.stringify(base)
  });
  const changed={...base,name:"Changed Payload"};
  const second=await request(testServer.base,"/v1/sessions",{
    method:"POST",headers:{authorization:`Bearer ${token}`,"idempotency-key":"conflict-write-123456"},
    body:JSON.stringify(changed)
  });
  assert.equal(first.status,201);
  assert.equal(second.status,409);
  assert.match(second.body.error.message, /different request payload/);
});

test("rejects chronologically impossible timestamps", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"chronology@example.com",password:"correct horse battery staple"})
  });
  const response = await request(testServer.base, "/v1/sessions", {
    method:"POST",
    headers:{authorization:`Bearer ${registered.body.accessToken}`,"idempotency-key":"chronology-123456789"},
    body:JSON.stringify({
      id:"123e4567-e89b-12d3-a456-426614174006",
      startedAt:"2026-10-01T14:00:00Z",
      completedAt:"2026-10-01T13:59:00Z",
      source:"manual",
      name:"Impossible Time",
      exercises:[]
    })
  });
  assert.equal(response.status,400);
});

test("requires timestamps to match set completion state", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"set-state@example.com",password:"correct horse battery staple"})
  });
  const response = await request(testServer.base, "/v1/sessions", {
    method:"POST",
    headers:{authorization:`Bearer ${registered.body.accessToken}`,"idempotency-key":"set-state-123456789"},
    body:JSON.stringify({
      id:"123e4567-e89b-12d3-a456-426614174003",
      startedAt:"2026-10-01T14:00:00Z",
      source:"manual",
      name:"Invalid Set State",
      exercises:[{exerciseId:"bench",sets:[{index:1,reps:8,weightKg:70,completed:true,completedAt:null,rpe:8}]}]
    })
  });
  assert.equal(response.status,400);
});

test("makes movement-event writes idempotent and rejects payload conflicts", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"movement@example.com",password:"correct horse battery staple"})
  });
  const token=registered.body.accessToken;
  const session={id:"123e4567-e89b-12d3-a456-426614174005",startedAt:"2026-10-01T15:00:00Z",source:"manual",name:"Movement",exercises:[]};
  await request(testServer.base,"/v1/sessions",{
    method:"POST",headers:{authorization:`Bearer ${token}`,"idempotency-key":"movement-session-123456"},
    body:JSON.stringify(session)
  });
  const event={schemaVersion:1,sessionId:session.id,exerciseId:"bench",timestamp:"2026-10-01T15:01:00Z",source:"camera",reps:8,confidence:.92,model:"pose-v0",metrics:{rom:.81}};
  const first=await request(testServer.base,"/v1/movement-events",{
    method:"POST",headers:{authorization:`Bearer ${token}`,"idempotency-key":"movement-event-123456"},
    body:JSON.stringify(event)
  });
  const second=await request(testServer.base,"/v1/movement-events",{
    method:"POST",headers:{authorization:`Bearer ${token}`,"idempotency-key":"movement-event-123456"},
    body:JSON.stringify(event)
  });
  const changed=await request(testServer.base,"/v1/movement-events",{
    method:"POST",headers:{authorization:`Bearer ${token}`,"idempotency-key":"movement-event-123456"},
    body:JSON.stringify({...event,reps:9})
  });
  assert.equal(first.status,201);
  assert.equal(first.body.event.reps,8);
  assert.equal(second.status,200);
  assert.equal(second.body.event.id,first.body.event.id);
  assert.equal(second.body.event.reps,8);
  assert.equal(changed.status,409);
});

test("blocks movement events for another user’s session", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const a=await request(testServer.base,"/v1/auth/register",{method:"POST",body:JSON.stringify({email:"a@example.com",password:"correct horse battery staple"})});
  const b=await request(testServer.base,"/v1/auth/register",{method:"POST",body:JSON.stringify({email:"b@example.com",password:"correct horse battery staple"})});
  const session={id:"123e4567-e89b-12d3-a456-426614174001",startedAt:"2026-10-01T12:00:00Z",source:"manual",name:"Test",exercises:[]};
  await request(testServer.base,"/v1/sessions",{method:"POST",headers:{authorization:`Bearer ${a.body.accessToken}`,"idempotency-key":"session-write-abcdef"},body:JSON.stringify(session)});
  const response=await request(testServer.base,"/v1/movement-events",{method:"POST",headers:{authorization:`Bearer ${b.body.accessToken}`,"idempotency-key":"movement-owner-123456"},body:JSON.stringify({schemaVersion:1,sessionId:session.id,exerciseId:"bench",timestamp:"2026-10-01T12:00:00Z",source:"camera",reps:8,confidence:.92,model:"pose-v0",metrics:{rom:.81}})});
  assert.equal(response.status,404);
});
test("paginates session history with a stable cursor", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"pagination@example.com",password:"correct horse battery staple"})
  });
  const token = registered.body.accessToken;

  for (let i = 0; i < 55; i += 1) {
    await request(testServer.base, "/v1/sessions", {
      method:"POST",
      headers:{
        authorization:`Bearer ${token}`,
        "idempotency-key":`pagination-write-${String(i).padStart(4,"0")}`
      },
      body:JSON.stringify({
        id:`123e4567-e89b-12d3-a456-${String(426614174100 + i)}`,
        startedAt:`2026-10-01T10:${String(i).padStart(2,"0")}:00.000Z`,
        source:"manual",
        name:"Page " + i,
        exercises:[]
      })
    });
  }

  const first = await request(testServer.base, "/v1/sessions?limit=50", {
    headers:{authorization:`Bearer ${token}`}
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.sessions.length, 50);
  assert.equal(typeof first.body.nextCursor, "string");

  const second = await request(
    testServer.base,
    "/v1/sessions?limit=50&before=" + encodeURIComponent(first.body.nextCursor),
    { headers:{authorization:`Bearer ${token}`} }
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.sessions.length, 5);
  assert.equal(second.body.nextCursor, null);

  const firstIds = new Set(first.body.sessions.map((s) => s.id));
  assert.ok(second.body.sessions.every((s) => !firstIds.has(s.id)));
});

test("rejects malformed pagination cursors and limits", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"badcursor@example.com",password:"correct horse battery staple"})
  });
  const token = registered.body.accessToken;

  const badCursor = await request(testServer.base, "/v1/sessions?limit=20&before=not-a-real-cursor", {
    headers:{authorization:`Bearer ${token}`}
  });
  const badLimit = await request(testServer.base, "/v1/sessions?limit=0", {
    headers:{authorization:`Bearer ${token}`}
  });
  assert.equal(badCursor.status, 400);
  assert.equal(badLimit.status, 400);
});
test("rejects reusing a session id under a different idempotency key", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"sessionid@example.com",password:"correct horse battery staple"})
  });
  const token = registered.body.accessToken;
  const session = {
    id:"123e4567-e89b-12d3-a456-426614174099",
    startedAt:"2026-10-01T16:00:00Z",
    completedAt:null,
    source:"manual",
    name:"Stable ID",
    exercises:[]
  };
  const first = await request(testServer.base, "/v1/sessions", {
    method:"POST",
    headers:{authorization:`Bearer ${token}`,"idempotency-key":"session-id-first-123456"},
    body:JSON.stringify(session)
  });
  const second = await request(testServer.base, "/v1/sessions", {
    method:"POST",
    headers:{authorization:`Bearer ${token}`,"idempotency-key":"session-id-second-123456"},
    body:JSON.stringify(session)
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
});
test("does not reveal movement events through another user’s replay key", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const a = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"event-owner@example.com",password:"correct horse battery staple"})
  });
  const b = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"event-other@example.com",password:"correct horse battery staple"})
  });
  const session = {
    id:"123e4567-e89b-12d3-a456-426614174098",
    startedAt:"2026-10-01T17:00:00Z",
    source:"manual",
    name:"Movement Owner",
    exercises:[]
  };
  await request(testServer.base, "/v1/sessions", {
    method:"POST",
    headers:{authorization:`Bearer ${a.body.accessToken}`,"idempotency-key":"movement-owner-session-123456"},
    body:JSON.stringify(session)
  });
  const event = {
    schemaVersion:1,
    sessionId:session.id,
    exerciseId:"bench",
    timestamp:"2026-10-01T17:01:00Z",
    source:"camera",
    reps:8,
    confidence:.92,
    model:"pose-v0",
    metrics:{rom:.81}
  };
  const ownerWrite = await request(testServer.base, "/v1/movement-events", {
    method:"POST",
    headers:{
      authorization:`Bearer ${a.body.accessToken}`,
      "idempotency-key":"movement-replay-shared-123456"
    },
    body:JSON.stringify(event)
  });
  const otherReplay = await request(testServer.base, "/v1/movement-events", {
    method:"POST",
    headers:{
      authorization:`Bearer ${b.body.accessToken}`,
      "idempotency-key":"movement-replay-shared-123456"
    },
    body:JSON.stringify(event)
  });
  assert.equal(ownerWrite.status,201);
  assert.equal(otherReplay.status,404);
});
function cookieFrom(response) {
  return response.headers.get("set-cookie") || "";
}

function refreshCookieValue(response) {
  const cookie = cookieFrom(response);
  const match = cookie.match(/^gym_refresh=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

test("issues a refresh cookie and rotates it without exposing raw refresh tokens", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());

  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST",
    body:JSON.stringify({email:"refresh@example.com",password:"correct horse battery staple"})
  });
  const oldRefresh = refreshCookieValue(registered);
  assert.ok(oldRefresh);
  assert.match(cookieFrom(registered), /HttpOnly/);
  assert.match(cookieFrom(registered), /SameSite=Lax/);

  const decodedPayload = JSON.parse(Buffer.from(registered.body.accessToken.split(".")[1], "base64url").toString("utf8"));
  assert.equal(typeof decodedPayload.sid, "string");

  const rotated = await request(testServer.base, "/v1/auth/refresh", {
    method:"POST",
    headers:{cookie:`gym_refresh=${encodeURIComponent(oldRefresh)}`}
  });
  assert.equal(rotated.status,200);
  assert.notEqual(refreshCookieValue(rotated), oldRefresh);
  assert.equal(typeof rotated.body.accessToken, "string");
  const firstSession = [...testServer.repo.authSessions.values()].find((session) => session.token_hash === hashRefreshToken(oldRefresh));
  const rotatedSessionId = JSON.parse(Buffer.from(rotated.body.accessToken.split(".")[1], "base64url").toString("utf8")).sid;
  const rotatedSession = testServer.repo.authSessions.get(rotatedSessionId);
  assert.ok(firstSession);
  assert.ok(rotatedSession);
  assert.equal(rotatedSession.expires_at, firstSession.expires_at);

  const reused = await request(testServer.base, "/v1/auth/refresh", {
    method:"POST",
    headers:{cookie:`gym_refresh=${encodeURIComponent(oldRefresh)}`}
  });
  assert.equal(reused.status,401);

  const newest = refreshCookieValue(rotated);
  const familyReuse = await request(testServer.base, "/v1/auth/refresh", {
    method:"POST",
    headers:{cookie:`gym_refresh=${encodeURIComponent(newest)}`}
  });
  assert.equal(familyReuse.status,401);
});

test("logout immediately revokes the access session", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST",
    body:JSON.stringify({email:"logout@example.com",password:"correct horse battery staple"})
  });
  const refresh = refreshCookieValue(registered);
  const logout = await request(testServer.base, "/v1/auth/logout", {
    method:"POST",
    headers:{cookie:`gym_refresh=${encodeURIComponent(refresh)}`}
  });
  assert.equal(logout.status,204);

  const me = await request(testServer.base, "/v1/me", {
    headers:{authorization:`Bearer ${registered.body.accessToken}`}
  });
  assert.equal(me.status,401);
});

test("logout-all revokes every session family and clears the refresh cookie", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const first = await request(testServer.base, "/v1/auth/register", {
    method:"POST",
    body:JSON.stringify({email:"multi@example.com",password:"correct horse battery staple"})
  });
  const second = await request(testServer.base, "/v1/auth/login", {
    method:"POST",
    body:JSON.stringify({email:"multi@example.com",password:"correct horse battery staple"})
  });

  const logoutAll = await request(testServer.base, "/v1/auth/logout-all", {
    method:"POST",
    headers:{authorization:`Bearer ${first.body.accessToken}`}
  });
  assert.equal(logoutAll.status,200);
  assert.equal(logoutAll.body.revoked,2);
  assert.match(cookieFrom(logoutAll), /Max-Age=0/);

  const firstMe = await request(testServer.base, "/v1/me", {
    headers:{authorization:`Bearer ${first.body.accessToken}`}
  });
  const secondMe = await request(testServer.base, "/v1/me", {
    headers:{authorization:`Bearer ${second.body.accessToken}`}
  });
  assert.equal(firstMe.status,401);
  assert.equal(secondMe.status,401);
});

test("disabled accounts cannot use existing access or refresh sessions", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST",
    body:JSON.stringify({email:"disabled@example.com",password:"correct horse battery staple"})
  });
  const refresh = refreshCookieValue(registered);
  const userId = JSON.parse(Buffer.from(registered.body.accessToken.split(".")[1], "base64url").toString("utf8")).sub;
  const user = testServer.repo.users.get(userId);
  user.status = "suspended";

  const me = await request(testServer.base, "/v1/me", {
    headers:{authorization:`Bearer ${registered.body.accessToken}`}
  });
  const refreshResult = await request(testServer.base, "/v1/auth/refresh", {
    method:"POST",
    headers:{cookie:`gym_refresh=${encodeURIComponent(refresh)}`}
  });
  assert.equal(me.status,401);
  assert.equal(refreshResult.status,401);
});

test("lists and revokes only the requesting user's sessions", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const a = await request(testServer.base, "/v1/auth/register", {
    method:"POST",
    body:JSON.stringify({email:"sessions-a@example.com",password:"correct horse battery staple"})
  });
  const b = await request(testServer.base, "/v1/auth/register", {
    method:"POST",
    body:JSON.stringify({email:"sessions-b@example.com",password:"correct horse battery staple"})
  });

  const listA = await request(testServer.base, "/v1/auth/sessions", {
    headers:{authorization:`Bearer ${a.body.accessToken}`}
  });
  assert.equal(listA.status,200);
  assert.equal(listA.body.sessions.length,1);

  const foreignDelete = await request(testServer.base, "/v1/auth/sessions/" + listA.body.sessions[0].id, {
    method:"DELETE",
    headers:{authorization:`Bearer ${b.body.accessToken}`}
  });
  assert.equal(foreignDelete.status,404);

  const ownDelete = await request(testServer.base, "/v1/auth/sessions/" + listA.body.sessions[0].id, {
    method:"DELETE",
    headers:{authorization:`Bearer ${a.body.accessToken}`}
  });
  assert.equal(ownDelete.status,200);

  const me = await request(testServer.base, "/v1/me", {
    headers:{authorization:`Bearer ${a.body.accessToken}`}
  });
  assert.equal(me.status,401);
});
test("password reset requests do not enumerate accounts and reset tokens are one-time", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());

  const known = await request(testServer.base, "/v1/auth/register", {
    method:"POST",
    body:JSON.stringify({email:"recover@example.com",password:"correct horse battery staple"})
  });
  assert.equal(known.status,201);

  const knownRequest = await request(testServer.base, "/v1/auth/password-reset/request", {
    method:"POST",
    body:JSON.stringify({email:"recover@example.com"})
  });
  const unknownRequest = await request(testServer.base, "/v1/auth/password-reset/request", {
    method:"POST",
    body:JSON.stringify({email:"missing@example.com"})
  });
  assert.equal(knownRequest.status,202);
  assert.equal(unknownRequest.status,202);
  assert.deepEqual(
    { accepted:knownRequest.body.accepted },
    { accepted:unknownRequest.body.accepted }
  );

  const rawToken = "development-reset-token-123456789012345678901234567890";
  await testServer.repo.createPasswordResetToken({
    id:"123e4567-e89b-12d3-a456-426614174010",
    userId:JSON.parse(Buffer.from(known.body.accessToken.split(".")[1],"base64url").toString("utf8")).sub,
    tokenHash:hashRefreshToken(rawToken),
    expiresAt:new Date(Date.now() + 30 * 60 * 1000)
  });

  const reset = await request(testServer.base, "/v1/auth/password-reset/confirm", {
    method:"POST",
    body:JSON.stringify({token:rawToken,password:"a-new-correct-password-123"})
  });
  assert.equal(reset.status,200);

  const reuse = await request(testServer.base, "/v1/auth/password-reset/confirm", {
    method:"POST",
    body:JSON.stringify({token:rawToken,password:"another-new-password-123"})
  });
  assert.equal(reuse.status,400);

  const oldAccess = await request(testServer.base, "/v1/me", {
    headers:{authorization:`Bearer ${known.body.accessToken}`}
  });
  assert.equal(oldAccess.status,401);
});

test("account deletion requires password confirmation and removes the account", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());

  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST",
    body:JSON.stringify({email:"delete@example.com",password:"correct horse battery staple"})
  });
  const bad = await request(testServer.base, "/v1/auth/delete-account", {
    method:"POST",
    headers:{authorization:`Bearer ${registered.body.accessToken}`},
    body:JSON.stringify({password:"wrong-password-123"})
  });
  assert.equal(bad.status,401);

  const deleted = await request(testServer.base, "/v1/auth/delete-account", {
    method:"POST",
    headers:{authorization:`Bearer ${registered.body.accessToken}`},
    body:JSON.stringify({password:"correct horse battery staple"})
  });
  assert.equal(deleted.status,200);
  assert.equal(deleted.body.deleted,true);
  assert.equal(testServer.repo.accountDeletionAudit.length,1);

  const me = await request(testServer.base, "/v1/me", {
    headers:{authorization:`Bearer ${registered.body.accessToken}`}
  });
  assert.equal(me.status,401);

  const login = await request(testServer.base, "/v1/auth/login", {
    method:"POST",
    body:JSON.stringify({email:"delete@example.com",password:"correct horse battery staple"})
  });
  assert.equal(login.status,401);
});
test("logout revokes the access session even when the refresh cookie is unavailable", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());

  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST",
    body:JSON.stringify({email:"logout-no-cookie@example.com",password:"correct horse battery staple"})
  });

  const logout = await request(testServer.base, "/v1/auth/logout", {
    method:"POST",
    headers:{authorization:`Bearer ${registered.body.accessToken}`}
  });
  assert.equal(logout.status,204);

  const me = await request(testServer.base, "/v1/me", {
    headers:{authorization:`Bearer ${registered.body.accessToken}`}
  });
  assert.equal(me.status,401);
});

test("revoking the current device session clears the refresh cookie and invalidates the access token", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());

  const registered = await request(testServer.base, "/v1/auth/register", {
    method:"POST",
    body:JSON.stringify({email:"revoke-current@example.com",password:"correct horse battery staple"})
  });
  const currentSessionId = JSON.parse(Buffer.from(registered.body.accessToken.split(".")[1], "base64url").toString("utf8")).sid;

  const revoked = await request(testServer.base, "/v1/auth/sessions/" + currentSessionId, {
    method:"DELETE",
    headers:{authorization:`Bearer ${registered.body.accessToken}`}
  });
  assert.equal(revoked.status,200);
  assert.equal(revoked.body.current,true);
  assert.match(cookieFrom(revoked), /Max-Age=0/);

  const me = await request(testServer.base, "/v1/me", {
    headers:{authorization:`Bearer ${registered.body.accessToken}`}
  });
  assert.equal(me.status,401);
});

test("session management marks the current session and exposes revocation state", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());

  const first = await request(testServer.base, "/v1/auth/register", {
    method:"POST",
    body:JSON.stringify({email:"session-state@example.com",password:"correct horse battery staple"})
  });
  const second = await request(testServer.base, "/v1/auth/login", {
    method:"POST",
    body:JSON.stringify({email:"session-state@example.com",password:"correct horse battery staple"})
  });

  const list = await request(testServer.base, "/v1/auth/sessions", {
    headers:{authorization:`Bearer ${first.body.accessToken}`}
  });
  assert.equal(list.status,200);
  assert.equal(list.body.sessions.length,2);
  assert.equal(list.body.sessions.filter((session) => session.isCurrent).length,1);
  assert.equal(list.body.sessions.filter((session) => !session.revoked_at).length,2);
  assert.notEqual(second.body.accessToken, first.body.accessToken);
});
