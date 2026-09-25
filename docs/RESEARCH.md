# Browser-only feasibility research

Research date: **2026-09-25**. Capability claims below distinguish official documentation, existing implementations, and observations made during development. Platform behavior can change.

## Current scope

The owner subsequently deferred Kick, removed manual metadata entry, and replaced the separate Links view with timestamp links in the timeline. The release is Twitch-only with a compact grid, per-player controls and links, watch mode, and a collapsible shared seeker. Kick findings below are retained as research, not a claim of shipped support.

## Feasibility decision

Both requested workflows are feasible on GitHub Pages **for Twitch**. A supported controllable Kick VOD embed was not found. The static app does not require an extension. No unrelated service or CORS proxy is used.

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

## Kick

[Kick's embed help](https://help.kick.com/en/articles/8010826-how-to-embed-your-kick-livestream) describes **livestream** iframe embedding. It does not document a VOD seek/read-position JavaScript interface. The [public API documentation repository](https://github.com/KickEngineering/KickDevDocs) was inspected; its API directory did not include a public VOD metadata resource at research time. This absence is the basis for treating native VOD integration as unsupported, not proof that every internal player operation is impossible.

The maintained [yt-dlp Kick extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/kick.py) uses an internal `/api/v1/video/{uuid}` endpoint and converts livestream duration from milliseconds. That is implementation evidence, not a supported public API contract. Our adapter attempts a direct credential-free request and accepts only a completed VOD with an explicit `livestream.start_time` and positive duration. It never substitutes video upload time. Blocked requests, changed schema, missing start, or active livestreams require manual timing.

**Observed:** a historical yt-dlp fixture VOD returned HTTP 404 during research, so it did not establish current Kick metadata or playback success. No fresh Kick account/VOD was supplied for an end-to-end playback check.

Second-based `?t=` links are discussed in [Kick's own developer issue tracker](https://github.com/KickEngineering/KickDevDocs/issues/125), but are not treated here as a stable official VOD contract. The isolated core can format them; the web interface does not expose Kick support. A clean, extension-disabled Brave session reached Kick's logged-out homepage, but VOD experiments were stopped when the owner deferred Kick. This did not verify Kick metadata or seeking.

## GitHub Pages and repository choice

[GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) supports building and deploying an artifact directly from a repository. Therefore a second repository or deployment submodule adds no capability for this project. A workspace monorepo keeps the web app and future extension next to shared logic, while deployment artifacts stay out of Git. Actions references are pinned to verified commit hashes.

## Accuracy limits

- Alignment assumes the VOD's recording timeline progresses continuously from its reported start. Server timestamps can differ from perceived on-stream time because of production or delivery delays.
- Uniform corrections help with fixed offsets. Removed footage or reconnect gaps need multiple alignment segments and are not modeled yet.
- Sync is user-triggered. Ads and buffering can move players apart later.
- Expired VODs, private/subscriber content, missing clip parents, autoplay rules, API changes, and browser blocking are visible errors or platform-managed states, not evidence of a valid match.
