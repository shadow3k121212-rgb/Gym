# Public beta release checklist

## Release positioning

GYM is a **local-first workout logging beta with an optional authenticated API foundation**. Cloud sync is opt-in and only available when a deployment configures the API; AI coaching and computer-vision form checks are roadmap capabilities, not current product promises.

## Before sharing the URL

- [ ] Replace the avatar placeholder and demo copy with product-ready onboarding.
- [ ] Confirm all seeded history and coaching metrics are clearly labelled as sample data.
- [ ] Verify session start, set completion, session finish, auth restore/refresh, export, local reset, password recovery, and account deletion.
- [ ] Verify mobile navigation and layouts at narrow widths.
- [ ] Verify keyboard operation, visible focus, contrast, and screen-reader labels.
- [ ] Verify data export and explain browser-local storage limitations.
- [ ] Add a public privacy notice, account recovery delivery service, deletion/retention notice, and support contact appropriate to the launch.
- [ ] Confirm domain, HTTPS, cache headers, and deployment rollback procedure.
- [ ] Run CI and manually inspect the deployed build.
- [ ] Invite a small cohort before broad promotion.

## Data transparency

Workout state is stored locally in browser localStorage. The beta can optionally sync completed sessions to a configured authenticated API, but local data remains the immediate client-side source of truth and may be removed by browser storage controls. The export function downloads locally stored app state. Do not enter information you would not want stored on this device.

The API foundation currently stores account and workout/session data in PostgreSQL. Production privacy, retention, deletion, recovery, and camera-data policies must be completed before collecting sensitive or camera-derived data.

## Launch blocker policy

Block public promotion if session data is lost unexpectedly, export fails, sample values appear to be real user history, or the deployed site fails core workout flows.
