import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MemoryRepository } from "../src/memory-repository.js";
import { createApi } from "../src/server.js";

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
  return { status:response.status, body:await response.json(), headers:response.headers };
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
  assert.equal(second.status,200);
  assert.equal(second.body.event.id,first.body.event.id);
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
