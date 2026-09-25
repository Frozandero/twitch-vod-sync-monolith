# Agent guide

Read README.md and docs/ARCHITECTURE.md before changing behavior. Read docs/RESEARCH.md for provider assumptions and docs/STATUS.md for verification limits. The current user-approved scope is Twitch only; Kick and manual metadata-entry UI are deferred.

## Structure and commands

- `apps/web`: React/Vite browser UI and Twitch player adapter.
- `packages/sync-core`: pure URL parsing, UTC timeline arithmetic, bounds, session serialization. No browser UI or network dependencies.
- `packages/providers`: metadata adapters. Keep all undocumented endpoints here.
- Run `npm ci`, then `npm run check`. For a visual change run the site and inspect desktop and mobile with a real browser.
- Deploy with the existing Pages workflow; never commit build output or create a second deployment repo.

## Invariants

- A shared moment is VOD start + timing correction + playback seconds. Intervals are half-open: start is playable, exact end is ended.
- Before-start recordings pause at zero; ended recordings pause at the end and display an ended state. Never generate a playable match for either.
- A clip's creation/upload time is not its broadcast time. Require its parent VOD and start offset. Never subtract clip duration from GET Clips vod_offset.
- Reject highlights/uploads for automatic wall-clock mapping. Do not restore the removed manual metadata form without a request.
- Never put tokens, client secrets, cookies, or credentials in source, builds, logs, URLs, or shared sessions. The public Twitch client ID is an identifier, not a secret.
- Treat shared sessions and provider responses as untrusted input. Validate all data and URL hosts.
- No public CORS proxies, no server requirement, no attempts to bypass login/subscription/anti-bot restrictions.
- Keep the interface compact: no slogan/sidebar recording list or demo button, all recordings in Links, exact non-match gaps, per-player controls, watch mode, and a seekable shared timeline.
- Kick code is isolated experimental research, not a shipped web capability.
- Document changes to provider assumptions with primary sources and dated observations.
- Future extension work belongs in `apps/extension`, consumes shared packages, and requires a separate request. Do not add extension permissions speculatively.

Keep changes focused, preserve other contributors' work, and update research/status docs when capabilities change.
