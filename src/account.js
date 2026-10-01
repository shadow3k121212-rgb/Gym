import { hasApi, hasAuth, login, logout, register } from "./api.js";

export function renderAccount(state) {
  const connected = hasApi() && hasAuth();
  return `
    <section class="settings-grid">
      <div class="panel cloud-panel">
        <div class="eyebrow">CLOUD SYNC · ${hasApi() ? "AVAILABLE" : "NOT CONFIGURED"}</div>
        <h3>${connected ? "Account connected." : "Local-first, with an optional cloud layer."}</h3>
        ${!hasApi() ? `<p>Deploy the API and set apiBaseUrl in public/runtime-config.js to enable account sync.</p>` : connected ? `<p>This browser has an active beta API session. Completed workouts can sync after local save.</p><button class="secondary-button" data-account-action="sign-out">Sign out</button>` : `<p>Create an account or sign in. Credentials are sent only to the configured GYM API.</p><div class="auth-form"><label class="field-label" for="auth-email">Email</label><input class="text-input" id="auth-email" type="email" autocomplete="email" placeholder="you@example.com"><label class="field-label" for="auth-password">Password</label><input class="text-input" id="auth-password" type="password" autocomplete="current-password" minlength="12" placeholder="12+ characters"><div class="auth-actions"><button class="primary-button" data-account-action="login">Sign in</button><button class="secondary-button" data-account-action="register">Create account</button></div><div id="account-message" class="micro-note"></div></div>`}
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
        <h3>You own the local record.</h3>
        <p>Beta workout data is stored only in this browser. Export it before clearing this device.</p>
        <button class="secondary-button full" data-action="export">Export my data ↓</button>
        <button class="danger-button full" data-action="clear-data">Delete local data</button>
        <div class="micro-note">Cloud account deletion and server-side retention controls are separate production requirements.</div>
      </div>
    </section>
  `;
}

export function wireAccount({ render, announce }) {
  document.querySelectorAll("[data-account-action=\"sign-out\"]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    const result = await logout();
    render();
    announce(result.ok ? "Signed out." : "Signed out locally. The server session may already be expired.");
  }));
  document.querySelectorAll("[data-account-action=\"login\"]").forEach((button) => button.addEventListener("click", async () => {
    const email = document.querySelector("#auth-email")?.value.trim();
    const password = document.querySelector("#auth-password")?.value;
    if (!email || !password) return announce("Enter email and password.");
    button.disabled = true;
    const result = await login(email, password);
    button.disabled = false;
    announce(result.ok ? "Signed in for this tab." : result.message);
    if (result.ok) { render(); window.dispatchEvent(new Event("gym:auth-changed")); }
  }));
  document.querySelectorAll("[data-account-action=\"register\"]").forEach((button) => button.addEventListener("click", async () => {
    const email = document.querySelector("#auth-email")?.value.trim();
    const password = document.querySelector("#auth-password")?.value;
    if (!email || !password) return announce("Enter email and password.");
    button.disabled = true;
    const result = await register(email, password);
    button.disabled = false;
    announce(result.ok ? "Account created and signed in." : result.message);
    if (result.ok) { render(); window.dispatchEvent(new Event("gym:auth-changed")); }
  }));
}
