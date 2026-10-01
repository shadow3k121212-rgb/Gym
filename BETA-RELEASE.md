# Public beta release checklist

## Release positioning

GYM is a **local-first workout logging beta**. Do not advertise cloud sync, AI coaching, computer-vision form checks, or medical outcomes until those features exist and have passed validation.

## Before sharing the URL

- [ ] Replace the avatar placeholder and demo copy with product-ready onboarding.
- [ ] Confirm all seeded history and coaching metrics are clearly labelled as sample data.
- [ ] Verify session start, set completion, session finish, refresh, export, and reset.
- [ ] Verify mobile navigation and layouts at narrow widths.
- [ ] Verify keyboard operation, visible focus, contrast, and screen-reader labels.
- [ ] Verify data export and explain browser-local storage limitations.
- [ ] Add a public privacy notice and support contact appropriate to the launch.
- [ ] Confirm domain, HTTPS, cache headers, and deployment rollback procedure.
- [ ] Run CI and manually inspect the deployed build.
- [ ] Invite a small cohort before broad promotion.

## Data transparency

The prototype stores its state in browser localStorage. It is not account-backed, not synced across devices, and may be removed by browser storage controls. The export function downloads the locally stored app state. Do not enter information you would not want stored on this device.

## Launch blocker policy

Block public promotion if session data is lost unexpectedly, export fails, sample values appear to be real user history, or the deployed site fails core workout flows.
