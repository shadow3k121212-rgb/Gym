import { EXERCISES, SAMPLE_HISTORY, WORKOUT, createEmptySession, getExercise } from "./data.js";
import { hasApi, hasAuth, listCloudSessions, syncSession } from "./api.js";
import { renderAccount, wireAccount } from "./account.js";
import { clearState, defaultState, exportState, loadState, persistState } from "./storage.js";
import {
  estimateOneRepMax,
  getNextOpenSet,
  summarizeSession,
  suggestProgression
} from "./workout-engine.js";
import { displayUnit, toDisplayVolume, toDisplayWeight, toKg, weightInputStep } from "./units.js";
import { mergeHistory } from "./history-sync.js";

const REST_SECONDS = 90;
let state = loadState();
let restTimer = null;
let restRemaining = 0;
let lastSetAction = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function save() {
  const ok = persistState(state);
  if (!ok) announce("GYM could not save this change on this device. Try again.");
  return ok;
}

function commitState(mutator) {
  const previous = structuredClone(state);
  try {
    mutator();
  } catch (error) {
    state = previous;
    console.error("GYM state mutation error", error);
    announce("GYM could not apply that change. Your current session was restored.");
    return false;
  }
  if (save()) return true;
  state = previous;
  return false;
}

async function refreshCloudHistory() {
  if (!hasApi() || !hasAuth()) return;
  const result = await listCloudSessions(50);
  if (!result.ok || !Array.isArray(result.body?.sessions)) return;
  const merged = mergeHistory(state.history, result.body.sessions);
  if (JSON.stringify(merged) !== JSON.stringify(state.history)) {
    state.history = merged;
    state.sampleData = false;
    save();
    render();
  }
}

async function flushSyncQueue() {
  if (hasApi() && hasAuth() && state.syncQueue?.length) {
    for (const session of [...state.syncQueue]) {
      const result = await syncSession(session);
      if (!result.ok) break;
      state.syncQueue = state.syncQueue.filter((item) => item.id !== session.id);
      save();
    }
  }
  await refreshCloudHistory();
}

function todayLabel() {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short" }).format(new Date());
}

function formatNumber(value, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits }).format(Number(value) || 0);
}

function unit() {
  return displayUnit(state.settings.units);
}

function displayWeight(weightKg, digits = 1) {
  return formatNumber(toDisplayWeight(weightKg, unit()), digits);
}

function displayVolume(volumeKg, digits = 0) {
  return formatNumber(toDisplayVolume(volumeKg, unit()), digits);
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function icon(name) {
  const paths = {
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
    chart: '<path d="M4 19V5M4 19h16M8 16v-4M12 16V7M16 16v-8"/>',
    dumbbell: '<path d="M5 8v8M2 10v4M8 10h8M19 8v8M22 10v4M8 8v8M16 8v8"/>',
    settings: '<path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/><circle cx="12" cy="12" r="4"/>',
    play: '<path d="m9 6 10 6-10 6Z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 6v12M16 6v12"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/>',
    trash: '<path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.grid}</svg>`;
}

function navItem(view, label, iconName) {
  return `<button class="nav-item ${state.activeView === view ? "is-active" : ""}" data-view="${view}">
    ${icon(iconName)}<span>${label}</span>
  </button>`;
}

function currentSession() {
  return state.session || createEmptySession();
}

function currentExercises() {
  return currentSession().exercises.map((entry) => ({
    ...getExercise(entry.exerciseId),
    sets: entry.sets
  }));
}

function realHistory() {
  return Array.isArray(state.history) ? state.history.filter((entry) => entry.source !== "sample") : [];
}

function chartHistory() {
  const history = realHistory();
  return history.length ? history.slice(-7) : SAMPLE_HISTORY;
}

function sessionSummary() {
  return summarizeSession(currentExercises());
}

function startSession() {
  const committed = commitState(() => {
    if (!state.session) state.session = createEmptySession();
    state.activeView = "workout";
  });
  if (committed) render();
}

async function finishSession() {
  if (!state.session) return;
  const summary = sessionSummary();
  if (summary.completedSets === 0) {
    announce("Complete at least one set before finishing.");
    return;
  }
  if (summary.completedSets < summary.totalSets) {
    const confirmed = window.confirm("Only " + summary.completedSets + " of " + summary.totalSets + " planned sets are complete. Save this partial session?");
    if (!confirmed) return;
  }

  const completedAt = new Date().toISOString();
  const previous = structuredClone(state);
  const finishedSession = structuredClone(state.session);
  finishedSession.completedAt = completedAt;
  state.session.completedAt = completedAt;
  state.history = [...realHistory(), {
    id: state.session.id,
    date: completedAt.slice(0, 10),
    name: state.session.name,
    volumeKg: Math.round(summary.volumeKg * 10) / 10,
    sets: summary.completedSets,
    source: "manual"
  }];
  state.session = null;
  state.activeView = "dashboard";
  state.sampleData = false;

  if (!save()) {
    state = previous;
    render();
    return;
  }

  stopRestTimer();
  lastSetAction = null;
  announce("Session saved. Your progress is now part of your training history.");
  render();

  if (hasApi() && hasAuth()) {
    const sync = await syncSession(finishedSession);
    if (sync.ok) {
      state.syncQueue = (state.syncQueue || []).filter((item) => item.id !== finishedSession.id);
      if (save()) announce("Session saved locally and synced.");
    } else {
      state.syncQueue = [
        ...(state.syncQueue || []).filter((item) => item.id !== finishedSession.id),
        finishedSession
      ].slice(-20);
      save();
      announce("Session saved locally. Cloud sync queued for the next connection.");
    }
  }
}

function updateSet(exerciseId, setIndex, field, value) {
  if (!state.session) return;
  commitState(() => {
    const entry = state.session.exercises.find((item) => item.exerciseId === exerciseId);
    const set = entry?.sets[setIndex];
    if (!set) return;

    if (field === "reps") {
      const next = Number(value);
      set.reps = Number.isFinite(next) ? Math.max(0, Math.min(1000, next)) : set.reps;
    }
    if (field === "weightKg") {
      const next = Number(value);
      if (Number.isFinite(next)) set.weightKg = Math.max(0, Math.min(1000, toKg(next, unit())));
    }
    if (field === "rpe") {
      const next = value === "" ? null : Number(value);
      set.rpe = next === null ? null : (Number.isFinite(next) ? Math.max(1, Math.min(10, next)) : set.rpe);
    }
  });
}

function toggleSet(exerciseId, setIndex) {
  if (!state.session) return;
  const entry = state.session.exercises.find((item) => item.exerciseId === exerciseId);
  const set = entry?.sets[setIndex];
  if (!set) return;

  const previous = { exerciseId, setIndex, completed: set.completed, completedAt: set.completedAt };
  const committed = commitState(() => {
    set.completed = !set.completed;
    set.completedAt = set.completed ? new Date().toISOString() : null;
  });
  if (!committed) return;

  lastSetAction = previous.completed ? null : previous;
  if (set.completed) startRestTimer();
  render();
  announce(set.completed ? "Set " + set.index + " completed. Rest timer started." : "Set " + set.index + " marked incomplete.");
}

function undoLastSetAction() {
  if (!state.session || !lastSetAction) return;
  const action = lastSetAction;
  const committed = commitState(() => {
    const entry = state.session.exercises.find((item) => item.exerciseId === action.exerciseId);
    const set = entry?.sets[action.setIndex];
    if (!set) return;
    set.completed = action.completed;
    set.completedAt = action.completedAt;
  });
  if (!committed) return;
  lastSetAction = null;
  stopRestTimer();
  render();
  announce("Last set action was undone.");
}

function startRestTimer() {
  stopRestTimer();
  restRemaining = REST_SECONDS;
  restTimer = setInterval(() => {
    restRemaining -= 1;
    if (restRemaining <= 0) stopRestTimer();
    updateRestUI();
  }, 1000);
  updateRestUI();
}

function stopRestTimer() {
  if (restTimer) clearInterval(restTimer);
  restTimer = null;
  restRemaining = 0;
  updateRestUI();
}

function updateRestUI() {
  const timer = document.querySelector("[data-rest-timer]");
  if (!timer) return;
  timer.textContent = restRemaining > 0 ? formatDuration(restRemaining) : "READY";
  timer.parentElement?.classList.toggle("is-running", restRemaining > 0);
}

function announce(message) {
  const live = document.querySelector("#live-region");
  if (live) live.textContent = message;
}

function renderShell(content) {
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
          <div><strong>GYM</strong><small>TRAINING OS</small></div>
        </div>
        <nav class="side-nav" aria-label="Primary">
          ${navItem("dashboard", "Overview", "grid")}
          ${navItem("workout", "Workout", "bolt")}
          ${navItem("progress", "Progress", "chart")}
          ${navItem("library", "Exercises", "dumbbell")}
        </nav>
        <div class="sidebar-card">
          <span class="eyebrow">PRODUCT MODE</span>
          <strong>Training memory</strong>
          <p>Your session data stays in this browser in beta. Optional cloud sync uses the authenticated API when configured.</p>
          <span class="status-dot">LOCAL-FIRST BETA</span>
        </div>
        <div class="sidebar-foot">GYM · BETA 0.2</div>
      </aside>

      <main class="main-content">
        <header class="topbar">
          <div>
            <div class="eyebrow">${escapeHtml(todayLabel()).toUpperCase()} · LOCAL BETA</div>
            <h1>${state.activeView === "dashboard" ? "Control your training." : viewTitle()}</h1>
          </div>
          <div class="top-actions">
            <button class="icon-button" title="Export your data" data-action="export" aria-label="Export your data">${icon("download")}</button>
            <button class="avatar" data-view="settings" aria-label="Open settings">${escapeHtml(state.settings.displayName.slice(0,1).toUpperCase())}</button>
          </div>
        </header>
        ${content}
      </main>

      <nav class="mobile-nav" aria-label="Mobile primary">
        ${navItem("dashboard", "Overview", "grid")}
        ${navItem("workout", "Workout", "bolt")}
        ${navItem("progress", "Progress", "chart")}
        ${navItem("library", "Exercises", "dumbbell")}
      </nav>
    </div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <div id="live-region" class="sr-only" aria-live="polite"></div>
  `;
}

function viewTitle() {
  return ({
    workout: "Today’s training.",
    progress: "Your signal, over time.",
    library: "The movement library.",
    settings: "Your training preferences."
  })[state.activeView] || "Control your training.";
}

function dashboard() {
  const session = state.session ? sessionSummary() : null;
  const history = realHistory();
  const totalVolume = history.reduce((sum, item) => sum + Number(item.volumeKg || 0), 0);
  const displayHistory = chartHistory();
  const max = Math.max(...displayHistory.map((item) => Number(item.volumeKg || 0)), 1);

  return renderShell(`
    <section class="hero-grid">
      <article class="hero-card">
        <div class="hero-copy">
          <div class="eyebrow">TODAY’S SESSION</div>
          <h2>Upper Strength<span>.</span></h2>
          <p>Train with less friction. Log the set once, keep the record forever, and let the data layer grow with you.</p>
          <div class="hero-meta">
            <span><b>04</b> movements</span>
            <span><b>14</b> target sets</span>
            <span><b>~54</b> min</span>
          </div>
          <button class="primary-button" data-action="start">
            ${state.session ? "Resume workout" : "Start workout"} ${icon("arrow")}
          </button>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="ring ring-outer"></div><div class="ring ring-mid"></div><div class="ring ring-inner"></div>
          <div class="ring-core"><span>${session ? Math.round(session.completion * 100) : 0}%</span><small>${session ? "ACTIVE" : "READY"}</small></div>
        </div>
      </article>

      <article class="stat-card">
        <div class="eyebrow">${history.length ? "YOUR RECORDED LOAD" : "WEEKLY LOAD · SAMPLE"}</div>
        <div class="stat-number">${displayVolume((history.length ? totalVolume : displayHistory.reduce((sum, item) => sum + Number(item.volumeKg || 0), 0)) / 1000, 1)}k</div>
        <div class="stat-caption">${unit()} moved ${history.length ? "across saved sessions" : "in preview data"}</div>
        <div class="mini-bars">
          ${displayHistory.map((item) => `
            <div class="bar-wrap" title="${escapeHtml(item.date || "")}">
              <div class="bar" style="height:${Math.max(7, (Number(item.volumeKg || 0) / max) * 100)}%"></div>
              <span>${escapeHtml(item.date ? item.date.slice(5) : "")}</span>
            </div>`).join("")}
        </div>
      </article>
    </section>

    <section class="section-grid">
      <div class="panel">
        <div class="panel-head">
          <div><div class="eyebrow">TRAINING PULSE</div><h3>${history.length ? "Your history is becoming the signal." : "Your first session creates the baseline."}</h3></div>
          <span class="tag">${history.length ? "RECORDED" : "BETA"}</span>
        </div>
        <div class="metric-row">
          <div><span class="metric-value">${history.length}</span><span class="metric-label">saved sessions</span></div>
          <div><span class="metric-value">${history.length ? displayVolume(totalVolume / history.length / 1000, 1) + "k" : "—"}</span><span class="metric-label">avg session volume</span></div>
          <div><span class="metric-value">${history.length ? Math.max(...history.map((item) => Number(item.sets || 0))) : "—"}</span><span class="metric-label">best set count</span></div>
        </div>
        <div class="progress-line"><span style="width:${Math.min(100, history.length ? Math.max(8, history.length * 8) : 0)}%"></span></div>
        <div class="micro-note">${history.length ? "Real logged sessions are now the source of truth for this device." : "Illustrative values are isolated from your real history and will disappear once you log your first session."}</div>
      </div>

      <div class="panel insight-panel">
        <div class="eyebrow">COACH SIGNAL · FOUNDATION</div>
        <h3>${state.session ? "Finish the session cleanly. The signal starts with complete sets." : history.length ? "Your next useful feature is consistency, not more noise." : "No AI theatre. Build the data foundation first."}</h3>
        <p>Manual logs are the trusted source today. Future camera and wearable events can attach to the same versioned movement-event contract.</p>
        <button class="text-button" data-view="progress">See progress ${icon("arrow")}</button>
      </div>
    </section>

    <section class="panel exercise-preview">
      <div class="panel-head">
        <div><div class="eyebrow">SESSION BLUEPRINT</div><h3>Upper Strength</h3></div>
        <button class="text-button" data-action="start">Open workout ${icon("arrow")}</button>
      </div>
      <div class="exercise-list">
        ${WORKOUT.map((id, index) => {
          const exercise = getExercise(id);
          return `
            <div class="exercise-row">
              <div class="exercise-index">0${index + 1}</div>
              <div class="exercise-main"><strong>${escapeHtml(exercise.name)}</strong><span>${escapeHtml(exercise.muscle)} · ${exercise.targetSets} × ${exercise.targetReps}</span></div>
              <div class="exercise-load">${exercise.loadKg ? displayWeight(exercise.loadKg, 1) + " " + unit() : "BW"}</div>
            </div>`;
        }).join("")}
      </div>
    </section>
  `);
}

function workoutView() {
  if (!state.session) {
    return renderShell(`
      <section class="empty-state panel">
        <div class="empty-icon">${icon("bolt")}</div>
        <div class="eyebrow">NO ACTIVE SESSION</div>
        <h2>Start when you’re ready.</h2>
        <p>Your session will be saved locally as you move. You can export it at any time.</p>
        <button class="primary-button" data-action="start">Start Upper Strength ${icon("arrow")}</button>
      </section>
    `);
  }

  const exercises = currentExercises();
  const summary = sessionSummary();
  const next = (() => {
    for (const exercise of exercises) {
      const open = getNextOpenSet(exercise);
      if (open) return { exercise, open };
    }
    return null;
  })();

  return renderShell(`
    <section class="workout-layout">
      <div class="panel workout-main">
        <div class="panel-head">
          <div><div class="eyebrow">LIVE SESSION · MANUAL</div><h3>${escapeHtml(state.session.name)}</h3></div>
          <span class="session-status">${Math.round(summary.completion * 100)}% COMPLETE</span>
        </div>

        <div class="session-progress"><span style="width:${summary.completion * 100}%"></span></div>

        ${next ? `<div class="next-set-banner">
          <div><span class="eyebrow">UP NEXT</span><strong>${escapeHtml(next.exercise.name)} · Set ${next.exercise.sets.findIndex((set) => !set.completed) + 1}</strong></div>
          <span class="next-load">${next.open.weightKg ? displayWeight(next.open.weightKg, 1) + " " + unit() : "BODYWEIGHT"}</span>
        </div>` : `<div class="next-set-banner is-done"><div><span class="eyebrow">SESSION TARGET</span><strong>All planned sets complete.</strong></div><span class="next-load">READY TO FINISH</span></div>`}

        <div class="set-list">
          ${exercises.map((exercise, exerciseIndex) => `
            <article class="set-card">
              <div class="set-number">0${exerciseIndex + 1}</div>
              <div class="set-content">
                <div class="set-title">
                  <div><strong>${escapeHtml(exercise.name)}</strong><span>${escapeHtml(exercise.muscle)} · ${exercise.targetSets} × ${exercise.targetReps}</span></div>
                  <b>${exercise.loadKg ? displayWeight(exercise.loadKg, 1) + " " + unit() + " base" : "BODYWEIGHT"}</b>
                </div>

                <div class="set-table-head"><span>SET</span><span>REPS</span><span>LOAD</span><span>RPE</span><span>DONE</span></div>

                ${exercise.sets.map((set, setIndex) => `
                  <div class="set-row ${set.completed ? "is-complete" : ""}">
                    <span class="set-index">${set.index}</span>
                    <input class="set-input" inputmode="numeric" type="number" min="0" max="1000" value="${escapeHtml(set.reps)}" data-input="reps" data-exercise="${exercise.id}" data-set="${setIndex}" aria-label="${escapeHtml(exercise.name)} set ${set.index} reps">
                    <input class="set-input" inputmode="decimal" type="number" min="0" max="1000" step="${weightInputStep(unit())}" value="${escapeHtml(displayWeight(set.weightKg, 1))}" data-input="weightKg" data-exercise="${exercise.id}" data-set="${setIndex}" aria-label="${escapeHtml(exercise.name)} set ${set.index} load in ${unit()}">
                    <input class="set-input" inputmode="decimal" type="number" min="1" max="10" step="0.5" placeholder="—" value="${set.rpe ?? ""}" data-input="rpe" data-exercise="${exercise.id}" data-set="${setIndex}" aria-label="${escapeHtml(exercise.name)} set ${set.index} RPE">
                    <button class="set-check ${set.completed ? "is-done" : ""}" data-toggle-set data-exercise="${exercise.id}" data-set="${setIndex}" aria-label="${set.completed ? "Mark set incomplete" : "Complete set"}">${set.completed ? icon("check") : ""}</button>
                  </div>`).join("")}

                <div class="set-footer">
                  <span>${exercise.cues.slice(0, 2).map(escapeHtml).join(" · ")}</span>
                  <span>Next: ${displayWeight(suggestProgression(exercise.loadKg, exercise.sets.filter((set) => set.completed).length, exercise.targetSets), 1)} ${unit()}</span>
                </div>
              </div>
            </article>`).join("")}
        </div>
      </div>

      <aside class="workout-side">
        <div class="panel sticky">
          <div class="eyebrow">SESSION OUTPUT</div>
          <div class="big-output">${displayVolume(summary.volumeKg)} <small>${unit()}</small></div>
          <div class="output-label">completed-set volume</div>
          <div class="output-grid">
            <div><b>${summary.completedSets}</b><span>of ${summary.totalSets} sets</span></div>
            <div><b>${Math.round(summary.completion * 100)}%</b><span>complete</span></div>
            <div><b>${displayWeight(summary.estimatedOneRepMaxKg, 1)}</b><span>best est. 1RM</span></div>
            <div class="rest-card"><b data-rest-timer>${restRemaining > 0 ? formatDuration(restRemaining) : "READY"}</b><span>rest timer</span></div>
          </div>
          <button class="primary-button full" data-action="finish">Save session</button>
          <button class="secondary-button full" data-action="undo-set">Undo last set action</button>
          <button class="secondary-button full" data-action="reset-session">Discard session</button>
          <div class="micro-note">Set-level records are timestamped and stored with explicit source labels for future analytics and movement intelligence.</div>
        </div>
      </aside>
    </section>
  `);
}

function progressView() {
  const history = realHistory();
  const display = history.length ? history : SAMPLE_HISTORY;
  const totalVolume = display.reduce((sum, item) => sum + Number(item.volumeKg || 0), 0);
  const top = Math.max(...display.map((x) => Number(x.volumeKg || 0)), 1);
  const label = history.length ? "RECORDED DATA" : "SAMPLE PREVIEW";

  return renderShell(`
    <section class="section-grid">
      <div class="panel chart-panel">
        <div class="panel-head"><div><div class="eyebrow">VOLUME TREND · ${label}</div><h3>${history.length ? "Your logged training volume" : "What the progress surface will look like"}</h3></div><span class="tag">${history.length ? "LIVE" : "PREVIEW"}</span></div>
        <div class="large-bars">
          ${display.map((item) => `
            <div class="large-bar-wrap">
              <b>${displayVolume(Number(item.volumeKg || 0) / 1000, 1)}k</b>
              <div class="large-bar" style="height:${Math.max(8, (Number(item.volumeKg || 0) / top) * 100)}%"></div>
              <span>${escapeHtml(item.date || "")}</span>
            </div>`).join("")}
        </div>
      </div>

      <div class="panel">
        <div class="eyebrow">PERSONAL SIGNALS</div>
        <div class="signal-list">
          <div class="signal"><span>Total tracked volume</span><b>${displayVolume(totalVolume)} ${unit()}</b><small>${history.length ? "From saved sessions on this device" : "Preview only — not your data"}</small></div>
          <div class="signal"><span>Sessions</span><b>${history.length}</b><small>${history.length ? "Saved locally" : "Start your first workout"}</small></div>
          <div class="signal"><span>Current best estimated 1RM</span><b>${state.session ? displayWeight(sessionSummary().estimatedOneRepMaxKg, 1) + " " + unit() : "—"}</b><small>${state.session ? "From current completed sets" : "Appears during an active session"}</small></div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><div><div class="eyebrow">MOVEMENT INTELLIGENCE CONTRACT</div><h3>Build measurements before opinions.</h3></div></div>
      <div class="roadmap-cards">
        <div><span>01</span><strong>Rep count</strong><p>Manual today; camera-derived later, with a confidence value and model version.</p></div>
        <div><span>02</span><strong>Movement quality</strong><p>Exercise-specific metrics such as tempo, range and symmetry proxies.</p></div>
        <div><span>03</span><strong>Progression</strong><p>Connect completed work, quality and history into explainable recommendations.</p></div>
      </div>
    </section>
  `);
}

function libraryView() {
  return renderShell(`
    <section class="library-toolbar">
      <div class="search-box">${icon("grid")}<input id="exercise-search" placeholder="Search movements, muscles or equipment" autocomplete="off" aria-label="Search exercises"></div>
      <div class="filter-row" role="group" aria-label="Exercise filters">
        <button class="filter active" data-filter="all">All</button>
        <button class="filter" data-filter="Barbell">Barbell</button>
        <button class="filter" data-filter="Machine">Machine</button>
        <button class="filter" data-filter="Bodyweight">Bodyweight</button>
      </div>
    </section>
    <section class="library-grid" id="library-grid">
      ${EXERCISES.map((exercise, index) => `
        <article class="library-card" data-search="${escapeHtml((exercise.name + " " + exercise.muscle + " " + exercise.equipment).toLowerCase())}" data-equipment="${escapeHtml(exercise.equipment)}">
          <div class="library-top"><span class="index-chip">0${index + 1}</span><span class="level">${escapeHtml(exercise.level)}</span></div>
          <h3>${escapeHtml(exercise.name)}</h3>
          <p>${escapeHtml(exercise.muscle)} · ${escapeHtml(exercise.equipment)}</p>
          <div class="library-bottom"><b>${exercise.targetSets} × ${exercise.targetReps}</b><span>${exercise.loadKg ? formatNumber(exercise.loadKg, 1) + " kg base" : "bodyweight"}</span></div>
        </article>`).join("")}
    </section>
  `);
}

function settingsView() {
  return renderShell(renderAccount(state));
}

function render() {
  const view = state.activeView === "workout" ? workoutView()
    : state.activeView === "progress" ? progressView()
    : state.activeView === "library" ? libraryView()
    : state.activeView === "settings" ? settingsView()
    : dashboard();

  $("#app").innerHTML = view;
  wire();
}

function wire() {
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => {
    state.activeView = button.dataset.view;
    save();
    render();
  }));

  $$("[data-action='start']").forEach((button) => button.addEventListener("click", startSession));
  $$("[data-action='finish']").forEach((button) => button.addEventListener("click", finishSession));

  $$("[data-action='export']").forEach((button) => button.addEventListener("click", () => {
    exportState(state);
    announce("Your local data export was created.");
  }));

  $("[data-action='reset-session']").forEach((button) => button.addEventListener("click", () => {
    const confirmed = window.confirm("Discard this active workout? Logged work in this session will be removed.");
    if (!confirmed) return;
    const committed = commitState(() => {
      state.session = null;
      state.activeView = "dashboard";
    });
    if (!committed) return;
    lastSetAction = null;
    stopRestTimer();
    render();
    announce("Active session discarded.");
  }));

  $("[data-toggle-set]").forEach((button) => button.addEventListener("click", () => {
    toggleSet(button.dataset.exercise, Number(button.dataset.set));
  }));

  $("[data-action='undo-set']").forEach((button) => button.addEventListener("click", undoLastSetAction));

  $$("[data-input]").forEach((input) => {
    input.addEventListener("change", () => {
      updateSet(input.dataset.exercise, Number(input.dataset.set), input.dataset.input, input.value);
      render();
    });
  });

  const search = $("#exercise-search");
  const filters = $$(".filter");
  let currentFilter = "all";

  const applyLibraryFilter = () => {
    const query = (search?.value || "").toLowerCase().trim();
    $$(".library-card").forEach((card) => {
      const matchesText = !query || card.dataset.search.includes(query);
      const matchesFilter = currentFilter === "all" || card.dataset.equipment === currentFilter;
      card.hidden = !(matchesText && matchesFilter);
    });
  };

  search?.addEventListener("input", applyLibraryFilter);
  filters.forEach((button) => button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    filters.forEach((item) => item.classList.toggle("active", item === button));
    applyLibraryFilter();
  }));

  $("#display-name")?.addEventListener("change", (event) => {
    state.settings.displayName = event.target.value.trim().slice(0, 50) || "Athlete";
    save();
  });

  $("#units")?.addEventListener("change", (event) => {
    state.settings.units = event.target.value === "lb" ? "lb" : "kg";
    save();
  });

  $$("[data-action='save-settings']").forEach((button) => button.addEventListener("click", () => {
    const name = $("#display-name")?.value.trim().slice(0, 50);
    state.settings.displayName = name || "Athlete";
    state.settings.units = $("#units")?.value === "lb" ? "lb" : "kg";
    save();
    announce("Preferences saved.");
    render();
  }));

  wireAccount({ render, announce });

  $("[data-action='clear-data']").forEach((button) => button.addEventListener("click", () => {
    const confirmed = window.confirm("Delete all local GYM data from this browser?");
    if (!confirmed) return;
    clearState();
    state = defaultState([]);
    lastSetAction = null;
    stopRestTimer();
    render();
    announce("Local GYM data deleted.");
  }));

  updateRestUI();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./src/sw.js").catch((error) => {
    console.warn("GYM service worker unavailable", error);
  });
}

render();
window.addEventListener("online", () => { void flushSyncQueue(); });
window.addEventListener("gym:auth-changed", () => { void flushSyncQueue(); });
void flushSyncQueue();
