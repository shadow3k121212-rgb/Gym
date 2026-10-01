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
  return { status:response.status, body:await response.json() };
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

test("rejects weak passwords", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const response = await request(testServer.base, "/v1/auth/register", {
    method:"POST", body:JSON.stringify({email:"athlete@example.com",password:"too-short"})
  });
  assert.equal(response.status, 400);
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
});

test("blocks movement events for another user’s session", async (t) => {
  const testServer = await makeServer();
  t.after(() => testServer.server.close());
  const a=await request(testServer.base,"/v1/auth/register",{method:"POST",body:JSON.stringify({email:"a@example.com",password:"correct horse battery staple"})});
  const b=await request(testServer.base,"/v1/auth/register",{method:"POST",body:JSON.stringify({email:"b@example.com",password:"correct horse battery staple"})});
  const session={id:"123e4567-e89b-12d3-a456-426614174001",startedAt:"2026-10-01T12:00:00Z",source:"manual",name:"Test",exercises:[]};
  await request(testServer.base,"/v1/sessions",{method:"POST",headers:{authorization:`Bearer ${a.body.accessToken}`,"idempotency-key":"session-write-abcdef"},body:JSON.stringify(session)});
  const response=await request(testServer.base,"/v1/movement-events",{method:"POST",headers:{authorization:`Bearer ${b.body.accessToken}`},body:JSON.stringify({schemaVersion:1,sessionId:session.id,exerciseId:"bench",timestamp:"2026-10-01T12:00:00Z",source:"camera",reps:8,confidence:.92,model:"pose-v0",metrics:{rom:.81}})});
  assert.equal(response.status,404);
});
