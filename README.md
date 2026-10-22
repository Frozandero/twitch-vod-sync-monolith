# StreamSync

**[Open the app](https://frozandero.github.io/twitch-vod-sync-monolith/)**

Watch Twitch and Kick streams side by side. Sync recordings and clips on a shared timeline with timestamp links, or watch live channels together. Static React/TypeScript app deployed to GitHub Pages; no backend or installation.

## Use

1. Paste Twitch or Kick VOD/clip URLs, timestamped URLs, or numeric Twitch IDs. Separate links with newlines or spaces. Enter adds them; Shift+Enter inserts a newline. The start screen recognises each line before anything is fetched and lists your recent sessions. Once a session is open, the add field in the top bar shows one result per input underneath it: added with its timestamp, already in the session, or failed with an **Edit** action.
2. Play or seek any player and press its **sync** icon. The other players seek to that broadcast moment and follow its play/pause state. Its header shows the platform, name, a short status (drift such as `+3.2 s`, buffering, not started, ended, stopped, or an error with retry), and the time, which is a link to that VOD at that position.
3. The **playback bar** below the grid plays or pauses everyone, skips ±10 seconds, shows the selected moment with a UTC/Local toggle, and reports whether players are in sync, with a resync button when one drifts. Line-up progress, start failures, undo and copy confirmations appear in the same bar, never over video.
4. Show the **timeline** from the bar (or press T). Click or drag to seek all recordings; keyboard arrows, Home and End work too. Its range includes all recordings and gaps; **Overlap** zooms to the span every streamer covers. Thin blue lines mark the selected moment, thicker markers show each player's verified position, and diamonds mark clip moments (click one to jump there). Each row shows the recording's offset, its delta from the selection, a timestamp link and a close button. **Key** in the corner explains the markers. On phones the timeline starts hidden and opens below the bar.
5. Drag a player header's grip onto another player to reorder the grid and timeline without restarting playback. Click the grip, or choose **Move to position** in the player's ⋯ row, to pick a position; focused grips also support arrow keys and Home/End. Order is saved locally and included in shared links and JSON.
6. **Watch mode** (F) hides the top bar and fills the window with the grid; the playback bar stays below it with an exit button, and Escape also leaves. **Undo** (⌘Z/Ctrl+Z) restores the last closed recording to its former position. Closing a non-source recording keeps the others playing when the selected moment still fits the remaining timeline.
7. A player's ⋯ button opens a row in its header with **Timing** (jump everyone to a timestamp in that VOD, or nudge a fixed offset in 0.1 s steps with a live drift readout; Shift steps 1 s), **Listen to … only**, **Copy timestamp link**, **Move to position** and **Close**. Recordings that haven't started or have ended offer a button to move everyone to their start or last minute. Adding a clip or timestamped URL also selects a moment.

Shortcuts: Space play/pause, J/L ±10 s, ←/→ ±5 s, S resync to the source, T timeline, F watch mode, Esc leave watch mode, / add recordings, ⌘Z/Ctrl+Z undo close. They never take keys from text fields or from focused controls that use them, and keys typed inside a Twitch player go to Twitch.

The grid groups streams automatically. On a wide desktop, four use 2×2, five use 3+2, and six use 3×2; shorter rows fill the available width. Up to three streams stay in one row when space permits. Sessions of four or more share the remaining window height, with scrolling when necessary to keep players usable. Resizing, reordering, and toggling watch mode keep the same players mounted. Narrow screens stack them vertically.

To add a streamer, enter **`twitch/streamerName`** or **`kick/streamerName`**. Plain channel URLs also work. The app adds every available past broadcast of that streamer that overlaps a recording already in the session, keeping the current source and selected moment. A streamer who restarted mid-session therefore brings both recordings, even if only one covers the moment. Paste several targets together, or include a VOD/clip in the same batch to give them something to overlap. In a mixed batch the first successfully resolved explicit VOD/clip follows the existing source-selection rule; streamer targets never establish the moment themselves. The add results show one row per recording found, with its timestamp at the selected moment or when it starts or ended. A streamer with no overlapping recording leaves the session intact and shows an error for that input.

A streamer's recordings share **one player and one timeline row**. The player shows whichever of them the selected moment falls in and moves to the next one when playback or a seek reaches it, just as a not-started recording starts. Between two recordings it waits with "Next broadcast in …"; its header shows which recording it is (for example `2/2`). Closing the streamer closes all of their recordings, and Undo restores them together. Reordering, solo audio and Undo work per streamer.

Streamer lookup searches recent public archives: Twitch requests at most ten pages (30 VODs per public page, 100 per authenticated page) and stops once it reaches archives older than the session, and Kick checks its public index of up to 50 recent recordings. Twitch may block anonymous pagination; the optional Twitch connection uses the official API. Deleted, restricted, unindexed, and older recordings may be unavailable. A streamer target is resolved once when added; it does not look for new recordings later.

After a shared seek or Sync, all matching players stay paused until each has reached the requested position and buffered at least two seconds (or the remaining footage near its end). If playback was running, they resume together; a paused seek stays paused. The playback bar shows how many are ready and which recordings it is waiting on. You can change the resume choice with its play/pause button, retry a stalled wait, or cancel it and leave everyone paused. Before-start and ended recordings do not hold up the wait.

Starting also waits for confirmation that every matching VOD is actually playing. If Twitch leaves one paused, the group returns to the selected moment and retries, up to three attempts. A failed start pauses everyone and names the affected recordings. A blocked player can retry muted; its speaker button restores sound. The playback bar's pause button stops all players immediately, including when only a target is playing.

A target that has not started is held at zero. A finished target is held at its end with its Twitch embed removed, preventing Twitch’s Up Next countdown from starting another VOD. Seeking back recreates the original recording. Unexpected video-ID changes also stop the embed before its clock can affect synchronization.

The thin timeline line is the selected broadcast moment; each player’s thicker marker shows its actual reported position. Ahead/behind labels identify drift. A green bar means the confirmed player clock is within two seconds of the selection; metadata overlap alone does not prove playback is aligned. Clip inputs resolve to their parent VOD and clip-start offset. The full metadata-entry form is deliberately absent.

Sessions save locally. Share them by URL (**Share link**) or import/export JSON through the more-options menu. Clip markers travel with the session. The start screen lists up to six recent sessions kept in this browser. Existing version-1 sessions migrate automatically. Sessions previously saved in Links view now open in the grid.

**Kick VODs play in the grid.** Add current or legacy Kick VOD URLs and `/channel/clips/clip_…` or `?clip=clip_…` links. Clips load their parent recording at the clip's start offset. Kick uses a native video player with adaptive HLS quality and participates in shared seeking, buffering, confirmed starts, and actual-clock markers. Mixed and Kick-only sessions save/share normally. No userscript or extension is needed. If public playback is unavailable, the timestamp link still opens the recording on Kick.

Current Kick VOD IDs are resolved through explicit mappings in Kick's older public metadata service. The app checks up to 50 recent channel recordings, reuses concurrent lookups, and caches metadata for five minutes. Older or unindexed recordings may fail because Kick's newer service blocks cross-origin browser requests. Missing parents, private/expired recordings, and incomplete broadcasts produce an error; there is no proxy or guessed broadcast date.

## Watch live channels

Paste **`twitch/name`**, **`kick/name`** or channel URLs on their own into an empty workspace to watch those channels live, side by side. At least one must be live now; offline channels join the session and start on their own when their stream begins. Inside a live session the add field takes more channels (live or offline); VODs and clips are refused with an explanation, so close the live channels to sync recordings. Next to a VOD or clip, the same channel inputs keep finding that streamer’s past broadcast instead.

Live channels play at their own live edge: there is no shared clock, timeline or seeking. The playback bar plays and pauses everyone and summarises how many are live, loading, paused or offline. Only the first channel has sound by default; each header has a mute button, and **Listen to … only** in the ⋯ row picks one channel. Twitch headers show the broadcaster latency Twitch reports (for example `2.4 s`) as a link to the channel. Reordering, closing with Undo, watch mode, Share link, export/import and recent sessions work as they do for recordings. A Twitch player that Twitch holds for the viewer, such as behind a content notice or a browser autoplay block, shows **press play**; press play inside it.

Kick live channels use Kick’s own embedded player, which has no controls a website can drive. Pausing removes the Kick player and Play recreates it at the live edge; muting or unmuting reloads it with Kick’s `muted` setting, so those changes re-buffer for a few seconds. Kick has shown some live streams, such as Slots & Casino streams, as offline inside its embed; open them on Kick with the header link.

Use the **UTC / Local** toggle beside the shared clock to switch all clocks to your device's local timezone and back. The date follows the selected timezone; recording offsets and timestamp links still refer to the same moment.

## Limitations

- Anonymous Twitch metadata uses an undocumented endpoint and can change. An optional official Twitch connection is available.
- Expired/private VODs, missing clip parents, highlights, and uploads may not resolve. No content restrictions are bypassed.
- Ads, buffering, stream delays, edits, and reconnect gaps can shift alignment. Sync again or adjust a known fixed offset; there is no continuous drift correction.
- The shared seek wait uses Twitch's reported position/buffer and Kick's actual media position/buffered ranges. It does not preload an entire recording or guarantee simultaneous frames; later stalls and browser autoplay restrictions can still occur.
- Kick playback depends on its undocumented public metadata and CORS-enabled video CDN. The loaded playlist's duration replaces the broadcast duration when they differ. This corrects the end boundary, not missing footage or gaps inside a recording.
- Twitch requires a 400×300 minimum embed. Small screens have a contained player scroll area.
- Twitch pauses or refuses to start players that are covered or mostly scrolled out of view; on phones, start playback with the Twitch players you want on screen.
- Live status comes from the same public metadata lookups (refreshed every minute) and can lag the players. Kick live playback depends on its embed, which the app can only show, hide or reload.
- Large sessions can strain the browser. There is no visible 12-recording quota; imports/requests have a 100-item resource guard. Oversized share URLs prompt JSON export.

See [research](docs/RESEARCH.md) and [verification status](docs/STATUS.md).

## Develop

Node.js 22.12+ is required; CI uses Node 24.

```sh
npm ci
npm run dev
npm run check
```

`check` runs TypeScript, core/provider tests, and the production build. `npm run format` formats code and documentation. Generated output is `apps/web/dist` and is not committed.

## Deployment and repository structure

A single npm-workspace monorepo builds directly to a GitHub Pages artifact. A separate Pages repository/submodule is unnecessary and would add pointer/deployment-credential maintenance. This follows the alternative allowed in the original project request. See [ADR 001](docs/adr/001-monorepo-pages.md).

```text
apps/web/               UI, Twitch/Kick players, optional OAuth
packages/sync-core/     Pure URL, timeline, and validated session functions
packages/providers/     Isolated metadata adapters
docs/                   Research, architecture, decisions, status, roadmap
.github/workflows/      Checks and Pages artifact deployment
```

Pages uses **GitHub Actions** as its source. Pushes to `main` validate, build, and deploy; pull requests validate/build without deploying. The workflow derives the repository base path from GitHub. No SPA server rewrite is needed because shared state uses the URL fragment.

The requested `vodsync.frozander.dev` migration is deferred until the domain's registration is restored. The app remains on its working `github.io` address. See [the custom-domain runbook](docs/DEPLOYMENT.md) for the verified settings and migration checks.

A future extension belongs in `apps/extension` and can reuse both packages. None is shipped or installed. See [roadmap](docs/ROADMAP.md), [agent guidance](AGENTS.md), and [contribution guide](CONTRIBUTING.md).

## Optional official Twitch connection

1. Register a web application in the [Twitch developer console](https://dev.twitch.tv/console/apps).
2. Add the exact redirect URL shown under **More options → Twitch connection**, including the Pages trailing slash.
3. Enter its public Client ID in the app and connect. Alternatively set the GitHub repository Actions variable `VITE_TWITCH_CLIENT_ID` and redeploy. For local development, copy `.env.example` to `.env`.

No client secret is used. The browser uses Twitch's implicit grant with empty scope, verifies one-time state, and validates the token on startup and every 55 minutes. Tokens stay in tab session storage and never enter shared URLs/JSON. Disconnect removes the local token; Twitch's own Connections page controls account-side revocation.

## Privacy

Recording metadata is stored in your browser. Metadata requests go directly to Twitch or Kick; playback goes to Twitch's embed or Kick's video CDN. Twitch embeds have their own cookies/network behavior. Kick public media requests need no login. Media playlist URLs remain transient and are excluded from saved/shared sessions. No app backend, analytics, external font service, or public CORS proxy is used. Shared sessions expose recording URLs and timing to anyone with the link, not credentials.

Kick playback uses [hls.js](https://github.com/video-dev/hls.js), licensed under Apache 2.0. Distributed [copyright notices](apps/web/public/licenses/hls.js.txt) and [license text](apps/web/public/licenses/Apache-2.0.txt) are included with the site. The interface uses the Torque design system and self-hosts [Geist and Geist Mono](https://github.com/vercel/geist-font) under the SIL Open Font License ([Geist](apps/web/public/licenses/Geist-OFL.txt), [Geist Mono](apps/web/public/licenses/GeistMono-OFL.txt)); no external font service is contacted.
