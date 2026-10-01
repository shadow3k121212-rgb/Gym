import { randomUUID } from "node:crypto";
import { createRefreshToken, getRefreshTtlSeconds, hashPassword, hashRefreshToken, refreshExpiry, verifyPassword, issueAccessToken, verifyAccessToken, extractBearerToken } from "./auth.js";
import { ValidationError, normalizeEmail, validatePassword, validateSession, validateMovementEvent } from "./validation.js";
import { decodeSessionCursor, normalizePageLimit, PaginationError } from "./pagination.js";

const JSON_LIMIT = 256 * 1024;
const REFRESH_COOKIE = "gym_refresh";

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
    ...(process.env.NODE_ENV === "production" ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
    ...headers
  });
  res.end(JSON.stringify(body));
}

function requestId(req) {
  const candidate = req.headers["x-request-id"];
  return typeof candidate === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(candidate) ? candidate : randomUUID();
}

function authLimit(map, key, maxFailures = 5, now = Date.now()) {
  const item = map.get(key);
  if (!item || now >= item.resetAt) return { allowed: true };
  return item.failures >= maxFailures
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

export function parseCookies(req) {
  const header = req.headers.cookie;
  if (typeof header !== "string") return {};
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { cookies[name] = decodeURIComponent(value); } catch {}
  }
  return cookies;
}

function refreshCookie(token, maxAge = getRefreshTtlSeconds()) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${REFRESH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/v1/auth; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearRefreshCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${REFRESH_COOKIE}=; HttpOnly; Path=/v1/auth; SameSite=Lax; Max-Age=0${secure}`;
}

function createApi({ repo, jwtSecret, corsOrigin = "*" }) {
  if (!repo) throw new Error("Repository is required.");
  if (!jwtSecret || jwtSecret.length < 32) throw new Error("JWT secret must be at least 32 characters.");

  const authFailures = new Map();

  async function startAuthSession(user) {
    const refreshToken = createRefreshToken();
    const sessionId = randomUUID();
    await repo.createAuthSession({
      id:sessionId,
      familyId:sessionId,
      userId:user.id,
      tokenHash:hashRefreshToken(refreshToken),
      expiresAt:refreshExpiry()
    });
    return {
      accessToken:issueAccessToken(user.id,jwtSecret,Date.now(),sessionId),
      refreshToken,
      sessionId
    };
  }

  async function activeAuthUser(req) {
    const payload = authUser(req);
    if (!payload?.sessionId) return null;
    const session = await repo.getAuthSession(payload.sessionId, payload.userId);
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) return null;
    return payload;
  }

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
      "access-control-allow-methods": "GET,POST,OPTIONS",
      ...(corsOrigin !== "*" ? { "access-control-allow-credentials":"true" } : {})
    };
    if (req.method === "OPTIONS") return send(res, 204, {}, { ...cors, "x-request-id": id });

    const path = new URL(req.url, "http://gym.local").pathname;
    const started = Date.now();

    try {
      if (path === "/v1/health" && req.method === "GET") {
        let database = false;
        try { database = await repo.health(); } catch {}
        return send(res, 200, { ok: true, service: "gym-api", database, requestId: id }, { ...cors, "x-request-id": id });
      }

      if (path === "/v1/ready" && req.method === "GET") {
        const database = await repo.health();
        return send(res, database ? 200 : 503, { ready: database, service: "gym-api", requestId: id }, { ...cors, "x-request-id": id });
      }

      if (path === "/v1/auth/register" && req.method === "POST") {
        const key = "register:" + (req.socket.remoteAddress || "unknown");
        const limit = authLimit(authFailures, key, 5);
        if (!limit.allowed) return okError(res, 429, "Too many account creation attempts. Try again later.", id, { retryAfter: limit.retryAfter });
        authFailure(authFailures, key);
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        const password = validatePassword(body.password);
        
        const existing = await repo.getUserByEmail(email);
        if (existing) return okError(res, 409, "Email already registered.", id);
        const credentials = await hashPassword(password);
        const user = await repo.createUser({ email, passwordHash:credentials.hash, passwordSalt:credentials.salt });
        const authSession = await startAuthSession(user);
        return send(
          res,
          201,
          { user:{ id:user.id, email:user.email }, accessToken:authSession.accessToken },
          { ...cors, "x-request-id":id, "set-cookie":refreshCookie(authSession.refreshToken) }
        );
      }

      if (path === "/v1/auth/login" && req.method === "POST") {
        const key = "login:" + (req.socket.remoteAddress || "unknown");
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
        const authSession = await startAuthSession(user);
        return send(
          res,
          200,
          { user:{ id:user.id, email:user.email }, accessToken:authSession.accessToken },
          { ...cors, "x-request-id":id, "set-cookie":refreshCookie(authSession.refreshToken) }
        );
      }

      if (path === "/v1/auth/password-reset/request" && req.method === "POST") {
        const key = "password-reset:" + (req.socket.remoteAddress || "unknown");
        const limit = authLimit(authFailures, key, 5);
        if (!limit.allowed) {
          return send(res, 202, { accepted:true, requestId:id }, { ...cors, "x-request-id":id });
        }
        authFailure(authFailures, key);
        const body = await readJson(req);
        const email = normalizeEmail(body.email);
        const resetUser = await repo.getUserByEmail(email);
        if (resetUser?.status === "active") {
          const resetToken = createRefreshToken();
          await repo.createPasswordResetToken({
            id:randomUUID(),
            userId:resetUser.id,
            tokenHash:hashRefreshToken(resetToken),
            expiresAt:new Date(Date.now() + 30 * 60 * 1000)
          });

          const deliveryUrl = process.env.PASSWORD_RESET_WEBHOOK_URL;
          if (deliveryUrl) {
            try {
              const delivery = await fetch(deliveryUrl, {
                method:"POST",
                headers:{"content-type":"application/json"},
                body:JSON.stringify({
                  email:resetUser.email,
                  resetToken,
                  requestId:id
                })
              });
              if (!delivery.ok) console.warn(JSON.stringify({level:"warn",requestId:id,message:"Password reset delivery failed.",status:delivery.status}));
            } catch (error) {
              console.warn(JSON.stringify({level:"warn",requestId:id,message:"Password reset delivery unavailable.",error:error?.message}));
            }
          } else if (process.env.NODE_ENV !== "production") {
            console.info(JSON.stringify({level:"info",requestId:id,message:"Password reset token created for development delivery only."}));
          }
        }
        return send(res, 202, { accepted:true, requestId:id }, { ...cors, "x-request-id":id });
      }

      if (path === "/v1/auth/password-reset/confirm" && req.method === "POST") {
        const body = await readJson(req);
        if (typeof body.token !== "string" || body.token.length < 40 || body.token.length > 128) {
          return okError(res, 400, "Invalid or expired password reset token.", id);
        }
        const password = validatePassword(body.password);
        const credentials = await hashPassword(password);
        const reset = await repo.resetPassword(hashRefreshToken(body.token), credentials.hash, credentials.salt);
        if (!reset) {
          return send(res, 400, { error:{ message:"Invalid or expired password reset token.", requestId:id } }, { ...cors, "x-request-id":id, "set-cookie":clearRefreshCookie() });
        }
        return send(res, 200, { reset:true }, { ...cors, "x-request-id":id, "set-cookie":clearRefreshCookie() });
      }

      if (path === "/v1/auth/refresh" && req.method === "POST") {
        const rawRefreshToken = parseCookies(req)[REFRESH_COOKIE];
        if (!rawRefreshToken) return okError(res, 401, "Refresh session required.", id);
        const replacementId = randomUUID();
        const replacementToken = createRefreshToken();
        const rotated = await repo.rotateAuthSession(hashRefreshToken(rawRefreshToken), {
          id:replacementId,
          tokenHash:hashRefreshToken(replacementToken),
          expiresAt:refreshExpiry()
        });
        if (rotated.status !== "rotated") {
          return send(res, 401, { error:{ message:"Refresh session is invalid.", requestId:id } }, { ...cors, "x-request-id":id, "set-cookie":clearRefreshCookie() });
        }
        const user = await repo.getUserById(rotated.userId);
        if (!user || user.status !== "active") {
          await repo.revokeAuthSession(rotated.userId, rotated.sessionId, "account-inactive");
          return send(res, 401, { error:{ message:"Account is not active.", requestId:id } }, { ...cors, "x-request-id":id, "set-cookie":clearRefreshCookie() });
        }
        const accessToken = issueAccessToken(user.id,jwtSecret,Date.now(),rotated.sessionId);
        return send(res, 200, { user:{ id:user.id, email:user.email }, accessToken }, { ...cors, "x-request-id":id, "set-cookie":refreshCookie(replacementToken) });
      }

      if (path === "/v1/auth/logout" && req.method === "POST") {
        const rawRefreshToken = parseCookies(req)[REFRESH_COOKIE];
        if (rawRefreshToken) await repo.revokeAuthSessionByTokenHash(hashRefreshToken(rawRefreshToken), "logout");
        return send(res, 204, {}, { ...cors, "x-request-id":id, "set-cookie":clearRefreshCookie() });
      }

      const auth = await activeAuthUser(req);
      if (!auth) return okError(res, 401, "Authentication required.", id);
      const user = await repo.getUserById(auth.userId);
      if (!user || user.status !== "active") return okError(res, 401, "Account is not active.", id);

      if (path === "/v1/me" && req.method === "GET") {
        return send(res, 200, { user:{ id:user.id, email:user.email, createdAt:user.created_at } }, { ...cors, "x-request-id":id });
      }

      if (path === "/v1/auth/delete-account" && req.method === "POST") {
        const body = await readJson(req);
        const password = validatePassword(body.password);
        const credentials = await repo.getUserByEmail(user.email);
        const validPassword = credentials?.password_hash
          ? await verifyPassword(password, credentials.password_salt, credentials.password_hash)
          : false;
        if (!validPassword) return okError(res, 401, "Password confirmation failed.", id);
        const deleted = await repo.deleteAccount(user.id);
        if (!deleted) return okError(res, 404, "Account not found.", id);
        return send(res, 200, { deleted:true }, { ...cors, "x-request-id":id, "set-cookie":clearRefreshCookie() });
      }

      if (path === "/v1/auth/logout-all" && req.method === "POST") {
        const count = await repo.revokeAllAuthSessions(user.id, null, "logout-all");
        return send(res, 200, { revoked:count }, { ...cors, "x-request-id":id, "set-cookie":clearRefreshCookie() });
      }

      if (path === "/v1/auth/sessions" && req.method === "GET") {
        const sessions = await repo.listAuthSessions(user.id);
        return send(res, 200, { sessions }, { ...cors, "x-request-id":id });
      }

      const sessionPrefix = "/v1/auth/sessions/";
      if (path.startsWith(sessionPrefix) && req.method === "DELETE") {
        const sessionId = path.slice(sessionPrefix.length);
        if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return okError(res, 400, "Invalid session id.", id);
        const revoked = await repo.revokeAuthSession(user.id, sessionId);
        if (!revoked) return okError(res, 404, "Session not found.", id);
        return send(res, 200, { revoked:true }, { ...cors, "x-request-id":id });
      }

      if (path === "/v1/sessions" && req.method === "POST") {
        const idem = req.headers["idempotency-key"];
        if (typeof idem !== "string" || idem.length < 16 || idem.length > 128) return okError(res, 400, "Idempotency-Key is required (16–128 characters).", id);
        const body = validateSession(await readJson(req));
        const result = await repo.createSession(user.id, body, idem);
        return send(res, result.existing ? 200 : 201, { session:result.session }, { ...cors, "x-request-id":id });
      }

      if (path === "/v1/sessions" && req.method === "GET") {
        const searchParams = new URL(req.url, "http://gym.local").searchParams;
        const limit = normalizePageLimit(searchParams.get("limit"), 20, 100);
        const before = decodeSessionCursor(searchParams.get("before"));
        const page = await repo.listSessionsPage(user.id, { limit, before });
        return send(res, 200, { sessions:page.sessions, nextCursor:page.nextCursor }, { ...cors, "x-request-id":id });
      }

      if (path === "/v1/movement-events" && req.method === "POST") {
        const idem = req.headers["idempotency-key"];
        if (typeof idem !== "string" || idem.length < 16 || idem.length > 128) return okError(res, 400, "Idempotency-Key is required (16–128 characters).", id);
        const event = validateMovementEvent(await readJson(req));
        const result = await repo.createMovementEvent(user.id, event, idem);
        return send(res, result.existing ? 200 : 201, { event:result.event }, { ...cors, "x-request-id":id });
      }

      return okError(res, 404, "Route not found.", id);
    } catch (error) {
      if (error instanceof ValidationError || error instanceof PaginationError) return okError(res, 400, error.message, id);
      if (error?.code === "23505") return okError(res, 409, "Resource already exists.", id);
      if (error?.code === "23503") return okError(res, 400, "Referenced resource does not exist.", id);
      if (error?.code === "IDEMPOTENCY_CONFLICT") return okError(res, 409, error.message, id);
      if (error?.code === "DUPLICATE_EMAIL") return okError(res, 409, "Email already registered.", id);
      if (error?.code === "NOT_FOUND") return okError(res, 404, error.message, id);
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      console.error(JSON.stringify({ level:"error", requestId:id, durationMs:Date.now()-started, method:req.method, path, message:error?.message }));
      return okError(res, status, status === 500 ? "Internal server error." : error.message, id);
    }
  }

  return handler;
}
