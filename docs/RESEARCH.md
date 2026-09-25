# Browser-only feasibility research

Research date: **2026-09-25**. Capability claims below distinguish official documentation, existing implementations, and observations made during development. Platform behavior can change.

## Current scope

The owner removed manual metadata entry and the separate Links view, then requested Kick support on 2026-09-25. After reviewing the owner's Kickstiny and playback-fix references, the release includes Twitch and Kick VOD playback plus clip timestamp matching in the compact grid and shared timeline.

## Feasibility decision

Both requested workflows are feasible on GitHub Pages for Twitch and public Kick recordings. Twitch uses its official embed; Kick uses public-site metadata and a browser HLS player. The earlier conclusion that the absence of a controllable VOD embed required link-only Kick support was too restrictive: Kick's public VOD playlist supports direct cross-origin playback. The static app needs no extension, unrelated service, or CORS proxy.

## Twitch playback

[Twitch's video and clips embed documentation](https://dev.twitch.tv/docs/embed/video-and-clips/) documents interactive VOD controls including `seek`, `getCurrentTime`, `isPaused`, `play`, `pause`, and readiness events. These run client-side and can be used from an HTTPS GitHub Pages site. The app passes the current hostname as the embed parent. Twitch requires a minimum player size of 400×300; narrow screens get a contained horizontal scroll region rather than an undersized embed. Mobile and unmuted programmatic playback may need a gesture.

A sync button can read a leader's position and seek the other players after converting through broadcast time. An iframe for a clip itself does not offer the same controllable playback contract; the implementation resolves the clip to its parent VOD first. The app respects Twitch's player and content restrictions.

**Up Next regression, observed 2026-09-25:** the supplied session correctly identified xQc VOD `2882233662`, starting `2026-09-23T21:41:28Z` with metadata duration 33,305 seconds (9:15:05). A clean embed reported the same ID and 33,305.1 seconds. Playing through its end reproduced Twitch switching to `2882100152`. That replacement starts at `2026-09-23T18:40:46Z` and has duration 10,763 seconds (2:59:23), exactly the different duration in the user's screenshot. The previous app retained the original ID/start in its timeline while accepting the replacement's clock. This explains the misleading alignment without changing either VOD's metadata or inventing a timing correction.

The documented SDK provides ENDED, getEnded, and getVideo, but does not document a switch to disable Up Next. The app therefore removes the iframe on an end event or unexpected ID, holds its logical boundary, and recreates only the original VOD on a playable seek. `autoplay: false` alone did not prevent the observed end-of-recording transition. Actual-clock markers and drift labels distinguish metadata overlap from verified playback synchronization.

**Paused buffering, observed 2026-09-25:** the [official embed API](https://dev.twitch.tv/docs/embed/video-and-clips/) documents `getPlaybackStats().bufferSize` in seconds, SEEK, and PLAYING. READY only indicates that commands can be accepted, and `isPaused()` alone does not establish buffered readiness. In an isolated real omie embed, a paused seek to 21,000 seconds emitted SEEK with `{ position: 21000 }` while `getCurrentTime()` still returned 19,531.119669. The buffer grew from zero to about ten seconds without starting playback. The SEEK event's position payload is an observed SDK shape, not a field contract described in the documentation's prose; validate it and retain a clock-based fallback. The app waits for a confirmed target plus two seconds of buffer stable for 500 ms on every matching player before releasing playback. Less than two seconds remaining requires only that remainder.

An experimental overlay covering the player caused Twitch to reject programmatic playback for its style-visibility requirement. The former floating watch-mode exit button also overlapped a player and could cause this rejection. Readiness feedback therefore stays outside the embed, in the header and shared progress row. The watch-mode exit and timeline toggle now share an existing player header, eliminating empty control strips while remaining outside video content. This follows [Twitch's unobscured-embed requirement](https://dev.twitch.tv/docs/embed/); no visibility, autoplay, or content restrictions are circumvented. This buffering check cannot guarantee future network throughput or frame-exact playback across independent embeds.

**Start confirmation, checked 2026-09-25:** the [official embed API](https://dev.twitch.tv/docs/embed/video-and-clips/) distinguishes PLAY (unpaused, potentially still buffering) from PLAYING (video playback starts). `play()` returns no success result, and `isPaused()` can be false while seeking or buffering. PLAYBACK_BLOCKED identifies prevented playback, commonly programmatic playback with sound. The app now confirms PLAYING from every matching player for the current command, retries a missed start by pausing and preparing the group at the same moment, and stops after three attempts. A blocked start may retry muted through the documented mute control; a required direct gesture still requires the user.

In isolated real Twitch embeds, deliberately dropping one SDK play request reproduced a normal paused target while the other two played. The new coordinator detected it and restarted all three at the selected moment. Dropping every request for that target stopped the group after exactly three attempts; restoring the method allowed a subsequent user start. These are controlled fault injections, not proof of the cause of every intermittent Twitch failure reported by a user.

## Twitch metadata and clips

The official [Get Videos and Get Clips reference](https://dev.twitch.tv/docs/api/reference/) provides VOD creation time/duration/type and clips' parent `video_id` plus `vod_offset`. GET Clips defines this offset as the **start**, unlike the input to the separate Create Clip From VOD endpoint, which describes an end position. A null offset or missing parent is not recoverable from `created_at`: clip creation may happen long after the broadcast.

Official metadata requires OAuth. Twitch explicitly documents [implicit grant for applications without a server](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/). The app supports this with a registered public Client ID, empty scope, state checks, session-only token storage, and validation. Registration/sign-in requires a Twitch owner/user interaction; no application secret is embedded.

For a paste-and-go default, existing projects use Twitch's internal GraphQL API. Examples inspected as implementation research include [remram44/twitch-vod-sync](https://github.com/remram44/twitch-vod-sync), [Miguel2597/twitch-clip-vod-sync](https://github.com/Miguel2597/twitch-clip-vod-sync), and the [TwitchDownloader metadata implementation](https://github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCore/TwitchHelper.cs). No project source was copied into this repository.

**Observed:** an anonymous GraphQL query for Twitch's recent archive `2882198501` returned its title, owner, archive type, creation time, and duration. Response headers included `Access-Control-Allow-Origin: *` for a request using the intended Pages origin. This is an observation, not a support guarantee. The public Twitch web application's Client ID is a widely exposed identifier, not a secret or authentication bypass. Only metadata is queried; playback stays in Twitch's official embed.

The undocumented adapter is isolated so it can be removed if Twitch changes or disallows it. Errors point to retrying or connecting the official API. Automatically mapping highlights and uploads is rejected to avoid confusing publication time with the actual event.

**Browser verified:** past broadcasts `2882012892` and `2882074717` resolved directly from the app. At `02:00:00` in the first, the second matched `00:46:07`; both official embedded players played at those positions. Clip `AbstruseEphemeralFishHumbleLife-jtmCU3snysCf8iSm?t=5` resolved to parent VOD `2877735401` at `09:47:17`, with all recordings retained in the links view.

## Kick — observed 2026-09-25

[Kick's embed help](https://help.kick.com/en/articles/8010826-how-to-embed-your-kick-livestream) documents live-channel embedding. The currently served [official player](https://player.kick.com/aikobliss) application has channel and channel/offline routes; no VOD route or external seek/clock interface was found. The [official public API specification](https://api.kick.com/swagger/doc.json) has no VOD or clip metadata resource. These limits apply to the official interfaces; direct public HLS playback was separately verified below.

Research used an agent-created Brave tab on public channel, VOD, clip, and Share interfaces. The user had disabled their player-changing extensions. App requests were separately verified from localhost with `credentials: omit`; successful logged-in navigation alone is not evidence of CORS support.

### User-provided player references and public HLS

- [Kickstiny's distributed userscript](https://r2cdn.destiny.gg/kickstiny/kickstiny.user.js), version 1.4.0, and its [primary source](https://github.com/destinygg/kickstiny) were inspected as text. It runs inside `player.kick.com`, finds the existing IVS instance through React internals, and replaces its live controls. It is not an external VOD API. No project-wide license was found in that repository; its code was not copied into this app.
- The MIT-licensed [Kick embed playback fix](https://github.com/alembicq/kick-embed-playback-fix/blob/main/kick-embed-playback-fix.user.js) patches the live channel `playback-url` fetch and falls back to privileged `GM.xmlHttpRequest` calls. Those privileges require a userscript manager and cannot be assumed on Pages. The app does not install the script, patch Kick internals, or emulate the privileged fallback.
- A credential-free GET of [the public VOD metadata](https://kick.com/api/v1/video/089d5bf8-0aec-4576-9809-0689633feca6) returned canonical ID `01a0d036-d2e8-7921-a378-da2f05c97032` and a `source` playlist on `stream.kick.com`. That provider-returned master playlist returned HTTP 200 and `Access-Control-Allow-Origin: *`, with five HLS variants. No CDN path was guessed. Media URLs are not reproduced here or stored in sessions.
- An isolated Chromium browser loaded that playlist from localhost with [hls.js](https://github.com/video-dev/hls.js), buffered while paused at 300 seconds, decoded video, and advanced after play. A real mixed pair subsequently played and sought through the app. The independent native-video adapter uses actual media events and buffered ranges instead of the scripts' live IVS internals. It loads hls.js dynamically, with native HLS fallback for supporting browsers. Native Safari playback remains unverified.
- The tested playlist duration was `37023.967` seconds, compared with broadcast metadata `37026`. A previous clip-parent inspection also showed a larger duration discrepancy. The app uses finite loaded VOD duration to correct its end boundary and near-end buffer requirement. It does not change broadcast start, stretch playback time, or claim to correct removed middle footage.
- Chromium on this machine supports native HLS. Explicitly exercising the hls.js fallback exposed a paused clock at `300` with the first buffered frame at `300.016`, despite media readiness. Requiring that exact unbuffered clock caused a wait that playback itself would normally resolve. The adapter now seeks to the first buffered frame only when the gap is at most 50 ms, then requires the usual actual-clock/buffer/paused checks. Larger gaps are not accepted. This is a bounded real seek, not a synthetic clock or a buffered-gap assumption.

The public endpoints and CDN behavior are observed contracts, not an official support guarantee. Unknown CDN hosts and unavailable/private recordings produce an error with the ordinary timestamp link available. No login, subscription, anti-bot restriction, or CORS policy is bypassed.

### Two VOD identifiers

The current [aikobliss VOD](https://kick.com/aikobliss/videos/01a0d4be-acc8-79a9-accb-14af04328c11) has a UUID different from the legacy service's UUID. Observed primary endpoints:

- `/api/v2/channels/aikobliss/videos` on kick.com lists legacy UUID `01947dbf-73c9-487c-961a-00fcd6b9c5f4`.
- `/api/v1/video/01947dbf-73c9-487c-961a-00fcd6b9c5f4` includes explicit `livestream.vod_id = 01a0d4be-acc8-79a9-accb-14af04328c11`, a broadcast start of `2026-09-24T18:47:41Z`, and duration 49,682,000 milliseconds.
- `/api/v1/channels/76274/videos/01a0d4be-acc8-79a9-accb-14af04328c11` on web.kick.com returns the current ID, the same start, and duration 49,682 **seconds**. It did not allow an external Pages Origin via CORS.

The older endpoints allowed credential-free requests from the local app. The adapter matches current URLs by inspecting the channel's older VOD records and comparing their explicit `vod_id`. It never infers identity from UUID timestamps, duration, upload date, or proximity. Lookup examines at most 50 recent records in batches of three and shares/caches normalized metadata for five minutes. An unindexed recording may still fail; the new-service fallback clearly reports its CORS limitation.

Legacy VOD URLs may now return Kick's 404 UI despite metadata remaining available. Canonicalizing `vod_id` is essential for working outbound links and deduplicating current URLs, legacy URLs, and clip parents. Only completed public recordings with reliable start and positive duration are accepted. UTC SQL-style dates from the older service are normalized; explicit timezone offsets are respected. Media URLs and unrelated response fields never enter sessions.

### Clips and timestamp links

On the [recent clip page](https://kick.com/aikobliss/clips/clip_01M35VYB72DC0GQ7GXNYBEFKYA), **Watch full video** points to VOD `01a0cb24-ca08-7953-9e4a-ae201b03b8ef?t=9292`. The older `/api/v2/clips/clip_01M35VYB72DC0GQ7GXNYBEFKYA/play` endpoint returns parent legacy ID `302d2f04-d05c-4fdb-86b6-57d175bb03d7`, `vod_starts_at = 9292`, and duration 25 seconds. The parent metadata provides its current `vod_id`. A five-second clip-local timestamp maps to VOD offset 9297, without subtracting clip duration or using clip creation time.

The newer clip service exposes `video.id` and `video.offset` but also lacks external-origin CORS. The shipped adapter uses the older service and rejects missing/deleted parents and invalid offsets. Both `/channel/clips/clip_…` and `/channel?clip=clip_…` inputs work. [Kick's clip help](https://help.kick.com/en/articles/7120566-how-to-create-clips-on-kick) confirms clips can originate from live streams or VODs; a clip's creation date cannot identify its original footage.

Kick's Share dialog with **Start at** checked produced `?t=205`. The canonical clip-parent destination with `?t=9292` loaded the VOD and sought into the corresponding recording in Brave. Timestamp links use integer seconds. These are observed internal contracts, not a stable API guarantee. Player duration/content may differ from metadata owing to processing, ads, or interruptions; corrections remain available. Playback alignment uses a verified media clock, never metadata coverage alone.

## Streamer targets — observed 2026-09-25

Twitch's official [Get Users](https://dev.twitch.tv/docs/api/reference/#get-users) resolves a login to an ID; [Get Videos](https://dev.twitch.tv/docs/api/reference/#get-videos) accepts `user_id`, archive type, time ordering, page size, and a pagination cursor. The connected adapter follows that path with a ten-page guard. It validates returned owner IDs and past-broadcast type before comparing UTC intervals. This route has fixture coverage; a real OAuth connection remains unverified.

A credential-free request to [Twitch's public GraphQL service](https://gql.twitch.tv/gql) for `user(login).videos(first: 30, type: ARCHIVE, sort: TIME)` returned archive IDs, start times, durations, owner logins, edge cursors, and `hasNextPage`. The next request with the returned cursor was rejected with `IntegrityCheckFailed`. No integrity token or bypass was attempted. Recent first-page lookup worked in the browser; deeper anonymous history is not guaranteed. The app stops on that error and offers the existing official Twitch connection. At most ten public pages are attempted if Twitch permits them.

The [Kick channel index](https://kick.com/api/v2/channels/aikobliss/videos) returned 28 entries, including `start_time`, millisecond `duration`, `is_live`, and legacy `video.uuid`, with CORS permitting the Pages origin. These fields only narrow candidates: the [detail endpoint](https://kick.com/api/v1/video/089d5bf8-0aec-4576-9809-0689633feca6) must confirm the public/completed broadcast, owner, canonical `livestream.vod_id`, start, and duration. No identity is inferred from time. Lookup checks up to 50 recent index entries and never chooses a nearby non-overlapping VOD. Live/expired/older unindexed recordings can remain unavailable.

In the local app at `2026-09-23T21:45:49Z`, `twitch/aikobliss` selected `2882074717` at 12959 seconds and `kick/aikobliss` selected canonical `01a0d036-d2e8-7921-a378-da2f05c97032` at 300 seconds. A subsequent `twitch/xqc` target selected `2882233662` at 261 seconds without changing the source or moment. These are metadata-based broadcast matches; player clocks still require separate verification through the existing playback adapters.

## GitHub Pages and repository choice

[GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) supports building and deploying an artifact directly from a repository. Therefore a second repository or deployment submodule adds no capability for this project. A workspace monorepo keeps the web app and future extension next to shared logic, while deployment artifacts stay out of Git. Actions references are pinned to verified commit hashes.

**Custom domain, checked 2026-09-25:** [GitHub's subdomain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-a-subdomain) require the repository's custom domain to be set before pointing DNS to `<user>.github.io`, without the repository path. Custom Actions deployments ignore `CNAME` files. A temporary `vodsync.frozander.dev` setting and DNS-only Cloudflare CNAME to `frozandero.github.io` were accepted; the workflow derived `/` and deployed the root-path assets. Public DNS could not resolve the expired parent domain, preventing certificate issuance. Both settings were reverted at the owner's request. Twitch's embed parent already follows the current hostname; OAuth redirect URIs and browser storage are origin-specific. The remaining steps are in [deployment](DEPLOYMENT.md).

## Accuracy limits

- Alignment assumes the VOD's recording timeline progresses continuously from its reported start. Server timestamps can differ from perceived on-stream time because of production or delivery delays.
- Uniform corrections help with fixed offsets. Removed footage or reconnect gaps need multiple alignment segments and are not modeled yet.
- Sync is user-triggered. Ads and buffering can move players apart later.
- Expired VODs, private/subscriber content, missing clip parents, autoplay rules, API changes, and browser blocking are visible errors or platform-managed states, not evidence of a valid match.
