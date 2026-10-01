const config = globalThis.__GYM_CONFIG__ || {};
export const apiBaseUrl = String(config.apiBaseUrl || "").replace(/\/$/, "");

let accessToken = null;
let currentUserId = null;
let refreshInFlight = null;

export function hasApi() {
  return Boolean(apiBaseUrl);
}

export function hasAuth() {
  return Boolean(accessToken && currentUserId);
}

export function getCurrentUserId() {
  return currentUserId;
}

export function setAuthSession(token, userId) {
  if (typeof token === "string" && token && typeof userId === "string" && userId) {
    accessToken = token;
    currentUserId = userId;
    return true;
  }
  return false;
}

export function setAuthToken(token) {
  if (typeof token === "string" && token) accessToken = token;
}

export function clearAuth() {
  accessToken = null;
  currentUserId = null;
}

async function rawRequest(path, options = {}, includeAccessToken = true) {
  if (!apiBaseUrl) return { ok:false, message:"Cloud API is not configured." };
  const headers = { "content-type":"application/json", ...(options.headers || {}) };
  if (includeAccessToken && accessToken) headers.authorization = "Bearer " + accessToken;

  try {
    const response = await fetch(apiBaseUrl + path, {
      ...options,
      credentials:"include",
      headers
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return { ok:true, status:response.status, body };
    const retryable = response.status === 408 || response.status === 429 || (response.status >= 500 && response.status <= 599);
    return {
      ok:false,
      status:response.status,
      authRequired:response.status === 401,
      retryable,
      message:body?.error?.message || "Request failed."
    };
  } catch {
    return { ok:false, retryable:true, message:"GYM API is unreachable." };
  }
}

async function runRefresh() {
  const result = await rawRequest("/v1/auth/refresh", { method:"POST" }, false);
  if (!result.ok) {
    clearAuth();
    return result;
  }
  if (!result.body?.accessToken || typeof result.body?.user?.id !== "string" || !result.body.user.id) {
    clearAuth();
    return { ok:false, status:502, malformedResponse:true, message:"GYM API returned an invalid authentication response." };
  }
  setAuthSession(result.body.accessToken, result.body.user.id);
  return result;
}

export async function refreshAuth() {
  if (!apiBaseUrl) return { ok:false, message:"Cloud API is not configured." };
  if (refreshInFlight) return refreshInFlight;

  const start = () => {
    refreshInFlight = runRefresh();
    return refreshInFlight;
  };

  try {
    if (globalThis.navigator?.locks?.request) {
      return await globalThis.navigator.locks.request("gym-auth-refresh", { mode:"exclusive" }, start);
    }
    return await start();
  } finally {
    refreshInFlight = null;
  }
}

const PUBLIC_AUTH_PATHS = new Set([
  "/v1/auth/login",
  "/v1/auth/register",
  "/v1/auth/refresh",
  "/v1/auth/logout",
  "/v1/auth/password-reset/request",
  "/v1/auth/password-reset/confirm"
]);

async function request(path, options = {}, allowRefresh = true) {
  const result = await rawRequest(path, options);
  if (result.ok || !result.authRequired || !allowRefresh || PUBLIC_AUTH_PATHS.has(path)) return result;

  const refreshed = await refreshAuth();
  if (!refreshed.ok) return result;
  return rawRequest(path, options);
}

async function authenticate(path, email, password) {
  const result = await rawRequest(path, {
    method:"POST",
    body:JSON.stringify({ email, password })
  }, false);
  if (!result.ok) return result;
  if (!result.body?.accessToken) return { ok:false, status:502, malformedResponse:true, message:"API did not return an access token." };
  if (typeof result.body?.user?.id !== "string" || !result.body.user.id) {
    return { ok:false, status:502, malformedResponse:true, message:"API did not return a user identity." };
  }
  setAuthSession(result.body.accessToken, result.body.user.id);
  return result;
}

export function login(email, password) {
  return authenticate("/v1/auth/login", email, password);
}

export function register(email, password) {
  return authenticate("/v1/auth/register", email, password);
}

export async function logout() {
  const result = await rawRequest("/v1/auth/logout", { method:"POST" });
  clearAuth();
  return result.ok ? result : { ...result, ok:false };
}

export async function logoutAll() {
  const result = await request("/v1/auth/logout-all", { method:"POST" });
  clearAuth();
  return result;
}

export function listAuthSessions() {
  if (!apiBaseUrl || !hasAuth()) return Promise.resolve({ ok:false, message:"Cloud API is not configured." });
  return request("/v1/auth/sessions");
}

export async function revokeAuthSession(sessionId) {
  if (!apiBaseUrl || !hasAuth() || typeof sessionId !== "string" || !sessionId) {
    return { ok:false, message:"Cloud API is not configured." };
  }
  const result = await request("/v1/auth/sessions/" + encodeURIComponent(sessionId), { method:"DELETE" });
  if (result.ok && result.body?.current === true) clearAuth();
  return result;
}

export async function deleteAccount(password) {
  if (!apiBaseUrl || !hasAuth()) return { ok:false, message:"Cloud account is not connected." };
  const result = await request("/v1/auth/delete-account", {
    method:"POST",
    body:JSON.stringify({ password })
  });
  if (result.ok || result.authRequired) clearAuth();
  return result;
}

export function requestPasswordReset(email) {
  if (!apiBaseUrl) return Promise.resolve({ ok:false, message:"Cloud API is not configured." });
  return rawRequest("/v1/auth/password-reset/request", {
    method:"POST",
    body:JSON.stringify({ email })
  }, false);
}

export async function confirmPasswordReset(token, password) {
  if (!apiBaseUrl) return { ok:false, message:"Cloud API is not configured." };
  const result = await rawRequest("/v1/auth/password-reset/confirm", {
    method:"POST",
    body:JSON.stringify({ token, password })
  }, false);
  if (result.ok) clearAuth();
  return result;
}

export async function syncSession(session) {
  if (!apiBaseUrl || !hasAuth()) return { ok:false, message:"Cloud sync is not configured." };
  const result = await request("/v1/sessions", {
    method:"POST",
    headers:{ "idempotency-key":"gym-" + session.id },
    body:JSON.stringify(session)
  });
  if (!result.ok) return result;
  if (!result.body?.session || result.body.session.id !== session.id) {
    return {
      ok:false,
      status:502,
      malformedResponse:true,
      message:"GYM API returned an invalid sync response."
    };
  }
  return result;
}

export function listCloudSessions(limit = 50, cursor = null) {
  if (!apiBaseUrl || !hasAuth()) return Promise.resolve({ ok:false, message:"Cloud sync is not configured." });
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
  const params = new URLSearchParams({ limit: String(safeLimit) });
  if (cursor) params.set("before", cursor);
  return request("/v1/sessions?" + params.toString());
}
