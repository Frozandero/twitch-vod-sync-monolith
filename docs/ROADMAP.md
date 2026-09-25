# Roadmap

## Current web scope

- Twitch multi-VOD grid, per-player synchronization, mute/settings/remove controls.
- URL, timestamped URL, numeric VOD ID, and Twitch clip inputs.
- Every recording's timestamp, including labeled non-matches and exact gaps.
- Shared pointer/keyboard seeker, play/pause, and watch mode.
- Fixed timing corrections, optional official Twitch connection, persistence/share/import/export.
- Static Pages deployment and reusable TypeScript packages.

## Deferred

**Kick is on hold at the owner's request.** Keep the existing research and isolated experimental adapter, but do not advertise or expose it in the web UI. Manual broadcast-metadata entry is also out of the current UI.

## Future extension

No extension is included. A later request can add `apps/extension`, reuse the shared core/providers, and define a validated message contract for importing a user-selected tab's VOD/playhead. Start with user-initiated access; choose permissions only for concrete features. Do not bypass provider controls or pass auth credentials to the website.

Build/release extension artifacts independently from Pages while keeping the source in this monorepo.

## Possible later improvements

- Segment-aware alignment for edited streams and reconnect gaps.
- Opt-in drift correction that accounts for ads, user seeks, and readiness.
- Layout presets for large grids.
- Official Kick VOD integration if supported APIs become available and the feature is requested again.
- More browser/provider checks for authenticated and mobile playback.
