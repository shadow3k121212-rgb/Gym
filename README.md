# GYM — Training OS

A mobile-first training tracker foundation with a focused workout flow, local-first session persistence, progression rules, and a versioned movement-event contract designed to support future computer vision.

## Status

**Public beta foundation.** The repository ships the local-first workout product plus an optional authenticated API/PostgreSQL foundation. No production deployment is included yet, and billing, validated coaching models, and real camera-based form analysis remain roadmap work.

## Run locally

Requires Node.js 20+.

```bash
npm run dev
# open http://localhost:4173
```

## Quality checks

```bash
npm test
npm run test:all
npm run smoke
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

See [PRODUCT.md](./PRODUCT.md) for the launch plan, [ARCHITECTURE.md](./ARCHITECTURE.md) for system boundaries, and [RELEASE-GATES.md](./RELEASE-GATES.md) for production evidence requirements.

## License

MIT. See [LICENSE](./LICENSE).


## CI evidence

CI validates frontend/backend tests, fresh PostgreSQL migrations and schema integrity, HTTP smoke coverage, dependency audit, static checks, and the production build before the branch is considered verified.
