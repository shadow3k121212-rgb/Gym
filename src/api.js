const config = globalThis.__GYM_CONFIG__ || {};
export const apiBaseUrl = String(config.apiBaseUrl || "").replace(/\/$/, "");
const TOKEN_KEY = "gym:access-token";

export function hasApi() { return Boolean(apiBaseUrl); }
export function hasAuth() { return Boolean(sessionStorage.getItem(TOKEN_KEY)); }
export function setAuthToken(token) { if (token) sessionStorage.setItem(TOKEN_KEY, token); }
export function clearAuth() { sessionStorage.removeItem(TOKEN_KEY); }

async function request(path, options = {}) {
  if (!apiBaseUrl) return { ok:false, message:"Cloud API is not configured." };
  const headers = { "content-type":"application/json", ...(options.headers || {}) };
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) headers.authorization = "Bearer " + token;
  try {
    const response = await fetch(apiBaseUrl + path, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    return response.ok ? { ok:true, status:response.status, body } : { ok:false, status:response.status, message:body?.error?.message || "Request failed." };
  } catch {
    return { ok:false, message:"GYM API is unreachable." };
  }
}

async function authenticate(path, email, password) {
  const result = await request(path, { method:"POST", body:JSON.stringify({ email, password }) });
  if (!result.ok) return result;
  if (!result.body?.accessToken) return { ok:false, message:"API did not return an access token." };
  setAuthToken(result.body.accessToken);
  return result;
}

export function login(email, password) { return authenticate("/v1/auth/login", email, password); }
export function register(email, password) { return authenticate("/v1/auth/register", email, password); }

export function syncSession(session) {
  if (!apiBaseUrl || !hasAuth()) return Promise.resolve({ ok:false, message:"Cloud sync is not configured." });
  return request("/v1/sessions", { method:"POST", headers:{ "idempotency-key":"gym-" + session.id }, body:JSON.stringify(session) });
}

export function listCloudSessions(limit = 50) {
  if (!apiBaseUrl || !hasAuth()) return Promise.resolve({ ok:false, message:"Cloud sync is not configured." });
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 50);
  return request("/v1/sessions?limit=" + safeLimit);
}
