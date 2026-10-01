# Product strategy and launch audit

## Product promise

**A training operating system that remembers the work, makes progress legible, and earns the right to coach.**

The product should not feel like a generic AI chat wrapped around a workout tracker. The core loop is: plan → train → capture → understand → adjust.

## Differentiation worth building

1. **Training memory:** reliable history at the set level, not just a streak counter.
2. **Explainable progression:** show which completed sessions justify a load/repetition recommendation.
3. **Movement timeline:** rep count, tempo, range-of-motion proxy, symmetry proxy, and confidence—only when validated.
4. **Camera privacy by design:** on-device processing where feasible; raw video off by default.
5. **Coach + athlete workflow:** later allow a coach to review progress with explicit athlete permission.
6. **Gym-floor usability:** large tap targets, quick set completion, rest timer, offline resilience, and fast recovery after interruptions.

## Current audit

The repository initially contained only an MIT license and one initial commit. This branch now contains the no-dependency web prototype, workout domain helpers, responsive UI, local persistence, authenticated API, PostgreSQL persistence, versioned migrations, movement-event contract, basic PWA shell, documentation, tests, and CI.

### Known gaps — do not call these complete

- No production deployment, managed secrets, backups/restore drill, or operational rollback has been completed.
- Email verification, account recovery, refresh/session management, and device/session revocation are not production-complete.
- No real AI model, pose estimation, camera capture, or wearable integration.
- No end-to-end browser test suite or real device/browser matrix.
- No privacy policy, terms, consent records, billing, or support tooling.
- The client remains local-first and localStorage is device/browser-specific; cloud sync is optional when the API is configured.
- Accessibility and performance need a formal audit with assistive technology and target devices.

## 48-hour execution plan

### 0–4 hours: scope and release gate
- Freeze the launch scope to workout logging, history, and responsive web experience.
- Decide product name/trademark, domain, audience, and launch geography.
- Replace demo metrics with clearly labelled sample data or an empty state.
- Agree on what data is stored and write a privacy notice.

### 4–12 hours: product loop
- Validate onboarding, exercise selection, set logging, session completion, history, and empty/error states.
- Add edit/undo for accidental set taps and confirm destructive actions.
- Add real dates and unit preferences (kg/lb).
- Test on a small and large phone, tablet, and desktop.

### 12–24 hours: reliability
- Add browser-level smoke tests and accessibility checks.
- Add error boundaries, storage quota/parse recovery, and export/delete data.
- Verify PWA caching/update behavior and offline failure states.
- Add release notes, support contact, and rollback instructions.

### 24–36 hours: production service hardening (only if infrastructure is ready)
- Move the existing authenticated API/PostgreSQL foundation into staging with managed secrets and TLS.
- Complete authorization, backups/restore drills, monitoring, retention, deletion, and rollback evidence.
- Complete privacy, consent, account recovery, session revocation, and data-export/deletion workflows.
- Keep the public product positioned as local-first beta until those operational controls are actually evidenced.

### 36–48 hours: release candidate
- Run all unit, integration, browser, accessibility, and device checks.
- Fix all release-blocking defects; publish known limitations.
- Deploy to staging, run smoke tests, then production with rollback ready.
- Invite a small cohort; monitor errors and collect feedback before broad promotion.

## Release gate

Do not describe this as a fully production-ready AI fitness coach until camera inference is implemented and evaluated. A credible 48-hour launch is a polished, honest beta of the core workout loop; validated computer vision is a subsequent milestone.
