# Architecture

## Boundaries

An npm-workspace monorepo builds static HTML/CSS/JavaScript with Vite into `apps/web/dist`. GitHub Actions deploys that artifact to Pages. There is no backend, proxy, service worker, database, or runtime secret.

- `@vodsync/core`: validated URL parsing, timestamps, UTC arithmetic, before/playing/ended states, canonical links, versioned sessions. No third-party dependencies; reusable by an extension.
- `@vodsync/providers`: optional official Twitch Helix and anonymous Twitch GraphQL adapters. Fetch is injectable for deterministic tests. Requests time out and omit cookies. The Kick adapter is isolated in `kick.ts`: completed VOD metadata, legacy/current ID normalization, parent-VOD clip offsets, and a bounded channel index lookup. Shared in-flight requests and a five-minute memory cache contain validated metadata, IDs, and separately allowlisted public playback sources. Media URLs never enter a Vod or session.
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

## Streamer target resolution

`parseChannelTarget` distinguishes `twitch/name`, `kick/name`, and plain channel URLs from media references. It rejects credentials, unexpected hosts/ports, and query/hash variants, leaving query-style Kick clips on the clip path. `recordingInputs.ts` resolves explicit media first in bounded batches, applies the established first-successful-media anchor rule, then resolves streamer targets against that single captured UTC moment. Channel-only inputs require an existing session. Targets never choose the source; additions preserve paste order, canonical-ID deduplication, existing corrections, and loaded durations. Each failed input is retained for correction without discarding successful additions or existing VODs. Only concrete normalized VODs are saved; no ongoing channel subscription is created.

Twitch channel lookup validates login/owner/archive type and paginates with bounded, nonrepeating cursors. Public GraphQL allows up to ten pages of 30 entries; authenticated Helix resolves the user ID and requests up to ten pages of 100 archives sorted by time. Provider failures stop lookup, with no anonymous fallback after authenticated failure. Kick reuses the five-minute channel index cache, filters reliable broadcast-time hints, and confirms each candidate through canonical detail metadata, public/completed status, owner, and half-open coverage. It fetches at most three candidates concurrently within the existing 50-entry limit. Newest-start matching candidates are preferred within the current page/batch; no nearest-date or newest-VOD fallback is allowed. The final selected recording must still cover the moment after saved correction and duration are applied.

## Player coordination

A sync command contains the UTC moment, desired play/pause state, last selected player key, monotonic serial, bounded start-attempt count, and preparation/starting/release/cancellation phase. Clicking a player's Sync reads its position and pause state. Targets seek to matching offsets; those out of bounds pause. The selected player supplies audio; mute can be adjusted separately.

During preparation all players pause and mute, and the shared clock stays at the selected moment. Each matching player must confirm its target through a validated SEEK position or actual clock within 0.5 seconds, report a buffer of at least two seconds (or its remaining duration), and stay paused with these conditions for 500 ms. The coordinator samples all current handles and releases only when every required player reports ready for that command's serial. Before/ended intervals are excluded. A newer seek replaces the old preparation; removed recordings leave the required set. Playback resumes for all required players only if requested; otherwise they remain paused. The timeline button changes that intent while waiting. Cancel leaves everyone paused; a prolonged wait offers Retry, with no timeout that silently starts ready players alone.

Twitch READY gates commands, not buffered readiness. The initial embed URL also includes the desired time because READY may precede loaded media. Unacknowledged seeks have bounded retries; once acknowledged, let the buffer fill without repeated seeks. Twitch's paused clock may lag behind SEEK's reported position, so the clock adapter retains that validated position until the raw clock catches up. Preparation listens to PLAY/PLAYING and pauses premature playback. Readiness indicators stay in headers and the shared progress row, outside the embed. Unmount removes listeners/iframes. Loading failures and playback-blocked events are surfaced. This is a seek barrier, not continuous drift correction or full-VOD preloading.

The identity/end guard checks the public SDK's getVideo/getEnded before accepting positions or playback commands, and listens for ENDED. Finishing or changing identity synchronously pauses and detaches the iframe, then latches the stopped state for that command. A subsequent playable sync/seek recreates the requested VOD with the current shared moment; a changed-ID stop also offers an explicit reload. A source ending advances the selection to its exact end. Other players reaching a boundary cannot advance the source clock or resurrect a stopped embed.

After buffering, requested playback enters a starting phase. A void play request or an unpaused state is not success: every matching player must acknowledge PLAYING for the current serial and remain unpaused. A player that acknowledges playback and then legitimately ends also counts, so very short remaining footage cannot deadlock the group. The shared clock stays frozen until all acknowledge. A silently paused player gets 2.5 seconds; loading or unpaused buffering gets 10 seconds. An explicit PLAYBACK_BLOCKED can retry sooner. Each retry pauses and prepares the entire group again at the same selected moment with a new serial, with at most three attempts. Exhaustion cancels all playback and names the players that failed. A blocked player tries muted once and retains that mute choice until the user changes it. This does not bypass a required direct gesture or a content restriction.

Starting play requests allow 500 ms and a paint frame for Twitch's visibility report to catch up after resizing. A newer command or cancellation cleans up that pending play. Transitioning from starting to released does not issue a second play request. The timeline shows Pause if any matching player is playing, regardless of the source; Pause and Cancel stop immediately without seeking. After a confirmed group start, individual player controls remain independent: there is no continuous forced playback. Watch-mode exit stays in a player header, outside the video.

The timeline follows the last synced player's clock while it plays. Reading clocks does not issue repeated seeks. There is no separate Links view. Timeline links use the displayed shared moment; header links use the respective player's current clock. Watch mode and collapsing the seeker only change layout, preserving player instances and playback. Collapsing discards an uncommitted seek preview; its preference is saved locally.

Each handle also exposes a transient playback snapshot. The seeker draws the selected moment separately from verified actual player clocks, marks differences above two seconds as ahead/behind, and never paints a loading, finished, or switched player as aligned. Broadcast coverage remains based on metadata and is not treated as proof of content/event alignment. Playback snapshots are not serialized into sessions.

Session VOD array order is the grid/timeline order. Player DOM nodes stay sorted by stable identity; CSS order changes their visual position. React keys alone do not prevent iframe navigation when a DOM node is moved. Reordering must not issue playback commands, change the source, or move iframe DOM nodes. Header grips support desktop drag/drop, keyboard arrows/Home/End, and a position dialog for touch. Position announcements describe keyboard moves. Loaded share fragments are updated when reordering so refresh retains the new order.

The grid balances recording count and available width through pure `gridLayout` arithmetic. Its row count respects both the width capacity and a count-based grouping; rows differ by at most one recording. Fractional CSS tracks let shorter rows fill the width, with explicit row/column spans assigned by session order while DOM nodes remain sorted by identity. Four desktop recordings form 2×2; five form 3+2; three retain one row when space permits. `useGridLayout` observes width and responsive minimum/gap values, not player clocks. A layout update never emits playback commands or reconstructs media.

For four or more recordings, the shell uses the viewport height and the grid shares the space left by input, status, and timeline controls. Each row remains at least 338 pixels, including its header; smaller windows and larger sessions scroll instead of reducing video below Twitch's 300-pixel height. Width capacity retains a 402-pixel minimum card (400-pixel embed plus borders), rising to the existing 530-pixel preference on wide desktops. Smaller screens use one column with contained embed overflow. Watch mode uses the same grouping and fills available height. The exit icon and timeline toggle remain in the last header of the first row, following visual order without covering video. Timeline visibility is persisted; hiding it preserves media nodes and takes no separate control strip.

Closing a non-source player leaves playback untouched unless the shared moment must clamp to the remaining timeline. Source removal chooses a remaining source and issues a paused sync. The last closed VOD and its former index are kept transiently for Undo; restoration leaves existing players alone, while restoring an empty workspace initializes a paused session. Explicit clear/import discards this undo entry.

Third-party iframe controls, content restrictions, ads, buffering, and autoplay remain Twitch-controlled. Before Twitch reports a position, acknowledges a seek, or emits PLAYING, the header shows the requested position and disables Sync from that player. Its initial zero must not overwrite the shared moment. A buffered preparation at zero can confirm a legitimate start position; once the clock is confirmed, a subsequent zero is also a valid user seek.

## Persistence

Sessions are validated before export/import:

- Version 2 stores recordings, `leaderKey`, absolute `momentMs`, and a legacy view field. The web app always exports `grid` and accepts older `links` sessions into the grid without losing their recordings or moment.
- Version 1 migrates its source key/relative timestamp into the same absolute moment. The local storage key is preserved.
- Twitch, Kick-only, and mixed sessions retain their recordings and source on import/restore.
- Required unique identities, canonical supported-host URLs, timezone-aware dates, finite numeric bounds, a leader present in the recordings, and a moment inside the full timeline are enforced.
- Imports have size and 100-item resource guards. Shared fragments are base64url UTF-8 JSON capped at 60,000 characters; larger sessions use JSON export.
- Constructing a new allowlisted session strips unknown keys, including credentials.

Local storage holds the recording session and optional public Client ID. Session storage holds OAuth state/token. Storage failures preserve in-memory use; sign-in requires writable session storage. OAuth checks one-time state and validates the token on launch and every 55 minutes. No account secret is embedded.

## Interface constraints

Use a compact utility interface: URL input, player grid, per-player actions, and a collapsible seeker. No view tabs, slogans, decorative workspace headings, sidebar recording list, demo button, manual metadata-entry form, or feature footer. Every timeline row has a remove button beside its name and a timestamp link beside its time; the seek overlay must not cover either control. Timeline and player removal share the same session operation. Exit watch mode and timeline toggle share an existing player header; do not reserve otherwise empty rows or place controls over Twitch's content. Before/ended links explicitly identify the boundary and gap. Watch mode hides setup without requiring fullscreen permissions. Keep responsive sizing and keyboard focus visible.

## Kick capabilities

Kick VOD playback uses an HTML video element with native controls and dynamic hls.js loading (or native HLS where available). This is independent of Kick's live-channel embed. `kickPlayer.ts` exposes the same handle operations as Twitch. A loaded media clock, not a requested seek value, supplies actual position. Seek readiness requires `seeking === false`, available current media, and a contiguous buffered range containing the actual position. A requested time up to 50 ms before the first buffered frame seeks to that frame and waits again; the gap itself is never counted as buffered. Native `playing` confirms starts; a fulfilled play request alone does not. Kick-only and mixed sessions participate in the same buffer/start barriers. No continuous forced playback is added.

Loaded playlist duration replaces Kick's broadcast metadata duration when different, rounded inward to the UTC model's millisecond precision so nonexistent fractional end buffer is never required. If this shortens the whole session, the selected moment clamps to its new bounds. It does not adjust the broadcast start or infer missing middle segments. Ended/before-start players are detached; a playable seek creates the original recording again. Cleanup aborts event listeners, destroys HLS loading, and removes the media source. Fatal media errors stop playback and offer Retry or the existing timestamp link. Cancellation pauses pending starts; normal browser autoplay rules still apply.

`resolveKickPlayback` re-resolves the canonical identity, then returns only a public provider-supplied HTTPS `.m3u8` URL on `stream.kick.com`, without credentials, ports, or fragments. Source URLs stay in a five-minute memory cache separate from normalized VODs; Retry refreshes provider data. Requests carry no Twitch credentials, custom auth, or userscript privileges. hls.js uses bounded network retries and adaptive quality, capped to player size, with modest forward/back buffers. Its chunk loads only for Kick playback; license notices are shipped in `public/licenses`.

`kick.ts` tries the cookie-free legacy VOD endpoint first. Its `livestream.vod_id` explicitly identifies the current canonical VOD. On 404, a channel-qualified URL can inspect up to 50 legacy list entries in batches of three, matching the requested ID against that explicit field. It never equates recordings by date/duration or derives an identity from UUID bytes. Metadata preserves the broadcast start, and legacy duration milliseconds are converted to seconds. New-service durations are already seconds. The new service is a final fallback but currently fails CORS from external websites; the error is explicit. Restriction/rate-limit responses do not trigger a bypass. Clip resolution requires a valid parent, nonnegative `vod_starts_at`, a clip-local time within duration, and a resulting offset inside the parent VOD. Unrelated response fields are discarded.
