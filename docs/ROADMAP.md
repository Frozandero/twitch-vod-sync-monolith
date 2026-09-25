# Roadmap

## Current web scope

- Twitch/Kick multi-VOD grid, per-player synchronization, mute/settings/remove controls.
- URL, timestamped URL, numeric Twitch VOD ID, and Twitch/Kick clip inputs.
- Every recording's timestamp, including labeled non-matches and exact gaps.
- Shared pointer/keyboard seeker, play/pause, and watch mode.
- Fixed timing corrections, optional official Twitch connection, persistence/share/import/export.
- Static Pages deployment and reusable TypeScript packages.

## Deferred

Kick VOD playback and clip timestamp matching are included. Current and legacy IDs are resolved through explicit metadata mappings where available. Manual broadcast-metadata entry remains out of the UI.

## Future extension

No extension is included. A later request can add `apps/extension`, reuse the shared core/providers, and define a validated message contract for importing a user-selected tab's VOD/playhead. Start with user-initiated access; choose permissions only for concrete features. Do not bypass provider controls or pass auth credentials to the website.

Build/release extension artifacts independently from Pages while keeping the source in this monorepo.

## Possible later improvements

- Segment-aware alignment for edited streams and reconnect gaps.
- Opt-in drift correction that accounts for ads, user seeks, and readiness.
- Layout presets for large grids.
- Replace undocumented Kick metadata with an official VOD API if one becomes available.
- More browser/provider checks for authenticated and mobile playback.
