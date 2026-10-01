import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword, issueAccessToken, verifyAccessToken, extractBearerToken } from "./auth.js";
import { ValidationError, normalizeEmail, validatePassword, validateSession, validateMovementEvent } from "./validation.js";

const JSON_LIMIT = 256 * 1024;

async function readJson(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > JSON_LIMIT) throw Object.assign(new Error("Request body too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Malformed JSON."), { statusCode: 400 }); }
}

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    ...headers
  });
  res.end(JSON.stringify(body));
}

function requestId(req) {
  return req.headers["x-request-id"] || randomUUID();
}

function authLimit(map, key, now = Date.now()) {
  const item = map.get(key);
  if (!item || now >= item.resetAt) return { allowed: true };
  return item.failures >= 5
    ? { allowed: false, retryAfter: Math.ceil((item.resetAt - now) / 1000) }
    : { allowed: true };
}

function authFailure(map, key, now = Date.now()) {
  const item = map.get(key);
  if (!item || now >= item.resetAt) {
    map.set(key, { failures: 1, resetAt: now + 15 * 60 * 1000 });
    return;
  }
  item.failures += 1;
}

function okError(res, status, message, requestIdValue, details = undefined) {
  send(res, status, { error: { message, requestId: requestIdValue, ...(details ? { details } : {}) } }, { "x-request-id": requestIdValue });
}

export function createApi({ repo, jwtSecret, corsOrigin = "*" }) {
  if (!repo) throw new Error("Repository is required.");
  if (!jwtSecret || jwtSecret.length < 32) throw new Error("JWT secret must be at least 32 characters.");

  const authFailures = new Map();

  function authUser(req) {
    const token = extractBearerToken(req);
    const payload = verifyAccessToken(token, jwtSecret);
    return payload;
  }

  async function handler(req, res) {
    const id = requestId(req);
    const origin = req.headers.origin;
    const cors = {
      "access-control-allow-origin": corsOrigin === "*" ? "*" : origin === corsOrigin ? corsOrigin : "",
      "vary": "Origin",
      "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key, X-Request-Id",
      "access-control-allow-methods": "GET,POST,OPTIONS"
    };
    if (req.method === "OPTIONS") return send(res, 204, {}, cors);

    const path = new URL(req.url, "http://gym.local").pathname;
    const started = Date.now();

    try {
      if (path === "/v1/health" && req.method === "GET") {
        let database = false;
        try { database = await repo.health(); } catch {}
        return send(res, 200, { ok: true, service: "gym-api", database, requestId: id }, cors);
      }

      if (path === "/v1/ready" && req.method === "GET") {
        const database = await repo.health();
        return send(res, database ? 200 : 503, { ready: database, service: "gym-api", requestId: id }, cors);
      }

      if (path === "/v1/auth/register" && req.method === "POST") {
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        const password = validatePassword(body.password);
        
        const existing = await repo.getUserByEmail(email);
        if (existing) return okError(res, 409, "Email already registered.", id);
        const credentials = await hashPassword(password);
        const user = await repo.createUser({ email, passwordHash:credentials.hash, passwordSalt:credentials.salt });
        const token = issueAccessToken(user.id, jwtSecret);
        return send(res, 201, { user:{ id:user.id, email:user.email }, accessToken:token }, { ...cors, "x-request-id":id });
      }

      if (path === "/v1/auth/login" && req.method === "POST") {
        const key = req.socket.remoteAddress || "unknown";
        const limit = authLimit(authFailures, key);
        if (!limit.allowed) return okError(res, 429, "Too many failed login attempts. Try again later.", id, { retryAfter: limit.retryAfter });
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        const password = validatePassword(body.password);
        const user = await repo.getUserByEmail(email);
        const valid = user?.status === "active" && user?.password_hash && await verifyPassword(password, user.password_salt, user.password_hash);
        if (!valid) {
          authFailure(authFailures, key);
          return okError(res, 401, "Invalid email or password.", id);
        }
        authFailures.delete(key);
        const token = issueAccessToken(user.id, jwtSecret);
        return send(res, 200, { user:{ id:user.id, email:user.email }, accessToken:token }, { ...cors, "x-request-id":id });
      }

      const auth = authUser(req);
      if (!auth) return okError(res, 401, "Authentication required.", id);
      const user = await repo.getUserById(auth.userId);
      if (!user || user.status !== "active") return okError(res, 401, "Account is not active.", id);

      if (path === "/v1/me" && req.method === "GET") {
        return send(res, 200, { user:{ id:user.id, email:user.email, createdAt:user.created_at } }, { ...cors, "x-request-id":id });
      }

      if (path === "/v1/sessions" && req.method === "POST") {
        const idem = req.headers["idempotency-key"];
        if (typeof idem !== "string" || idem.length < 16 || idem.length > 128) return okError(res, 400, "Idempotency-Key is required (16–128 characters).", id);
        const body = validateSession(await readJson(req));
        const result = await repo.createSession(user.id, body, idem);
        return send(res, result.existing ? 200 : 201, { session:result.session }, { ...cors, "x-request-id":id });
      }

      if (path === "/v1/sessions" && req.method === "GET") {
        const limit = new URL(req.url, "http://gym.local").searchParams.get("limit") || "20";
        const sessions = await repo.listSessions(user.id, limit);
        return send(res, 200, { sessions }, { ...cors, "x-request-id":id });
      }

      if (path === "/v1/movement-events" && req.method === "POST") {
        const event = validateMovementEvent(await readJson(req));
        const saved = await repo.createMovementEvent(user.id, event);
        return send(res, 201, { event:saved }, { ...cors, "x-request-id":id });
      }

      return okError(res, 404, "Route not found.", id);
    } catch (error) {
      if (error instanceof ValidationError) return okError(res, 400, error.message, id);
      if (error?.code === "23505") return okError(res, 409, "Resource already exists.", id);
      if (error?.code === "DUPLICATE_EMAIL") return okError(res, 409, "Email already registered.", id);
      if (error?.code === "NOT_FOUND") return okError(res, 404, error.message, id);
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      console.error(JSON.stringify({ level:"error", requestId:id, durationMs:Date.now()-started, method:req.method, path, message:error?.message }));
      return okError(res, status, status === 500 ? "Internal server error." : error.message, id);
    }
  }

  return handler;
}
