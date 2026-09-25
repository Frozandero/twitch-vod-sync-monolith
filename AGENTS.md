# Agent guide

Read README.md and docs/ARCHITECTURE.md before changing behavior. Read docs/RESEARCH.md for provider assumptions and docs/STATUS.md for verification limits. The current user-approved scope includes Twitch and Kick VOD playback and clip timestamp matching. Manual metadata-entry UI remains deferred.

## Structure and commands

- `apps/web`: React/Vite browser UI and Twitch player adapter.
- `packages/sync-core`: pure URL parsing, UTC timeline arithmetic, bounds, session serialization. No browser UI or network dependencies.
- `packages/providers`: metadata adapters. Keep all undocumented endpoints here.
- Run `npm ci`, then `npm run check`. For a visual change run the site and inspect desktop and mobile with a real browser.
- Deploy with the existing Pages workflow; never commit build output or create a second deployment repo.

## Invariants

- A shared moment is VOD start + timing correction + playback seconds. Intervals are half-open: start is playable, exact end is ended.
- Before-start recordings are held at zero; ended recordings are held at the end and display an ended state. Remove inactive/finished Twitch embeds so Up Next cannot start another recording; recreate only the requested VOD on a playable seek. Never generate a playable match for either boundary.
- Guard Twitch getVideo/getEnded before accepting clocks or issuing playback commands. A foreign video ID must stop and detach the embed, never inherit the session VOD’s timing. Timeline coverage is not proof of synchronized playback: show verified player positions and drift separately from the selected moment.
- Shared seeks pause all players and freeze the shared moment until every matching VOD confirms the current command's target, a stable buffer, and a paused state. Exclude before/ended VODs and link-only providers; never release based on a stale serial, READY alone, or an unverified clock. Preserve play/pause intent, support cancellation/retry, and keep readiness UI outside the Twitch frame.
- Confirm group starts with current-command PLAYING acknowledgments, not play() calls or unpaused buffering alone. Retry the whole group at the selected moment with a finite limit; a failed start pauses everyone and identifies the affected recordings. Pause must work when any matching player is running, and cancellation must prevent delayed starts. Do not continuously force playback after a confirmed start.
- A clip's creation/upload time is not its broadcast time. Require its parent VOD and start offset. Never subtract clip duration from GET Clips vod_offset.
- Streamer shorthand/profile inputs are targets to one captured seeker moment, never new sources. Resolve a concrete covering archive with bounded provider history, validate its owner and half-open interval, preserve canonical deduplication and saved timing, and report missing matches without choosing the newest/nearest recording. Persist only resolved VODs; do not automatically replace them on later seeks.
- Reject highlights/uploads for automatic wall-clock mapping. Do not restore the removed manual metadata form without a request.
- Never put tokens, client secrets, cookies, or credentials in source, builds, logs, URLs, or shared sessions. The public Twitch client ID is an identifier, not a secret.
- Treat shared sessions and provider responses as untrusted input. Validate all data and URL hosts.
- No public CORS proxies, no server requirement, no attempts to bypass login/subscription/anti-bot restrictions.
- Keep the interface compact: no slogan/sidebar recording list, demo button, or Grid/Links tabs. Keep timestamp links in player headers and beside every timeline timestamp, exact non-match gaps, per-player controls, watch mode, and a collapsible shared seeker. Hiding the seeker must not remount players or change playback.
- Reordering changes session order and CSS positions, never iframe DOM positions or playback commands. Keep grid/timeline order consistent and include it in persistence/share/export. Provide keyboard/touch alternatives to dragging and preserve remaining playback when closing a non-source recording.
- Keep the user-approved grid sizing. Watch-mode exit and timeline toggle belong in an existing player header, with no empty control strips above/below the grid and no overlap over video. Do not restore automatic 16:9 row fitting without a request.
- Kick VODs use native video and dynamically loaded hls.js, never Twitch iframes or injected userscripts. Include matching Kick media in buffer/start barriers; require actual loaded positions, contiguous buffered ranges, and native playing events. Remove media at boundaries. Use loaded VOD duration for the end boundary; never use it to guess a recording's identity or broadcast start.
- Resolve Kick current/legacy IDs only through explicit provider mappings, never dates or UUID heuristics. Keep Kick API handling and validated CDN source resolution isolated in packages/providers/src/kick.ts. Media URLs are transient, never session fields. Only play public provider-returned HTTPS playlists on the supported CDN; no GM requests, proxies, credential extraction, or restriction bypasses.
- Document changes to provider assumptions with primary sources and dated observations.
- Future extension work belongs in `apps/extension`, consumes shared packages, and requires a separate request. Do not add extension permissions speculatively.

Keep changes focused, preserve other contributors' work, and update research/status docs when capabilities change.
