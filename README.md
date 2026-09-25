# VOD Sync

**[Open the app](https://frozandero.github.io/twitch-vod-sync-monolith/)**

Sync Twitch and Kick recordings in a grid, resolve clips on a shared timeline, and open timestamp links. Static React/TypeScript app deployed to GitHub Pages; no backend or installation.

## Use

1. Paste Twitch or Kick VOD/clip URLs, timestamped URLs, or numeric Twitch IDs in the input. Separate links with newlines or spaces. Enter adds them; Shift+Enter inserts a newline.
2. Play or seek any player and click **Sync** in its header. The other players seek to that broadcast moment and follow its play/pause state.
3. Click or drag the timeline to seek all recordings. Keyboard arrows, Home, and End work too. Its range includes all recordings and gaps. The **chevron button in the top-right player header** collapses or expands the timeline without interrupting playback. It stays in place in both states, and a hidden timeline takes no space below the grid. This preference is saved locally. The × beside a timeline name removes that recording from the session, just like its player’s close button.
4. Use the go-to icon beside any timeline timestamp to open that VOD at the selected moment. Player headers also retain a link to their current playback position. These are regular links that can be copied through the browser's link menu. Non-matches are labeled with exact gaps in player overlays and timeline tooltips; their links open the recording boundary.
5. Drag a player header’s grip onto another player to reorder the grid and timeline without restarting playback. Click the grip for position selection and move buttons; focused grips also support arrow keys and Home/End. Order is saved locally and included in shared links and JSON.
6. **Watch mode** hides setup controls and fills the available height with the existing grid. Its exit icon sits beside the timeline toggle in the top-right player header; Escape also restores setup. Neither control reserves an empty row or covers a video. Each player has sync, mute, settings, open, and remove controls. **Undo** restores the last closed recording to its former position. Closing a non-source recording keeps the others playing when the selected moment still fits the remaining timeline.
7. A recording's settings let you enter a playback timestamp or adjust a fixed timing offset. Adding a clip or timestamped URL also selects a moment.

To add a streamer at the current seeker time, enter **`twitch/streamerName`** or **`kick/streamerName`**. Plain channel URLs also work. The app finds an available past broadcast covering that moment and adds it at the matching timestamp, retaining the current source. Paste several targets together, or include a source VOD/clip in the same batch to establish the moment. In a mixed batch the first successfully resolved explicit VOD/clip follows the existing source-selection rule; streamer targets never establish the moment themselves. Lookups capture the selected moment when submitted. A missing match leaves the session intact and shows an error for that input.

Streamer lookup searches recent public archives: Twitch requests at most ten pages (30 VODs per public page, 100 per authenticated page), and Kick checks its public index of up to 50 recent recordings. Twitch may block anonymous pagination; the optional Twitch connection uses the official API. Deleted, restricted, unindexed, and older recordings may be unavailable. A streamer target is resolved once when added; it does not automatically switch recordings when you later seek.

After a shared seek or Sync, all matching players stay paused until each has reached the requested position and buffered at least two seconds (or the remaining footage near its end). If playback was running, they resume together; a paused seek stays paused. A compact progress row shows how many are ready. You can change the resume choice with the timeline play/pause button, retry a stalled wait, or cancel it and leave everyone paused. Before-start and ended recordings do not hold up the wait.

Starting also waits for confirmation that every matching VOD is actually playing. If Twitch leaves one paused, the group returns to the selected moment and retries, up to three attempts. A failed start pauses everyone and names the affected recordings. A blocked player can retry muted; its speaker button restores sound. The timeline pause button stops all players immediately, including when only a target is playing.

A target that has not started is held at zero. A finished target is held at its end with its Twitch embed removed, preventing Twitch’s Up Next countdown from starting another VOD. Seeking back recreates the original recording. Unexpected video-ID changes also stop the embed before its clock can affect synchronization.

The thin timeline line is the selected broadcast moment; each player’s thicker marker shows its actual reported position. Ahead/behind labels identify drift. A green bar means the confirmed player clock is within two seconds of the selection; metadata overlap alone does not prove playback is aligned. Clip inputs resolve to their parent VOD and clip-start offset. The full metadata-entry form is deliberately absent.

Sessions save locally. Share them by URL or import/export JSON through the more-options menu. Existing version-1 sessions migrate automatically. Sessions previously saved in Links view now open in the grid.

**Kick VODs play in the grid.** Add current or legacy Kick VOD URLs and `/channel/clips/clip_…` or `?clip=clip_…` links. Clips load their parent recording at the clip's start offset. Kick uses a native video player with adaptive HLS quality and participates in shared seeking, buffering, confirmed starts, and actual-clock markers. Mixed and Kick-only sessions save/share normally. No userscript or extension is needed. If public playback is unavailable, the timestamp link still opens the recording on Kick.

Current Kick VOD IDs are resolved through explicit mappings in Kick's older public metadata service. The app checks up to 50 recent channel recordings, reuses concurrent lookups, and caches metadata for five minutes. Older or unindexed recordings may fail because Kick's newer service blocks cross-origin browser requests. Missing parents, private/expired recordings, and incomplete broadcasts produce an error; there is no proxy or guessed broadcast date.

## Limitations

- Anonymous Twitch metadata uses an undocumented endpoint and can change. An optional official Twitch connection is available.
- Expired/private VODs, missing clip parents, highlights, and uploads may not resolve. No content restrictions are bypassed.
- Ads, buffering, stream delays, edits, and reconnect gaps can shift alignment. Sync again or adjust a known fixed offset; there is no continuous drift correction.
- The shared seek wait uses Twitch's reported position/buffer and Kick's actual media position/buffered ranges. It does not preload an entire recording or guarantee simultaneous frames; later stalls and browser autoplay restrictions can still occur.
- Kick playback depends on its undocumented public metadata and CORS-enabled video CDN. The loaded playlist's duration replaces the broadcast duration when they differ. This corrects the end boundary, not missing footage or gaps inside a recording.
- Twitch requires a 400×300 minimum embed. Small screens have a contained player scroll area.
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

A future extension belongs in `apps/extension` and can reuse both packages. None is shipped or installed. See [roadmap](docs/ROADMAP.md), [agent guidance](AGENTS.md), and [contribution guide](CONTRIBUTING.md).

## Optional official Twitch connection

1. Register a web application in the [Twitch developer console](https://dev.twitch.tv/console/apps).
2. Add the exact redirect URL shown under **More options → Twitch connection**, including the Pages trailing slash.
3. Enter its public Client ID in the app and connect. Alternatively set the GitHub repository Actions variable `VITE_TWITCH_CLIENT_ID` and redeploy. For local development, copy `.env.example` to `.env`.

No client secret is used. The browser uses Twitch's implicit grant with empty scope, verifies one-time state, and validates the token on startup and every 55 minutes. Tokens stay in tab session storage and never enter shared URLs/JSON. Disconnect removes the local token; Twitch's own Connections page controls account-side revocation.

## Privacy

Recording metadata is stored in your browser. Metadata requests go directly to Twitch or Kick; playback goes to Twitch's embed or Kick's video CDN. Twitch embeds have their own cookies/network behavior. Kick public media requests need no login. Media playlist URLs remain transient and are excluded from saved/shared sessions. No app backend, analytics, external font service, or public CORS proxy is used. Shared sessions expose recording URLs and timing to anyone with the link, not credentials.

Kick playback uses [hls.js](https://github.com/video-dev/hls.js), licensed under Apache 2.0. Distributed [copyright notices](apps/web/public/licenses/hls.js.txt) and [license text](apps/web/public/licenses/Apache-2.0.txt) are included with the site.
