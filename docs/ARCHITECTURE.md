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

The shared moment is independent of the last selected player's interval. This is necessary for a seeker spanning all recordings, including gaps when none is playing. Timeline bounds are the union's earliest start and latest end. Seeker preview is local while dragging; release or a keyboard action prepares a shared seek, retaining the previous play/pause intent.

GET Clips `vod_offset` and GraphQL `videoOffsetSeconds` are the clip start in the parent VOD. Add the clip-local offset; fetch the parent broadcast's start. Never use clip creation time or subtract clip duration. Reject automatic mapping of highlights/uploads.

## Player coordination

A sync command contains the UTC moment, desired play/pause state, last selected player key, monotonic serial, bounded start-attempt count, and preparation/starting/release/cancellation phase. Clicking a player's Sync reads its position and pause state. Targets seek to matching offsets; those out of bounds pause. The selected player supplies audio; mute can be adjusted separately.

During preparation all players pause and mute, and the shared clock stays at the selected moment. Each matching player must confirm its target through a validated SEEK position or actual clock within 0.5 seconds, report a buffer of at least two seconds (or its remaining duration), and stay paused with these conditions for 500 ms. The coordinator samples all current handles and releases only when every required player reports ready for that command's serial. Before/ended intervals are excluded. A newer seek replaces the old preparation; removed recordings leave the required set. Playback resumes for all required players only if requested; otherwise they remain paused. The timeline button changes that intent while waiting. Cancel leaves everyone paused; a prolonged wait offers Retry, with no timeout that silently starts ready players alone.

Twitch READY gates commands, not buffered readiness. The initial embed URL also includes the desired time because READY may precede loaded media. Unacknowledged seeks have bounded retries; once acknowledged, let the buffer fill without repeated seeks. Twitch's paused clock may lag behind SEEK's reported position, so the clock adapter retains that validated position until the raw clock catches up. Preparation listens to PLAY/PLAYING and pauses premature playback. Readiness indicators stay in headers and the shared progress row, outside the embed. Unmount removes listeners/iframes. Loading failures and playback-blocked events are surfaced. This is a seek barrier, not continuous drift correction or full-VOD preloading.

The identity/end guard checks the public SDK's getVideo/getEnded before accepting positions or playback commands, and listens for ENDED. Finishing or changing identity synchronously pauses and detaches the iframe, then latches the stopped state for that command. A subsequent playable sync/seek recreates the requested VOD with the current shared moment; a changed-ID stop also offers an explicit reload. A source ending advances the selection to its exact end. Other players reaching a boundary cannot advance the source clock or resurrect a stopped embed.

After buffering, requested playback enters a starting phase. A void play request or an unpaused state is not success: every matching player must acknowledge PLAYING for the current serial and remain unpaused. A player that acknowledges playback and then legitimately ends also counts, so very short remaining footage cannot deadlock the group. The shared clock stays frozen until all acknowledge. A silently paused player gets 2.5 seconds; loading or unpaused buffering gets 10 seconds. An explicit PLAYBACK_BLOCKED can retry sooner. Each retry pauses and prepares the entire group again at the same selected moment with a new serial, with at most three attempts. Exhaustion cancels all playback and names the players that failed. A blocked player tries muted once and retains that mute choice until the user changes it. This does not bypass a required direct gesture or a content restriction.

Starting play requests allow 500 ms and a paint frame for Twitch's visibility report to catch up after resizing. A newer command or cancellation cleans up that pending play. Transitioning from starting to released does not issue a second play request. The timeline shows Pause if any matching player is playing, regardless of the source; Pause and Cancel stop immediately without seeking. After a confirmed group start, individual player controls remain independent: there is no continuous forced playback. Watch-mode exit stays above the grid rather than floating over a video.

The timeline follows the last synced player's clock while it plays. Reading clocks does not issue repeated seeks. There is no separate Links view. Timeline links use the displayed shared moment; header links use the respective player's current clock. Watch mode and collapsing the seeker only change layout, preserving player instances and playback. Collapsing discards an uncommitted seek preview; its preference is saved locally.

Each handle also exposes a transient playback snapshot. The seeker draws the selected moment separately from verified actual player clocks, marks differences above two seconds as ahead/behind, and never paints a loading, finished, or switched player as aligned. Broadcast coverage remains based on metadata and is not treated as proof of content/event alignment. Playback snapshots are not serialized into sessions.

Session VOD array order is the grid/timeline order. Player DOM nodes stay sorted by stable identity; CSS order changes their visual position. React keys alone do not prevent iframe navigation when a DOM node is moved. Reordering must not issue playback commands, change the source, or move iframe DOM nodes. Header grips support desktop drag/drop, keyboard arrows/Home/End, and a position dialog for touch. Position announcements describe keyboard moves. Loaded share fragments are updated when reordering so refresh retains the new order.

Closing a non-source player leaves playback untouched unless the shared moment must clamp to the remaining timeline. Source removal chooses a remaining source and issues a paused sync. The last closed VOD and its former index are kept transiently for Undo; restoration leaves existing players alone, while restoring an empty workspace initializes a paused session. Explicit clear/import discards this undo entry.

Third-party iframe controls, content restrictions, ads, buffering, and autoplay remain Twitch-controlled. Before Twitch reports a position, acknowledges a seek, or emits PLAYING, the header shows the requested position and disables Sync from that player. Its initial zero must not overwrite the shared moment. A buffered preparation at zero can confirm a legitimate start position; once the clock is confirmed, a subsequent zero is also a valid user seek.

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

Use a compact utility interface: URL input, player grid, per-player actions, and a collapsible seeker. No view tabs, slogans, decorative workspace headings, sidebar recording list, demo button, manual metadata-entry form, or feature footer. Every timeline row has a remove button beside its name and a timestamp link beside its time; the seek overlay must not cover either control. Timeline and player removal share the same session operation. The collapsed timeline occupies only its expand button, including in watch mode. Before/ended links explicitly identify the boundary and gap. Watch mode hides setup without requiring fullscreen permissions. Keep responsive sizing and keyboard focus visible.
