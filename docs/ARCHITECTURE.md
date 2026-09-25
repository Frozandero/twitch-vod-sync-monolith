# Architecture

## Boundaries

An npm-workspace monorepo builds static HTML/CSS/JavaScript with Vite into `apps/web/dist`. GitHub Actions deploys that artifact to Pages. There is no backend, proxy, service worker, database, or runtime secret.

- `@vodsync/core`: validated URL parsing, timestamps, UTC arithmetic, before/playing/ended states, canonical links, versioned sessions. No third-party dependencies; reusable by an extension.
- `@vodsync/providers`: optional official Twitch Helix and anonymous Twitch GraphQL adapters. Fetch is injectable for deterministic tests. Requests time out and omit cookies. An experimental Kick adapter remains isolated, unreachable from the Twitch-only web entry point.
- `@vodsync/web`: compact URL input, player grid, timestamp links in each player header and timeline row, collapsible shared seeker, per-recording controls, watch mode, local persistence and OAuth.

## Time model

```text
effectiveStart = UTC broadcast start + correctionSeconds
sharedMoment   = selected VOD effectiveStart + playbackSeconds
targetOffset   = sharedMoment - target effectiveStart
```

Recording intervals are half-open: `[start,end)`. Before-start offsets clamp to zero; at/after-end offsets clamp to duration. Both remain visible and are labeled as non-matches with exact gaps. Their outbound links are explicitly boundary links, not matching footage. These states have frozen handles and no active Twitch iframe; do not seek an embed to its exact end and leave an Up Next countdown running.

The shared moment is independent of the last selected player's interval. This is necessary for a seeker spanning all recordings, including gaps when none is playing. Timeline bounds are the union's earliest start and latest end. Seeker preview is local while dragging; release or a keyboard action issues a paused seek to every player.

GET Clips `vod_offset` and GraphQL `videoOffsetSeconds` are the clip start in the parent VOD. Add the clip-local offset; fetch the parent broadcast's start. Never use clip creation time or subtract clip duration. Reject automatic mapping of highlights/uploads.

## Player coordination

A sync command contains the UTC moment, play/pause state, last selected player key, and a monotonic serial. Clicking a player's Sync reads its position and pause state. Targets seek to matching offsets; those out of bounds pause. The selected player supplies audio; mute can be adjusted separately.

Twitch READY gates commands. The initial embed URL also includes the desired time because READY may precede loaded media. Requested seeks have bounded retries; this is not continuous drift correction. Unmount removes listeners/iframes. Loading failures and playback-blocked events are surfaced.

The identity/end guard checks the public SDK's getVideo/getEnded before accepting positions or playback commands, and listens for ENDED. Finishing or changing identity synchronously pauses and detaches the iframe, then latches the stopped state for that command. A subsequent playable sync/seek recreates the requested VOD with the current shared moment; a changed-ID stop also offers an explicit reload. A source ending advances the selection to its exact end. Other players reaching a boundary cannot advance the source clock or resurrect a stopped embed.

The timeline follows the last synced player's clock while it plays. Reading clocks does not issue repeated seeks. There is no separate Links view. Timeline links use the displayed shared moment; header links use the respective player's current clock. Watch mode and collapsing the seeker only change layout, preserving player instances and playback. Collapsing discards an uncommitted seek preview; its preference is saved locally.

Each handle also exposes a transient playback snapshot. The seeker draws the selected moment separately from verified actual player clocks, marks differences above two seconds as ahead/behind, and never paints a loading, finished, or switched player as aligned. Broadcast coverage remains based on metadata and is not treated as proof of content/event alignment. Playback snapshots are not serialized into sessions.

Third-party iframe controls, content restrictions, ads, buffering, and autoplay remain Twitch-controlled. Before Twitch reports a position or emits PLAYING, the header shows the requested position and disables Sync from that player. Its initial zero must not overwrite the shared moment. Once the clock is confirmed, a subsequent zero is a valid user seek.

## Persistence

Sessions are validated before export/import:

- Version 2 stores recordings, `leaderKey`, absolute `momentMs`, and a legacy view field. The web app always exports `grid` and accepts older `links` sessions into the grid without losing their recordings or moment.
- Version 1 migrates its source key/relative timestamp into the same absolute moment. The local storage key is preserved.
- Legacy Kick entries are filtered on web import/restore; an all-Kick session is rejected.
- Required unique identities, canonical supported-host URLs, timezone-aware dates, finite numeric bounds, a leader present in the recordings, and a moment inside the full timeline are enforced.
- Imports have size and 100-item resource guards. Shared fragments are base64url UTF-8 JSON capped at 60,000 characters; larger sessions use JSON export.
- Constructing a new allowlisted session strips unknown keys, including credentials.

Local storage holds the recording session and optional public Client ID. Session storage holds OAuth state/token. Storage failures preserve in-memory use; sign-in requires writable session storage. OAuth checks one-time state and validates the token on launch and every 55 minutes. No account secret is embedded.

## Interface constraints

Use a compact utility interface: URL input, player grid, per-player actions, and a collapsible seeker. No view tabs, slogans, decorative workspace headings, sidebar recording list, demo button, manual metadata-entry form, or feature footer. Every recording has a timestamp link beside its timeline time; the seek overlay must not cover those links. Before/ended links explicitly identify the boundary and gap. Watch mode hides setup without requiring fullscreen permissions. Keep responsive sizing and keyboard focus visible.
