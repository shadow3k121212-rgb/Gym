const config = globalThis.__GYM_CONFIG__ || {};
export const apiBaseUrl = String(config.apiBaseUrl || "").replace(/\/$/, "");
const TOKEN_KEY = "gym:access-token";
const USER_ID_KEY = "gym:auth-user-id";

function getStoredToken() {
  return globalThis.sessionStorage?.getItem(TOKEN_KEY) || null;
}

function getStoredUserId() {
  return globalThis.sessionStorage?.getItem(USER_ID_KEY) || null;
}

export function hasApi() { return Boolean(apiBaseUrl); }
export function hasAuth() { return Boolean(getStoredToken() && getStoredUserId()); }
export function setAuthToken(token) {
  if (token) globalThis.sessionStorage?.setItem(TOKEN_KEY, token);
}
export function setCurrentUserId(userId) {
  if (typeof userId === "string" && userId) globalThis.sessionStorage?.setItem(USER_ID_KEY, userId);
}

export function getCurrentUserId() {
  return getStoredUserId();
}

export function clearAuth() {
  globalThis.sessionStorage?.removeItem(TOKEN_KEY);
  globalThis.sessionStorage?.removeItem(USER_ID_KEY);
}

async function request(path, options = {}) {
  if (!apiBaseUrl) return { ok:false, message:"Cloud API is not configured." };
  const headers = { "content-type":"application/json", ...(options.headers || {}) };
  const token = getStoredToken();
  if (token) headers.authorization = "Bearer " + token;
  try {
    const response = await fetch(apiBaseUrl + path, { ...options, headers });
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

async function authenticate(path, email, password) {
  const result = await request(path, { method:"POST", body:JSON.stringify({ email, password }) });
  if (!result.ok) return result;
  if (!result.body?.accessToken) return { ok:false, message:"API did not return an access token." };
  if (typeof result.body?.user?.id !== "string" || !result.body.user.id) {
    return { ok:false, message:"API did not return a user identity." };
  }
  setAuthToken(result.body.accessToken);
  setCurrentUserId(result.body.user.id);
  return result;
}

export function login(email, password) { return authenticate("/v1/auth/login", email, password); }
export function register(email, password) { return authenticate("/v1/auth/register", email, password); }

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
