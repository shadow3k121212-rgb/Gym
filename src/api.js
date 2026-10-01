const config = globalThis.__GYM_CONFIG__ || {};
export const apiBaseUrl = String(config.apiBaseUrl || "").replace(/\/$/, "");
const TOKEN_KEY = "gym:access-token";

export function hasApi() { return Boolean(apiBaseUrl); }
export function hasAuth() { return Boolean(sessionStorage.getItem(TOKEN_KEY)); }
export function setAuthToken(token) { if (token) sessionStorage.setItem(TOKEN_KEY, token); }
export function clearAuth() { sessionStorage.removeItem(TOKEN_KEY); }

export async function syncSession(session) {
  if (!apiBaseUrl || !hasAuth()) return { ok:false, message:"Cloud sync is not configured." };
  const headers = {
    "content-type":"application/json",
    "authorization":"Bearer " + sessionStorage.getItem(TOKEN_KEY),
    "idempotency-key":"gym-" + session.id
  };
  try {
    const response = await fetch(apiBaseUrl + "/v1/sessions", { method:"POST", headers, body:JSON.stringify(session) });
    const body = await response.json().catch(() => ({}));
    return response.ok ? { ok:true, body } : { ok:false, message:body?.error?.message || "Cloud sync failed." };
  } catch {
    return { ok:false, message:"GYM API is unreachable." };
  }
}
