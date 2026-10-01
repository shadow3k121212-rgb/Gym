import { calculateVolume, suggestProgression, summarizeSession } from "./workout-engine.js";

const STORAGE_KEY = "gym:state:v1";

const exercises = [
  { id: "bench", name: "Barbell Bench Press", muscle: "Chest", equipment: "Barbell", level: "Intermediate", targetSets: 4, targetReps: 8, loadKg: 70 },
  { id: "squat", name: "Back Squat", muscle: "Legs", equipment: "Barbell", level: "Intermediate", targetSets: 4, targetReps: 6, loadKg: 90 },
  { id: "row", name: "Chest-Supported Row", muscle: "Back", equipment: "Machine", level: "Beginner", targetSets: 3, targetReps: 10, loadKg: 45 },
  { id: "rdl", name: "Romanian Deadlift", muscle: "Posterior", equipment: "Barbell", level: "Intermediate", targetSets: 3, targetReps: 8, loadKg: 75 },
  { id: "ohp", name: "Overhead Press", muscle: "Shoulders", equipment: "Barbell", level: "Intermediate", targetSets: 3, targetReps: 8, loadKg: 42.5 },
  { id: "pullup", name: "Pull-Up", muscle: "Back", equipment: "Bodyweight", level: "Intermediate", targetSets: 3, targetReps: 8, loadKg: 0 }
];

const seedHistory = [
  { day: "Mon", volume: 11240 },
  { day: "Tue", volume: 8900 },
  { day: "Wed", volume: 12560 },
  { day: "Thu", volume: 0 },
  { day: "Fri", volume: 9720 },
  { day: "Sat", volume: 13840 },
  { day: "Sun", volume: 0 }
];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved || {
      activeView: "dashboard",
      sessionStarted: false,
      completed: {},
      history: seedHistory,
      sessions: 18,
      streak: 7,
      latestInsight: "You are trending up. Keep one rep in reserve on your top sets this week."
    };
  } catch {
    return {
      activeView: "dashboard",
      sessionStarted: false,
      completed: {},
      history: seedHistory,
      sessions: 18,
      streak: 7,
      latestInsight: "Build consistency first; intensity comes second."
    };
  }
}

let state = loadState();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("Could not persist workout state", error);
    return false;
  }
}

function exportData() {
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    product: "GYM Training OS",
    state
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gym-data-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function icon(name) {
  const paths = {
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
    chart: '<path d="M4 19V5M4 19h16M8 16v-4M12 16V7M16 16v-8"/>',
    dumbbell: '<path d="M5 8v8M2 10v4M8 10h8M19 8v8M22 10v4"/><path d="M8 8v8M16 8v8"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    play: '<path d="m9 6 10 6-10 6Z" fill="currentColor" stroke="none"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.grid}</svg>`;
}

function formatKg(value) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value);
}

function navItem(view, label, iconName) {
  return `<button class="nav-item ${state.activeView === view ? "is-active" : ""}" data-view="${view}" aria-label="${label}">
    ${icon(iconName)}<span>${label}</span>
  </button>`;
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
          <span class="eyebrow">NEXT SYSTEM</span>
          <strong>Motion Intelligence</strong>
          <p>Camera-ready movement data layer designed into the product from day one.</p>
          <span class="status-dot">ARCHITECTURE READY</span>
        </div>
        <div class="sidebar-foot">v0.1 FOUNDATION</div>
      </aside>
      <main class="main-content">
        <header class="topbar">
          <div>
            <div class="eyebrow">YOUR TRAINING SPACE · LOCAL BETA</div>
            <h1>${state.activeView === "dashboard" ? "Control your training." : viewTitle()}</h1>
          </div>
          <div class="top-actions">
            <button class="icon-button" title="Export your data" data-action="export" aria-label="Export your data">↓</button><button class="icon-button" title="Reset demo state" data-action="reset" aria-label="Reset demo data">↺</button>
            <div class="avatar">S</div>
          </div>
        </header>
        ${content}
      </main>
      <nav class="mobile-nav">
        ${navItem("dashboard", "Overview", "grid")}
        ${navItem("workout", "Workout", "bolt")}
        ${navItem("progress", "Progress", "chart")}
        ${navItem("library", "Exercises", "dumbbell")}
      </nav>
    </div>
  `;
}

function viewTitle() {
  return ({ workout: "Today’s training.", progress: "Your signal, over time.", library: "The movement library." })[state.activeView] || "Control your training.";
}

function dashboard() {
  const workout = sessionModel();
  const summary = summarizeSession(workout);
  const max = Math.max(...state.history.map((x) => x.volume), 1);
  return renderShell(`
    <section class="hero-grid">
      <article class="hero-card">
        <div class="hero-copy">
          <div class="eyebrow">TODAY’S SESSION</div>
          <h2>Upper Strength<span>.</span></h2>
          <p>Build the work that compounds. Four movements, 14 target sets, clean progression.</p>
          <div class="hero-meta">
            <span><b>04</b> movements</span><span><b>14</b> target sets</span><span><b>~54</b> min</span>
          </div>
          <button class="primary-button" data-action="start">${state.sessionStarted ? "Resume workout" : "Start workout"} ${icon("arrow")}</button>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="ring ring-outer"></div><div class="ring ring-mid"></div><div class="ring ring-inner"></div>
          <div class="ring-core"><span>${Math.round(summary.completion * 100)}%</span><small>READY</small></div>
        </div>
      </article>

      <article class="stat-card">
        <div class="eyebrow">WEEKLY LOAD · SAMPLE</div><div class="stat-number">${formatKg(state.history.reduce((a,b)=>a+b.volume,0)/1000)}k</div><div class="stat-caption">kg moved</div>
        <div class="mini-bars">${state.history.map((item) => `<div class="bar-wrap"><div class="bar" style="height:${Math.max(7,(item.volume/max)*100)}%"></div><span>${item.day}</span></div>`).join("")}</div>
      </article>
    </section>

    <section class="section-grid">
      <div class="panel">
        <div class="panel-head"><div><div class="eyebrow">TRAINING PULSE · SAMPLE</div><h3>Consistency is compounding.</h3></div><span class="tag">DEMO DATA</span></div>
        <div class="metric-row">
          <div><span class="metric-value">${state.sessions}</span><span class="metric-label">sessions</span></div>
          <div><span class="metric-value">${state.streak}</span><span class="metric-label">day streak</span></div>
          <div><span class="metric-value">+8.4%</span><span class="metric-label">volume vs last block</span></div>
        </div>
        <div class="progress-line"><span style="width:72%"></span></div>
        <div class="micro-note">Illustrative preview values. Your real history starts when you log sessions.</div>
      </div>
      <div class="panel insight-panel">
        <div class="eyebrow">COACH SIGNAL · RULE-BASED</div>
        <h3>${state.latestInsight}</h3>
        <p>The intelligence layer is intentionally provider-agnostic: manual logs today, AI/CV inference tomorrow.</p>
        <button class="text-button" data-view="progress">See the signal ${icon("arrow")}</button>
      </div>
    </section>

    <section class="panel exercise-preview">
      <div class="panel-head"><div><div class="eyebrow">SESSION BLUEPRINT</div><h3>Upper Strength</h3></div><button class="text-button" data-view="workout">Open workout ${icon("arrow")}</button></div>
      <div class="exercise-list">${workout.map((e) => `<div class="exercise-row"><div class="exercise-index">0${workout.indexOf(e)+1}</div><div class="exercise-main"><strong>${e.name}</strong><span>${e.muscle} · ${e.targetSets} × ${e.targetReps}</span></div><div class="exercise-load">${e.loadKg ? e.loadKg+" kg" : "BW"}</div></div>`).join("")}</div>
    </section>
  `);
}

function sessionModel() {
  return ["bench","row","ohp","pullup"].map((id) => {
    const exercise = exercises.find((e) => e.id === id);
    const completedSets = state.completed[id] || 0;
    const sets = Array.from({ length: completedSets }, () => ({ reps: exercise.targetReps, weightKg: exercise.loadKg }));
    return { ...exercise, completedSets, sets };
  });
}

function workoutView() {
  const session = sessionModel();
  return renderShell(`
    <section class="workout-layout">
      <div class="panel workout-main">
        <div class="panel-head">
          <div><div class="eyebrow">LIVE SESSION</div><h3>Upper Strength</h3></div>
          <span class="timer">${state.sessionStarted ? "ACTIVE" : "NOT STARTED"}</span>
        </div>
        <div class="session-progress"><span style="width:${summarizeSession(session).completion*100}%"></span></div>
        <div class="set-list">
          ${session.map((e, i) => `
            <article class="set-card">
              <div class="set-number">0${i+1}</div>
              <div class="set-content">
                <div class="set-title"><div><strong>${e.name}</strong><span>${e.muscle} · ${e.targetSets} × ${e.targetReps}</span></div><b>${e.loadKg ? e.loadKg+" kg" : "BODYWEIGHT"}</b></div>
                <div class="set-actions">
                  ${Array.from({length:e.targetSets},(_,setIndex)=>`<button class="set-pill ${setIndex < e.completedSets ? "is-done" : ""}" data-complete="${e.id}" data-set="${setIndex}" aria-label="Set ${setIndex+1}">${setIndex+1}${setIndex < e.completedSets ? " ✓" : ""}</button>`).join("")}
                </div>
                <div class="set-footer"><span>Rest 90s</span><span>Next: ${suggestProgression(e.loadKg, e.completedSets, e.targetSets)} kg</span></div>
              </div>
            </article>`).join("")}
        </div>
      </div>
      <aside class="workout-side">
        <div class="panel sticky">
          <div class="eyebrow">SESSION OUTPUT</div>
          <div class="big-output">${formatKg(summarizeSession(session).volumeKg)} <small>kg</small></div>
          <div class="output-label">training volume</div>
          <div class="output-grid">
            <div><b>${summarizeSession(session).totalSets}</b><span>sets</span></div>
            <div><b>${Math.round(summarizeSession(session).completion*100)}%</b><span>complete</span></div>
          </div>
          <button class="primary-button full" data-action="finish">Finish session</button>
          <div class="micro-note">Every set event is normalized for future analytics and movement inference.</div>
        </div>
      </aside>
    </section>
  `);
}

function progressView() {
  const total = state.history.reduce((a,b) => a + b.volume, 0);
  const top = Math.max(...state.history.map((x)=>x.volume), 1);
  return renderShell(`
    <section class="section-grid">
      <div class="panel chart-panel">
        <div class="panel-head"><div><div class="eyebrow">VOLUME TREND · SAMPLE</div><h3>Seven-day training signal</h3></div><span class="tag">ILLUSTRATIVE</span></div>
        <div class="large-bars">${state.history.map((x)=>`<div class="large-bar-wrap"><div class="large-bar" style="height:${Math.max(8,(x.volume/top)*100)}%"></div><b>${x.volume ? Math.round(x.volume/1000)+"k" : "—"}</b><span>${x.day}</span></div>`).join("")}</div>
      </div>
      <div class="panel">
        <div class="eyebrow">PERSONAL SIGNALS · DEMO</div>
        <div class="signal-list">
          <div class="signal"><span>Weekly volume</span><b>${formatKg(total/1000)}k kg</b><small>+8.4% vs prior block</small></div>
          <div class="signal"><span>Consistency</span><b>4 / 5 sessions</b><small>one session remaining</small></div>
          <div class="signal"><span>Load discipline</span><b>+2.5 kg</b><small>recommended progression</small></div>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><div class="eyebrow">WHAT WE’LL MEASURE NEXT</div><h3>Movement intelligence contract</h3></div></div>
      <div class="roadmap-cards">
        <div><span>01</span><strong>Rep count</strong><p>Detect completed reps and tempo without forcing manual input.</p></div>
        <div><span>02</span><strong>Form quality</strong><p>Track range, symmetry and stability as structured metrics.</p></div>
        <div><span>03</span><strong>Progression</strong><p>Connect quality × load × fatigue to recommendations.</p></div>
      </div>
    </section>
  `);
}

function libraryView() {
  return renderShell(`
    <section class="library-toolbar">
      <div class="search-box">${icon("search")}<input id="exercise-search" placeholder="Search movements, muscles or equipment" autocomplete="off"></div>
      <div class="filter-row"><button class="filter active">All</button><button class="filter">Barbell</button><button class="filter">Machine</button><button class="filter">Bodyweight</button></div>
    </section>
    <section class="library-grid" id="library-grid">
      ${exercises.map((e)=>`<article class="library-card" data-search="${(e.name+" "+e.muscle+" "+e.equipment).toLowerCase()}">
        <div class="library-top"><span class="index-chip">0${exercises.indexOf(e)+1}</span><span class="level">${e.level}</span></div>
        <h3>${e.name}</h3><p>${e.muscle} · ${e.equipment}</p>
        <div class="library-bottom"><b>${e.targetSets} × ${e.targetReps}</b><span>${e.loadKg ? e.loadKg+" kg base" : "bodyweight"}</span></div>
      </article>`).join("")}
    </section>
  `);
}

function render() {
  const view = state.activeView === "workout" ? workoutView() :
    state.activeView === "progress" ? progressView() :
    state.activeView === "library" ? libraryView() : dashboard();
  document.querySelector("#app").innerHTML = view;
  wire();
}

function wire() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
    state.activeView = button.dataset.view;
    save();
    render();
  }));

  document.querySelectorAll("[data-action='start']").forEach((button) => button.addEventListener("click", () => {
    state.sessionStarted = true;
    state.activeView = "workout";
    save();
    render();
  }));

  document.querySelectorAll("[data-action='finish']").forEach((button) => button.addEventListener("click", () => {
    const summary = summarizeSession(sessionModel());
    if (summary.totalSets > 0) {
      state.sessions += 1;
      state.streak += 1;
      state.history[state.history.length - 1].volume = summary.volumeKg;
      state.latestInsight = summary.completion === 1
        ? "All target sets landed. Next block can progress the primary lift by 2.5 kg."
        : "You left work on the floor. Repeat the session before adding load.";
    }
    state.completed = {};
    state.sessionStarted = false;
    state.activeView = "dashboard";
    save();
    render();
  }));

  document.querySelectorAll("[data-complete]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.complete;
    const target = exercises.find((e) => e.id === id).targetSets;
    const current = state.completed[id] || 0;
    state.completed[id] = current < Number(button.dataset.set) + 1 ? Number(button.dataset.set) + 1 : current - 1;
    state.completed[id] = Math.max(0, Math.min(target, state.completed[id]));
    state.sessionStarted = true;
    save();
    render();
  }));

  document.querySelectorAll("[data-action='export']").forEach((button) => button.addEventListener("click", exportData));

  document.querySelectorAll("[data-action='reset']").forEach((button) => button.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    state = loadState();
    render();
  }));

  const input = document.querySelector("#exercise-search");
  if (input) input.addEventListener("input", () => {
    const query = input.value.toLowerCase().trim();
    document.querySelectorAll(".library-card").forEach((card) => {
      card.hidden = query && !card.dataset.search.includes(query);
    });
  });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./src/sw.js").catch(() => {});
}

render();
