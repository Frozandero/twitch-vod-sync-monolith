# Contributing

Read [AGENTS.md](AGENTS.md) and [the architecture](docs/ARCHITECTURE.md) first.

1. Install Node.js 22.12+ and run `npm ci`.
2. Make focused changes on a branch. Keep provider-specific behavior in `packages/providers` and timeline logic in `packages/sync-core`.
3. Run `npm run format` and `npm run check`.
4. For interface changes, inspect desktop and mobile, keyboard focus, reduced motion, empty/error states, and the relevant player flow in a browser. Keep transient screenshots under ignored `output/playwright/`.
5. Update dated provider research and verification limitations when changing platform behavior.
6. Open a pull request. Do not commit `dist`, credentials, browser profiles, or local environment files.

Useful regression cases: clip offset zero, unavailable clip parent, exact start/end boundaries, different timezones, no overlap, manually corrected timing, duplicate inputs, failed lookup recovery, invalid shared sessions, and deployment under a repository subpath.

No browser extension is included yet. Adding one should not require changes to the meaning of the shared core functions.
