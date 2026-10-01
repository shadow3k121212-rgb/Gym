# GYM — Training OS

A mobile-first training tracker foundation with a focused workout flow, local-first session persistence, progression rules, and a versioned movement-event contract designed to support future computer vision.

## Status

**Foundation / prototype.** This repository currently ships a client-side demo, not a production-ready commercial service. Authentication, cloud sync, billing, validated coaching models, and camera-based form analysis are not implemented.

## Run locally

Requires Node.js 20+.

```bash
npm run dev
# open http://localhost:4173
```

## Quality checks

```bash
npm test
npm run check
npm run build
```

No runtime dependencies are required.

## Product principles

- **Trust before cleverness:** show what was measured, distinguish estimates from facts, and never present camera inference as medical advice.
- **Local-first:** workout interactions work without an account; cloud sync can be added behind a repository interface.
- **Structured events:** manual and future sensor-derived events share a versioned schema.
- **Accessible and responsive:** semantic controls, keyboard-friendly interactions, reduced complexity on mobile.
- **Ship safely:** automated syntax, unit, build, and static integrity checks run in CI.

## Roadmap

See [PRODUCT.md](./PRODUCT.md) for the 48-hour launch plan and [ARCHITECTURE.md](./ARCHITECTURE.md) for the target system boundaries.

## License

MIT. See [LICENSE](./LICENSE).
