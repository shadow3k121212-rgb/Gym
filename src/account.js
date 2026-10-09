import { summarizeSyncQueue } from "./sync-queue.js";
import {
  confirmPasswordReset,
  deleteAccount,
  getCurrentUserId,
  hasApi,
  hasAuth,
  listAuthSessions,
  login,
  logout,
  logoutAll,
  register,
  requestPasswordReset,
  revokeAuthSession,
  listTenants,
  createTenant,
  listTenantMembers,
  listTenantInvitations,
  createTenantInvitation,
  revokeTenantInvitation,
  acceptTenantInvitation
} from "./api.js";


let tenantStateUserId = null;
let tenantWorkspaces = [];
let selectedTenantId = null;
let tenantMembers = [];
let tenantInvitations = [];
let tenantMembersCursor = null;
let tenantInvitationsCursor = null;
let tenantDetailMessage = "";
let tenantActionMessage = "";
let tenantDevelopmentToken = null;
let tenantDevelopmentTokenTenantId = null;
let tenantListSequence = 0;
let tenantDetailSequence = 0;

function renderTenantManager() {
  return '<div class="panel-subsection tenant-manager" id="tenant-manager">' +
    '<div class="eyebrow">GYM WORKSPACES</div>' +
    '<h4>Gyms and memberships</h4>' +
    '<p class="micro-note">Your training history stays private. Gym membership unlocks workspace administration; coach access to athlete history is a separate permission layer.</p>' +
    '<div id="tenant-workspace-list" class="session-list"><div class="micro-note">Loading workspaces…</div></div>' +
    '<div class="tenant-create-form">' +
      '<div class="eyebrow">CREATE A GYM</div>' +
      '<label class="field-label" for="tenant-create-name">Gym or studio name</label>' +
      '<input class="text-input" id="tenant-create-name" maxlength="80" autocomplete="organization" placeholder="e.g. North Side Fitness">' +
      '<label class="field-label" for="tenant-create-slug">Workspace URL slug (optional)</label>' +
      '<input class="text-input" id="tenant-create-slug" maxlength="62" autocapitalize="none" spellcheck="false" placeholder="north-side-fitness">' +
      '<button class="secondary-button full" data-tenant-action="create-workspace">Create gym workspace</button>' +
    '</div>' +
    '<div id="tenant-workspace-detail" class="tenant-workspace-detail"><div class="micro-note">Choose a workspace to view its members and invitations.</div></div>' +
    '<div class="tenant-accept-form">' +
      '<div class="eyebrow">JOIN A GYM</div>' +
      '<label class="field-label" for="tenant-accept-token">Invitation token</label>' +
      '<input class="text-input" id="tenant-accept-token" autocomplete="off" spellcheck="false" placeholder="Paste the invitation token">' +
      '<button class="secondary-button full" data-tenant-action="accept-invitation">Accept invitation</button>' +
    '</div>' +
    '<div id="tenant-manager-message" class="micro-note" role="status" aria-live="polite"></div>' +
  '</div>';
}

function renderTenantWorkspaceList() {
  const target = document.querySelector("#tenant-workspace-list");
  if (!target) return;
  if (!tenantWorkspaces.length) {
    target.innerHTML = '<div class="micro-note">No workspace memberships yet. Create a gym below or accept an invitation.</div>';
    return;
  }
  target.innerHTML = tenantWorkspaces.map((tenant) => {
    const selected = selectedTenantId === tenant.id;
    return '<div class="session-row tenant-workspace-row"><div>' +
      '<strong>' + escapeHtml(tenant.name) + '</strong>' +
      '<span class="micro-note">' + (tenant.kind === "gym" ? "GYM WORKSPACE" : "PERSONAL WORKSPACE") +
      ' · ' + escapeHtml(tenant.role) + ' · ' + escapeHtml(tenant.membership_status) + '</span>' +
      (tenant.kind === "gym" ? '<span class="micro-note">/' + escapeHtml(tenant.slug) + '</span>' : '') +
      '</div>' +
      (selected ? '<span class="tag">SELECTED</span>' :
        '<button class="text-button" data-tenant-action="select-workspace" data-tenant-id="' + escapeHtml(tenant.id) + '">Manage</button>') +
      '</div>';
  }).join("");
}

async function loadTenantWorkspaces() {
  const listTarget = document.querySelector("#tenant-workspace-list");
  if (!listTarget || !hasApi() || !hasAuth()) return;
  const userId = getCurrentUserId();
  if (tenantStateUserId !== userId) {
    tenantStateUserId = userId;
    tenantWorkspaces = [];
    selectedTenantId = null;
    tenantMembers = [];
    tenantInvitations = [];
    tenantMembersCursor = null;
    tenantInvitationsCursor = null;
    tenantDetailMessage = "";
    tenantActionMessage = "";
    tenantDevelopmentToken = null;
    tenantDevelopmentTokenTenantId = null;
  }
  const sequence = ++tenantListSequence;
  listTarget.innerHTML = '<div class="micro-note">Loading workspaces…</div>';
  const result = await listTenants();
  if (sequence !== tenantListSequence || tenantStateUserId !== getCurrentUserId()) return;
  if (!result.ok || !Array.isArray(result.body?.tenants)) {
    listTarget.innerHTML = '<div class="micro-note">' + escapeHtml(result.message || "Could not load workspaces.") + '</div>';
    return;
  }
  tenantWorkspaces = result.body.tenants;
  if (!tenantWorkspaces.some((tenant) => tenant.id === selectedTenantId)) {
    selectedTenantId = (tenantWorkspaces.find((tenant) => tenant.kind === "gym") || tenantWorkspaces[0] || {}).id || null;
  }
  renderTenantWorkspaceList();
  if (selectedTenantId) await loadTenantWorkspaceDetail(selectedTenantId);
  else renderTenantWorkspaceDetail();
}

async function loadTenantWorkspaceDetail(tenantId) {
  selectedTenantId = tenantId;
  const tenant = tenantWorkspaces.find((item) => item.id === tenantId);
  tenantMembers = [];
  tenantInvitations = [];
  tenantMembersCursor = null;
  tenantInvitationsCursor = null;
  tenantDetailMessage = "";
  tenantActionMessage = "";
  tenantDevelopmentToken = null;
  tenantDevelopmentTokenTenantId = null;
  renderTenantWorkspaceList();
  const sequence = ++tenantDetailSequence;
  if (!tenant) {
    renderTenantWorkspaceDetail();
    return;
  }
  if (tenant.kind !== "gym" || !["owner", "admin"].includes(tenant.role)) {
    renderTenantWorkspaceDetail();
    return;
  }
  const results = await Promise.all([
    listTenantMembers(tenantId, 50),
    listTenantInvitations(tenantId, 50)
  ]);
  if (sequence !== tenantDetailSequence || selectedTenantId !== tenantId) return;
  const membersResult = results[0];
  const invitationsResult = results[1];
  if (membersResult.ok) {
    tenantMembers = Array.isArray(membersResult.body?.members) ? membersResult.body.members : [];
    tenantMembersCursor = membersResult.body?.nextCursor || null;
  } else {
    tenantDetailMessage = membersResult.message || "Could not load workspace roster.";
  }
  if (invitationsResult.ok) {
    tenantInvitations = Array.isArray(invitationsResult.body?.invitations) ? invitationsResult.body.invitations : [];
    tenantInvitationsCursor = invitationsResult.body?.nextCursor || null;
  } else if (!tenantDetailMessage) {
    tenantDetailMessage = invitationsResult.message || "Could not load workspace invitations.";
  }
  renderTenantWorkspaceDetail();
}

function renderTenantWorkspaceDetail() {
  const target = document.querySelector("#tenant-workspace-detail");
  if (!target) return;
  const tenant = tenantWorkspaces.find((item) => item.id === selectedTenantId);
  if (!tenant) {
    target.innerHTML = '<div class="micro-note">Create a gym workspace or join one using an invitation.</div>';
    return;
  }
  if (tenant.kind !== "gym") {
    target.innerHTML = '<div class="tenant-detail-heading"><div class="eyebrow">PERSONAL WORKSPACE</div>' +
      '<h4>' + escapeHtml(tenant.name) + '</h4></div>' +
      '<p class="micro-note">This is your private workspace. Create a gym workspace if you need a team roster and invitations. Personal workout history is not shared automatically.</p>';
    return;
  }
  if (!["owner", "admin"].includes(tenant.role)) {
    target.innerHTML = '<div class="tenant-detail-heading"><div class="eyebrow">GYM WORKSPACE</div>' +
      '<h4>' + escapeHtml(tenant.name) + '</h4><span class="tag">' + escapeHtml(tenant.role) + '</span></div>' +
      '<p class="micro-note">You are a workspace member. Only an owner or admin can view the roster or manage invitations.</p>';
    return;
  }

  const roleOptions = tenant.role === "owner"
    ? '<option value="member">Member</option><option value="coach">Coach</option><option value="admin">Admin</option>'
    : '<option value="member">Member</option><option value="coach">Coach</option>';
  const memberRows = tenantMembers.length ? tenantMembers.map((member) =>
    '<div class="session-row"><div><strong>' + escapeHtml(member.email) + '</strong>' +
    '<span class="micro-note">' + escapeHtml(member.role) + ' · ' + escapeHtml(member.membership_status) + '</span></div>' +
    '<span class="tag">' + escapeHtml(member.membership_status).toUpperCase() + '</span></div>'
  ).join("") : '<div class="micro-note">No members found on this page.</div>';
  const invitationRows = tenantInvitations.length ? tenantInvitations.map((invite) =>
    '<div class="session-row"><div><strong>' + escapeHtml(invite.email) + '</strong>' +
    '<span class="micro-note">' + escapeHtml(invite.role) + ' · expires ' +
    escapeHtml(new Date(invite.expires_at).toLocaleDateString("en-IN")) + '</span></div>' +
    '<div class="tenant-row-actions"><span class="tag">' + escapeHtml(invite.status).toUpperCase() + '</span>' +
    (invite.status === "pending" ? '<button class="text-button" data-tenant-action="revoke-invitation" data-invitation-id="' +
      escapeHtml(invite.id) + '">Revoke</button>' : '') +
    '</div></div>'
  ).join("") : '<div class="micro-note">No invitations yet.</div>';

  target.innerHTML = '<div class="tenant-detail-heading"><div class="eyebrow">WORKSPACE ADMIN</div>' +
    '<h4>' + escapeHtml(tenant.name) + '</h4><span class="micro-note">' +
    escapeHtml(tenant.role) + ' access · ' + escapeHtml(tenant.slug) + '</span></div>' +
    (tenantDetailMessage ? '<div class="micro-note" role="status">' + escapeHtml(tenantDetailMessage) + '</div>' : '') +
    (tenantActionMessage ? '<div class="tenant-action-message" role="status">' + escapeHtml(tenantActionMessage) + '</div>' : '') +
    '<div class="tenant-section-head"><strong>Members</strong><span class="micro-note">' + tenantMembers.length + ' loaded</span></div>' +
    '<div class="tenant-list">' + memberRows + '</div>' +
    (tenantMembersCursor ? '<button class="text-button" data-tenant-action="more-members">Load more members</button>' : '') +
    '<div class="tenant-section-head"><strong>Invitations</strong><span class="micro-note">' + tenantInvitations.length + ' loaded</span></div>' +
    '<div class="tenant-list">' + invitationRows + '</div>' +
    (tenantInvitationsCursor ? '<button class="text-button" data-tenant-action="more-invitations">Load more invitations</button>' : '') +
    '<div class="tenant-invite-form"><div class="eyebrow">INVITE SOMEONE</div>' +
    '<label class="field-label" for="tenant-invite-email">Invitee email</label>' +
    '<input class="text-input" id="tenant-invite-email" type="email" autocomplete="off" placeholder="person@example.com">' +
    '<label class="field-label" for="tenant-invite-role">Workspace role</label>' +
    '<select class="text-input" id="tenant-invite-role">' + roleOptions + '</select>' +
    '<button class="secondary-button full" data-tenant-action="send-invitation">Send invitation</button>' +
    (tenantDevelopmentToken && tenantDevelopmentTokenTenantId === tenant.id
      ? '<label class="field-label" for="tenant-development-token">Development invitation token</label>' +
        '<input class="text-input" id="tenant-development-token" value="' + escapeHtml(tenantDevelopmentToken) + '" readonly>' +
        '<button class="secondary-button full" data-tenant-action="copy-development-token">Copy token</button>' +
        '<p class="micro-note">Development only: paste this token into the invitee\'s Join a Gym section while signed in with the invited email.</p>'
      : '') +
    '</div>';
}

async function loadMoreTenantMembers() {
  if (!selectedTenantId || !tenantMembersCursor) return;
  const tenantId = selectedTenantId;
  const result = await listTenantMembers(tenantId, 50, tenantMembersCursor);
  if (!result.ok) return announce(result.message || "Could not load more members.");
  if (selectedTenantId !== tenantId) return;
  tenantMembers = tenantMembers.concat(result.body?.members || []);
  tenantMembersCursor = result.body?.nextCursor || null;
  renderTenantWorkspaceDetail();
}

async function loadMoreTenantInvitations() {
  if (!selectedTenantId || !tenantInvitationsCursor) return;
  const tenantId = selectedTenantId;
  const result = await listTenantInvitations(tenantId, 50, tenantInvitationsCursor);
  if (!result.ok) return announce(result.message || "Could not load more invitations.");
  if (selectedTenantId !== tenantId) return;
  tenantInvitations = tenantInvitations.concat(result.body?.invitations || []);
  tenantInvitationsCursor = result.body?.nextCursor || null;
  renderTenantWorkspaceDetail();
}

async function handleTenantAction(button) {
  const action = button.dataset.tenantAction;
  button.disabled = true;
  try {
    if (action === "select-workspace") {
      await loadTenantWorkspaceDetail(button.dataset.tenantId);
      return;
    }
    if (action === "create-workspace") {
      const name = document.querySelector("#tenant-create-name")?.value.trim();
      const slug = document.querySelector("#tenant-create-slug")?.value.trim();
      if (!name) return announce("Enter a gym or studio name.");
      const result = await createTenant(name, slug || null);
      if (!result.ok) return announce(result.message || "Workspace could not be created.");
      document.querySelector("#tenant-create-name").value = "";
      document.querySelector("#tenant-create-slug").value = "";
      selectedTenantId = result.body?.tenant?.id || null;
      await loadTenantWorkspaces();
      if (selectedTenantId) await loadTenantWorkspaceDetail(selectedTenantId);
      announce("Gym workspace created. You are its owner.");
      return;
    }
    if (action === "send-invitation") {
      const email = document.querySelector("#tenant-invite-email")?.value.trim();
      const role = document.querySelector("#tenant-invite-role")?.value;
      if (!selectedTenantId || !email || !role) return announce("Enter an email and choose a workspace role.");
      const result = await createTenantInvitation(selectedTenantId, email, role);
      if (!result.ok) {
        await loadTenantWorkspaceDetail(selectedTenantId);
        tenantActionMessage = result.message || "Invitation could not be sent.";
        renderTenantWorkspaceDetail();
        return announce(tenantActionMessage);
      }
      const developmentToken = typeof result.body?.developmentToken === "string" ? result.body.developmentToken : null;
      await loadTenantWorkspaceDetail(selectedTenantId);
      tenantDevelopmentToken = developmentToken;
      tenantDevelopmentTokenTenantId = developmentToken ? selectedTenantId : null;
      tenantActionMessage = developmentToken
        ? "Invitation saved for " + email + ". Copy the development token below to complete the test flow."
        : "Invitation email queued for " + email + ".";
      renderTenantWorkspaceDetail();
      announce(tenantActionMessage);
      return;
    }
    if (action === "revoke-invitation") {
      const invitationId = button.dataset.invitationId;
      if (!selectedTenantId || !invitationId) return;
      if (!window.confirm("Revoke this invitation? The token will no longer work.")) return;
      const result = await revokeTenantInvitation(selectedTenantId, invitationId);
      if (!result.ok) return announce(result.message || "Invitation could not be revoked.");
      await loadTenantWorkspaceDetail(selectedTenantId);
      tenantActionMessage = "Invitation revoked.";
      renderTenantWorkspaceDetail();
      announce(tenantActionMessage);
      return;
    }
    if (action === "accept-invitation") {
      const token = document.querySelector("#tenant-accept-token")?.value.trim();
      if (!token) return announce("Paste an invitation token.");
      const result = await acceptTenantInvitation(token);
      if (!result.ok) return announce(result.message || "Invitation could not be accepted.");
      const acceptedTenantId = result.body?.tenant?.id || null;
      document.querySelector("#tenant-accept-token").value = "";
      selectedTenantId = acceptedTenantId;
      await loadTenantWorkspaces();
      if (acceptedTenantId) await loadTenantWorkspaceDetail(acceptedTenantId);
      announce("Invitation accepted. You are now a workspace member.");
      return;
    }
    if (action === "more-members") {
      await loadMoreTenantMembers();
      return;
    }
    if (action === "more-invitations") {
      await loadMoreTenantInvitations();
      return;
    }
    if (action === "copy-development-token") {
      if (!tenantDevelopmentToken) return;
      try {
        await navigator.clipboard.writeText(tenantDevelopmentToken);
      } catch {
        const input = document.querySelector("#tenant-development-token");
        input?.select();
        document.execCommand?.("copy");
      }
      announce("Development invitation token copied.");
    }
  } catch {
    announce("Workspace operation failed. Retry and check your connection.");
  } finally {
    button.disabled = false;
  }
}

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
               ${renderSyncRecovery(state)}
               ${renderTenantManager()}
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

function renderSyncRecovery(state) {
  const currentUserId = getCurrentUserId();
  const queue = Array.isArray(state?.syncQueue) ? state.syncQueue : [];
  const pending = currentUserId
    ? queue.filter((item) => item && item.userId === currentUserId && item.session?.id)
    : [];
  const legacy = queue.filter((item) => item && !item.userId && item.session?.id);
  const blocked = pending.filter((item) => item.blocked);
  const recovery = summarizeSyncQueue(queue, { userId:currentUserId });
  if (!pending.length && !legacy.length) return "";
  return `
    ${pending.length ? `
      <div class="panel-subsection">
        <div class="eyebrow">CLOUD RECOVERY</div>
        <strong>${pending.length} workout${pending.length === 1 ? "" : "s"} retained for sync.</strong>
        <div class="micro-note">${recovery.dueCount} ready to sync · ${recovery.scheduledCount} waiting for retry · ${blocked.length} need manual retry.</div>
        <div class="micro-note">${blocked.length
          ? "Blocked workouts stay on this device after a permanent rejection; use Retry after reviewing the error."
          : "Transient failures retry automatically with bounded backoff."}</div>
        ${recovery.staleCount ? `
          <div class="micro-note" role="status">${recovery.staleCount} workout${recovery.staleCount === 1 ? " has" : "s have"} been pending for more than 24 hours. Nothing is automatically deleted; export your data if sync remains unresolved.</div>
        ` : ""}
        ${recovery.oldestPendingAt ? `
          <div class="micro-note">Oldest pending workout: ${escapeHtml(new Date(recovery.oldestPendingAt).toLocaleString("en-IN"))}</div>
        ` : ""}
        ${blocked.length ? blocked.map((item) => `
          <div class="session-row">
            <div>
              <strong>${escapeHtml(item.session.name || "Workout")}</strong>
              <span class="micro-note">${escapeHtml(item.lastError || "Manual retry required.")}</span>
              <span class="micro-note">${item.lastAttemptAt
                ? "Last attempt " + escapeHtml(new Date(item.lastAttemptAt).toLocaleString("en-IN"))
                : "Not attempted yet"} · ${item.attempts || 0} automatic retry attempts</span>
            </div>
            <button class="text-button" data-retry-sync="${escapeHtml(item.session.id)}">Retry</button>
          </div>`).join("") : ""}
      </div>
    ` : ""}
    ${legacy.length ? `
      <div class="panel-subsection">
        <div class="eyebrow">LOCAL-ONLY RECOVERY</div>
        <strong>${legacy.length} older workout${legacy.length === 1 ? "" : "s"} are not linked to an account.</strong>
        <div class="micro-note">They remain safely local and will never be auto-assigned to the signed-in account. Export your data before any manual migration.</div>
        <button class="secondary-button full" data-action="export">Export local data</button>
      </div>
    ` : ""}
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

export function wireAccount({ render, retrySync }) {
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

  document.querySelectorAll("[data-retry-sync]").forEach((button) => button.addEventListener("click", async () => {
    if (typeof retrySync !== "function") return;
    button.disabled = true;
    const sessionId = button.dataset.retrySync;
    const result = await retrySync(sessionId);
    if (result?.ok) {
      render();
      announce("Pending workout retry released.");
    } else {
      button.disabled = false;
      announce(result?.message || "Could not release the pending workout retry.");
    }
  }));

  const tenantManager = document.querySelector("#tenant-manager");
  tenantManager?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tenant-action]");
    if (button) void handleTenantAction(button);
  });

  void loadSessions();
  void loadTenantWorkspaces();
}
