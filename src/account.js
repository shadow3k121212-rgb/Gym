import {
  confirmPasswordReset,
  deleteAccount,
  hasApi,
  hasAuth,
  listAuthSessions,
  login,
  logout,
  logoutAll,
  register,
  requestPasswordReset,
  revokeAuthSession
} from "./api.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;"
  }[char]));
}

export function renderAccount(state) {
  const connected = hasApi() && hasAuth();
  return `
    <section class="settings-grid">
      <div class="panel cloud-panel">
        <div class="eyebrow">CLOUD SYNC · ${hasApi() ? "AVAILABLE" : "NOT CONFIGURED"}</div>
        <h3>${connected ? "Account connected." : "Local-first, with an optional cloud layer."}</h3>
        ${!hasApi()
          ? `<p>Deploy the API and set apiBaseUrl in public/runtime-config.js to enable account sync.</p>`
          : connected
            ? `<p>This browser uses a short-lived access session with a secure refresh cookie. Completed workouts can sync after local save.</p>
               <div id="auth-session-list" class="session-list"><div class="micro-note">Loading active sessions…</div></div>
               <div class="auth-actions">
                 <button class="secondary-button" data-account-action="sign-out">Sign out</button>
                 <button class="secondary-button" data-account-action="logout-all">Sign out all devices</button>
               </div>`
            : `<p>Create an account or sign in. Credentials are sent only to the configured GYM API.</p>
               <div class="auth-form">
                 <label class="field-label" for="auth-email">Email</label>
                 <input class="text-input" id="auth-email" type="email" autocomplete="email" placeholder="you@example.com">
                 <label class="field-label" for="auth-password">Password</label>
                 <input class="text-input" id="auth-password" type="password" autocomplete="current-password" minlength="12" placeholder="12+ characters">
                 <div class="auth-actions">
                   <button class="primary-button" data-account-action="login">Sign in</button>
                   <button class="secondary-button" data-account-action="register">Create account</button>
                 </div>
                 <div id="account-message" class="micro-note"></div>
               </div>
               <div class="panel-subsection">
                 <div class="eyebrow">PASSWORD RECOVERY</div>
                 <label class="field-label" for="reset-email">Account email</label>
                 <input class="text-input" id="reset-email" type="email" autocomplete="email" placeholder="you@example.com">
                 <button class="secondary-button full" data-account-action="request-reset">Send recovery request</button>
                 <label class="field-label" for="reset-token">Recovery token</label>
                 <input class="text-input" id="reset-token" type="password" autocomplete="one-time-code" placeholder="Paste the token you received">
                 <label class="field-label" for="reset-new-password">New password</label>
                 <input class="text-input" id="reset-new-password" type="password" autocomplete="new-password" minlength="12" placeholder="12+ characters">
                 <button class="secondary-button full" data-account-action="confirm-reset">Set new password</button>
               </div>`}
      </div>

      <div class="panel">
        <div class="eyebrow">ATHLETE PROFILE</div>
        <h3>Preferences that follow the product.</h3>
        <label class="field-label" for="display-name">Display name</label>
        <input class="text-input" id="display-name" maxlength="50" value="${state.settings.displayName.replace(/"/g, "&quot;")}">
        <label class="field-label" for="units">Weight units</label>
        <select class="text-input" id="units"><option value="kg" ${state.settings.units === "kg" ? "selected" : ""}>Kilograms (kg)</option><option value="lb" ${state.settings.units === "lb" ? "selected" : ""}>Pounds (lb)</option></select>
        <button class="primary-button" data-action="save-settings">Save preferences</button>
      </div>

      <div class="panel danger-panel">
        <div class="eyebrow">DATA CONTROL</div>
        <h3>${connected ? "Delete cloud account permanently." : "You own the local record."}</h3>
        <p>${connected ? "This permanently removes the cloud account and server-side workout data. Your local browser data remains available until you clear or export it." : "Beta workout data is stored only in this browser. Export it before clearing this device."}</p>
        <${connected
          ? `label class="field-label" for="delete-account-password">Confirm account password</label>
             <input class="text-input" id="delete-account-password" type="password" autocomplete="current-password" minlength="12" placeholder="Required to delete cloud account">
             <button class="danger-button full" data-account-action="delete-account">Delete cloud account</button>`
          : `button class="danger-button full" data-action="clear-data">Delete local data`}
        <button class="secondary-button full" data-action="export">Export my data ↓</button>
        <div class="micro-note">Cloud recovery delivery and server retention policies remain deployment-level production controls.</div>
      </div>
    </section>
  `;
}

function renderSessionList(sessions) {
  const target = document.querySelector("#auth-session-list");
  if (!target) return;
  if (!Array.isArray(sessions) || !sessions.length) {
    target.innerHTML = `<div class="micro-note">No active device sessions.</div>`;
    return;
  }
  target.innerHTML = sessions.map((session) => `
    <div class="session-row">
      <div>
        <strong>${session.isCurrent ? "This device" : "Other device"}</strong>
        <span class="micro-note">Created ${escapeHtml(new Date(session.created_at).toLocaleString("en-IN"))}</span>
      </div>
      ${session.status === "expired"
        ? `<span class="tag">EXPIRED</span>`
        : session.status === "revoked"
          ? `<span class="tag">REVOKED</span>`
          : session.isCurrent
            ? `<span class="tag">ACTIVE</span>`
            : `<button class="text-button" data-revoke-session="${escapeHtml(session.id)}">Revoke</button>`}
    </div>
  `).join("");
  target.querySelectorAll("[data-revoke-session]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    const sessionId = button.dataset.revokeSession;
    const result = await revokeAuthSession(sessionId);
    if (result.ok) {
      announce("Device session revoked.");
      await loadSessions();
    } else {
      announce(result.message);
    }
  }));
}

async function loadSessions() {
  if (!hasApi() || !hasAuth()) return;
  const result = await listAuthSessions();
  if (result.ok) renderSessionList(result.body?.sessions);
}

function announce(message) {
  const live = document.querySelector("#live-region");
  if (live) live.textContent = message;
  const toast = document.querySelector("#toast");
  if (toast) toast.textContent = message;
}

export function wireAccount({ render }) {
  document.querySelectorAll('[data-account-action="sign-out"]').forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    const result = await logout();
    render();
    window.dispatchEvent(new Event("gym:auth-changed"));
    announce(result.ok ? "Signed out." : "Signed out locally. The server session may already be expired.");
  }));

  document.querySelectorAll('[data-account-action="logout-all"]').forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("Sign out every device currently connected to this account?")) return;
    button.disabled = true;
    const result = await logoutAll();
    render();
    window.dispatchEvent(new Event("gym:auth-changed"));
    announce(result.ok ? "All device sessions were signed out." : result.message);
  }));

  document.querySelectorAll('[data-account-action="login"]').forEach((button) => button.addEventListener("click", async () => {
    const email = document.querySelector("#auth-email")?.value.trim();
    const password = document.querySelector("#auth-password")?.value;
    if (!email || !password) return announce("Enter email and password.");
    button.disabled = true;
    const result = await login(email, password);
    render();
    button.disabled = false;
    announce(result.ok ? "Signed in for this tab." : result.message);
    if (result.ok) window.dispatchEvent(new Event("gym:auth-changed"));
  }));

  document.querySelectorAll('[data-account-action="register"]').forEach((button) => button.addEventListener("click", async () => {
    const email = document.querySelector("#auth-email")?.value.trim();
    const password = document.querySelector("#auth-password")?.value;
    if (!email || !password) return announce("Enter email and password.");
    button.disabled = true;
    const result = await register(email, password);
    render();
    button.disabled = false;
    announce(result.ok ? "Account created and signed in." : result.message);
    if (result.ok) window.dispatchEvent(new Event("gym:auth-changed"));
  }));

  document.querySelectorAll('[data-account-action="request-reset"]').forEach((button) => button.addEventListener("click", async () => {
    const email = document.querySelector("#reset-email")?.value.trim() || document.querySelector("#auth-email")?.value.trim();
    if (!email) return announce("Enter your account email.");
    button.disabled = true;
    const result = await requestPasswordReset(email);
    button.disabled = false;
    announce(result.ok ? "If the account exists, recovery instructions will be sent." : result.message);
  }));

  document.querySelectorAll('[data-account-action="confirm-reset"]').forEach((button) => button.addEventListener("click", async () => {
    const token = document.querySelector("#reset-token")?.value.trim();
    const password = document.querySelector("#reset-new-password")?.value;
    if (!token || !password) return announce("Enter the recovery token and new password.");
    button.disabled = true;
    const result = await confirmPasswordReset(token, password);
    button.disabled = false;
    announce(result.ok ? "Password reset. Sign in again on your devices." : result.message);
  }));

  document.querySelectorAll('[data-account-action="delete-account"]').forEach((button) => button.addEventListener("click", async () => {
    const password = document.querySelector("#delete-account-password")?.value;
    if (!password) return announce("Enter your password to delete the cloud account.");
    if (!window.confirm("Permanently delete your cloud account and server-side training data? This cannot be undone.")) return;
    button.disabled = true;
    const result = await deleteAccount(password);
    if (result.ok) {
      render();
      window.dispatchEvent(new Event("gym:auth-changed"));
      announce("Cloud account deleted.");
    } else {
      button.disabled = false;
      announce(result.message);
    }
  }));

  void loadSessions();
}
