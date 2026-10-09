import { randomUUID } from "node:crypto";
import { createRefreshToken, getRefreshTtlSeconds, hashPassword, hashRefreshToken, refreshExpiry, verifyPassword, issueAccessToken, verifyAccessToken, extractBearerToken } from "./auth.js";
import { ValidationError, normalizeEmail, validatePassword, validateSession, validateMovementEvent, validateTenantName, validateTenantSlug, slugifyTenantName, validateTenantInvitationRole } from "./validation.js";
import { decodeSessionCursor, normalizePageLimit, PaginationError } from "./pagination.js";

const JSON_LIMIT = 256 * 1024;
const REFRESH_COOKIE = "gym_refresh";
const TENANT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export function createApi({ repo, jwtSecret, corsOrigin = "*" }) {
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
    const user = await repo.getUserById(payload.userId);
    if (!user || user.status !== "active") return null;
    const lastSeenAt = new Date(session.last_seen_at).getTime();
    if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt >= 5 * 60 * 1000) {
      await repo.touchAuthSession(payload.sessionId, payload.userId);
    }
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
    const started = Date.now();
    res.once("finish", () => {
      const status = res.statusCode;
      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
      console[level](JSON.stringify({
        level,
        type:"http_request",
        requestId:id,
        method:req.method,
        path:new URL(req.url, "http://gym.local").pathname,
        status,
        durationMs:Date.now() - started
      }));
    });
    const cors = {
      "access-control-allow-origin": corsOrigin === "*" ? "*" : origin === corsOrigin ? corsOrigin : "",
      "vary": "Origin",
      "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key, X-Request-Id",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      ...(corsOrigin !== "*" ? { "access-control-allow-credentials":"true" } : {})
    };
    if (req.method === "OPTIONS") return send(res, 204, {}, { ...cors, "x-request-id": id });

    const path = new URL(req.url, "http://gym.local").pathname;

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
              const headers = {"content-type":"application/json"};
              if (process.env.PASSWORD_RESET_WEBHOOK_SECRET) {
                headers["x-gym-delivery-secret"] = process.env.PASSWORD_RESET_WEBHOOK_SECRET;
              }
              const delivery = await fetch(deliveryUrl, {
                method:"POST",
                headers,
                body:JSON.stringify({
                  email:resetUser.email,
                  resetToken,
                  requestId:id
                }),
                signal:AbortSignal.timeout(5000)
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
          tokenHash:hashRefreshToken(replacementToken)
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
        const remainingRefreshSeconds = Math.max(0, Math.ceil((new Date(rotated.expiresAt).getTime() - Date.now()) / 1000));
        return send(res, 200, { user:{ id:user.id, email:user.email }, accessToken }, { ...cors, "x-request-id":id, "set-cookie":refreshCookie(replacementToken, remainingRefreshSeconds) });
      }

      if (path === "/v1/auth/logout" && req.method === "POST") {
        const refreshToken = parseCookies(req)[REFRESH_COOKIE];
        const access = authUser(req);
        if (access?.sessionId) {
          await repo.revokeAuthSession(access.userId, access.sessionId, "logout");
        }
        if (refreshToken) {
          await repo.revokeAuthSessionByTokenHash(hashRefreshToken(refreshToken), "logout");
        }
        return send(res, 204, {}, { ...cors, "x-request-id":id, "set-cookie":clearRefreshCookie() });
      }

      const auth = await activeAuthUser(req);
      if (!auth) return okError(res, 401, "Authentication required.", id);
      const user = await repo.getUserById(auth.userId);
      if (!user || user.status !== "active") return okError(res, 401, "Account is not active.", id);

      if (path === "/v1/me" && req.method === "GET") {
        return send(res, 200, { user:{ id:user.id, email:user.email, createdAt:user.created_at } }, { ...cors, "x-request-id":id });
      }

      if (path === "/v1/tenants" && req.method === "GET") {
        const tenants = await repo.listTenantsForUser(user.id);
        return send(res, 200, { tenants }, { ...cors, "x-request-id":id });
      }

      if (path === "/v1/tenants" && req.method === "POST") {
        const body = await readJson(req);
        const name = validateTenantName(body.name);
        const slug = body.slug === undefined ? validateTenantSlug(slugifyTenantName(name)) : validateTenantSlug(body.slug);
        const tenant = await repo.createGymTenant(user.id, { name, slug });
        return send(res, 201, { tenant }, { ...cors, "x-request-id":id });
      }

      const tenantResource = path.match(/^\/v1\/tenants\/([^/]+)\/(members|invitations)(?:\/([^/]+))?$/);
      if (tenantResource) {
        const [, rawTenantId, resource, rawResourceId] = tenantResource;
        if (!UUID_PATTERN.test(rawTenantId)) return okError(res, 400, "Invalid workspace id.", id);
        const tenantId = rawTenantId.toLowerCase();

        if (resource === "members" && !rawResourceId && req.method === "GET") {
          const params = new URL(req.url, "http://gym.local").searchParams;
          const limit = normalizePageLimit(params.get("limit"), 20, 100);
          const before = decodeSessionCursor(params.get("before"));
          const page = await repo.listTenantMembers(user.id, tenantId, { limit, before });
          return send(res, 200, { members:page.members, nextCursor:page.nextCursor }, { ...cors, "x-request-id":id });
        }

        if (resource === "invitations" && !rawResourceId && req.method === "GET") {
          const params = new URL(req.url, "http://gym.local").searchParams;
          const limit = normalizePageLimit(params.get("limit"), 20, 100);
          const before = decodeSessionCursor(params.get("before"));
          const page = await repo.listTenantInvitations(user.id, tenantId, { limit, before });
          return send(res, 200, { invitations:page.invitations, nextCursor:page.nextCursor }, { ...cors, "x-request-id":id });
        }

        if (resource === "invitations" && !rawResourceId && req.method === "POST") {
          const body = await readJson(req);
          const email = normalizeEmail(body.email);
          const role = validateTenantInvitationRole(body.role);
          const rawToken = createRefreshToken();
          const expiresAt = new Date(Date.now() + TENANT_INVITATION_TTL_MS);
          const invitation = await repo.createTenantInvitation({
            actorUserId:user.id,
            tenantId,
            id:randomUUID(),
            email,
            role,
            tokenHash:hashRefreshToken(rawToken),
            expiresAt
          });

          const webhookUrl = process.env.TENANT_INVITATION_WEBHOOK_URL;
          let developmentToken = null;
          if (!webhookUrl) {
            if (process.env.NODE_ENV === "production") {
              try { await repo.revokeTenantInvitation(user.id, tenantId, invitation.id); } catch {}
              return okError(res, 503, "Invitation delivery is not configured.", id);
            }
            developmentToken = rawToken;
          } else {
            let delivered = false;
            try {
              const response = await fetch(webhookUrl, {
                method:"POST",
                headers:{
                  "content-type":"application/json",
                  "x-gym-delivery-secret":process.env.TENANT_INVITATION_WEBHOOK_SECRET
                },
                body:JSON.stringify({
                  email,
                  token:rawToken,
                  role,
                  expiresAt:expiresAt.toISOString(),
                  tenant:{id:invitation.tenant.id,name:invitation.tenant.name,slug:invitation.tenant.slug},
                  requestId:id
                }),
                signal:AbortSignal.timeout(5000)
              });
              delivered = response.ok;
            } catch {}
            if (!delivered) {
              try { await repo.revokeTenantInvitation(user.id, tenantId, invitation.id); } catch {}
              return okError(res, 503, "Invitation delivery failed; the invitation was revoked. Please retry.", id);
            }
          }

          const publicInvitation = {
            id:invitation.id,
            tenant_id:invitation.tenant_id,
            email:invitation.email,
            role:invitation.role,
            invited_by_user_id:invitation.invited_by_user_id,
            expires_at:invitation.expires_at,
            accepted_at:invitation.accepted_at,
            revoked_at:invitation.revoked_at,
            created_at:invitation.created_at,
            status:invitation.status
          };
          return send(res, 201, {
            invitation:publicInvitation,
            ...(developmentToken ? { developmentToken } : {})
          }, { ...cors, "x-request-id":id });
        }

        if (resource === "invitations" && rawResourceId && req.method === "DELETE") {
          if (!UUID_PATTERN.test(rawResourceId)) return okError(res, 400, "Invalid invitation id.", id);
          const invitation = await repo.revokeTenantInvitation(user.id, tenantId, rawResourceId.toLowerCase());
          return send(res, 200, { invitation }, { ...cors, "x-request-id":id });
        }
      }

      if (path === "/v1/tenant-invitations/accept" && req.method === "POST") {
        const body = await readJson(req);
        if (typeof body.token !== "string" || body.token.length < 40 || body.token.length > 128) {
          return okError(res, 400, "Invitation is invalid, expired, or already used.", id);
        }
        const tenant = await repo.acceptTenantInvitation(user.id, hashRefreshToken(body.token));
        return send(res, 200, { tenant }, { ...cors, "x-request-id":id });
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
        return send(
          res,
          200,
          { sessions:sessions.map((session) => ({ ...session, isCurrent:session.id === auth.sessionId })) },
          { ...cors, "x-request-id":id }
        );
      }

      const sessionPrefix = "/v1/auth/sessions/";
      if (path.startsWith(sessionPrefix) && req.method === "DELETE") {
        const sessionId = path.slice(sessionPrefix.length);
        if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return okError(res, 400, "Invalid session id.", id);
        const revoked = await repo.revokeAuthSession(user.id, sessionId);
        if (!revoked) return okError(res, 404, "Session not found.", id);
        const current = sessionId === auth.sessionId;
        return send(res, 200, { revoked:true, current }, {
          ...cors,
          "x-request-id":id,
          ...(current ? { "set-cookie":clearRefreshCookie() } : {})
        });
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
      if (error?.code === "TENANT_SLUG_CONFLICT") return okError(res, 409, "Workspace slug already exists. Choose a different slug.", id);
      if (error?.code === "TENANT_OWNER_REQUIRED") return okError(res, 409, error.message, id);
      if (["FORBIDDEN","TENANT_ROLE_FORBIDDEN","INVITATION_EMAIL_MISMATCH","TENANT_MEMBERSHIP_SUSPENDED"].includes(error?.code)) return okError(res, 403, error.message, id);
      if (["TENANT_MEMBERSHIP_EXISTS","TENANT_INVITATION_CONFLICT","TENANT_INVITATION_FINAL"].includes(error?.code)) return okError(res, 409, error.message, id);
      if (error?.code === "INVALID_INVITATION") return okError(res, 400, error.message, id);
      if (error?.code === "NOT_FOUND") return okError(res, 404, error.message, id);
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      console.error(JSON.stringify({ level:"error", requestId:id, durationMs:Date.now()-started, method:req.method, path, message:error?.message }));
      return okError(res, status, status === 500 ? "Internal server error." : error.message, id);
    }
  }

  return handler;
}
