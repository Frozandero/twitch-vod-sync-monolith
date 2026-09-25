# Verification status

Last updated: 2026-09-25.

This file records actual checks and their limits. A passing build does not prove third-party playback is available.

## Automated coverage

83 core/provider/player tests pass, with TypeScript, formatting, and production-build checks. Coverage includes timestamp formats, URL validation, timezones, exact start/end boundaries, gaps, corrections, subsecond arithmetic, Unicode sessions, v1 migration, oversized shares, stripping unknown credentials, clip zero/null offsets, missing VODs, uploads/highlights, official API routing, auth errors, initial unconfirmed player clocks, finished/foreign VOD detachment, drift labels, and the isolated experimental Kick adapter.

## Browser and deployment

- Added close buttons beside timeline recording names, using the existing player-removal action. Desktop (1440×1000), mobile (390×844), and watch-mode checks confirmed the collapsed timeline is only a 32×24 expand button, retains the same player frames, restores via keyboard, and persists across reload. Removing a non-source, source, and final recording from the timeline correctly updated the players/session and returned to the empty view. No horizontal page overflow was observed.
- Reproduced the supplied session's Up Next failure in an isolated real Twitch embed: xQc `2882233662` (9:15:05) changed to `2882100152` (2:59:23, matching the screenshot). Verified the fix removes the iframe at natural end and keeps it absent beyond the countdown. A forced foreign-ID change also detached immediately and offered a working original-VOD reload. No timing corrections were added to the supplied session.
- Verified source natural end advances the selection to its exact metadata end; ended targets cannot contribute a replacement clock. Seeking earlier restored original IDs. Timeline End removed all three embeds; Home restored only the first recording and held the other two before their start.
- Desktop (1440×1000) and mobile (390×844) inspection covered real clocks, separate selected/actual markers, a paused player 42 seconds behind, an ahead state, unverified clocks, and no horizontal page overflow. Hide/Show and watch-mode toggles preserved all three frames. Twitch may delay reporting a paused seek until playback resumes; alignment reflects its last reported clock, not independent inspection of video content.
- Replaced Grid/Links tabs and the separate Links view with timestamp links beside every seeker row. Desktop (1440×1000) and mobile (390×844) checks covered correct mapped URLs, clickable links outside the seek overlay, before/end labels, keyboard seeking, and no horizontal page overflow. A legacy Links JSON session restored all three players into the grid.
- Hide/Show timeline preserves the moment and mounted players, works in watch mode, and persists across reload. A real Twitch player continued advancing while collapsed. The timeline link opened the expected timestamp URL in another tab; player-header links remained visible and tracked their own playback clock. Twitch required a direct play gesture for the unmuted source during this check.
- Removed the demo entry button and bundled sample session at the owner's request. The empty view was checked at desktop and mobile sizes; existing saved/imported demo sessions remain readable.
- Earlier release checks at 1440×1000 desktop and 390×844 mobile covered the former all-recording Links view, before/after labels, timeline pointer seeking, Home/End, exact-end states, recording timestamp settings, watch mode, Escape, and no page-level horizontal overflow.
- Live browser metadata resolved Twitch VODs `2882012892` and `2882074717`. A source time of `02:00:00` matched `00:46:07` in the second VOD. The official embeds played at these positions, and shared pause/watch-mode controls were exercised.
- A real Twitch clip with a five-second local offset resolved to parent VOD `2877735401` at `09:47:17`. All three records remained visible; an unsupported URL produced an error without losing them. Share clipboard feedback was verified.
- JSON export/import followed by an immediate reload exposed a persistence debounce race. Persistence now writes immediately instead of waiting 200 ms; the full export/import/immediate-reload browser check passed on rerun.
- Screenshots and transient browser scripts live in ignored `output/playwright/`; they are not production assets. Browser runs used isolated profiles. No account login was performed.
- Twitch's embedded frames emitted third-party fingerprinting rate-limit and permissions-policy errors during playback. The app's metadata lookup, mapped positions, and player playback succeeded despite these; this is not a claim that every third-party request succeeds.
- The first [GitHub Pages deployment](https://github.com/Frozandero/twitch-vod-sync-monolith/actions/runs/36141399577) succeeded. The published repository-subpath page loaded, resolved both real Twitch VODs to the expected timestamps, and loaded their official player frames with the correct parent host.
- The production smoke check exposed Twitch returning an initial zero while its iframe showed the requested two-hour position. The app now displays the requested position and prevents Sync from that player until Twitch reports a position or starts playback. Regression tests cover initial zero, later valid seeks to zero, and invalid clock values.

## Explicitly unverified integration paths

- A registered Twitch application and real OAuth sign-in have not been supplied. Official Helix behavior is tested with fixtures; a real redirect/consent/token session requires that setup.
- Kick was deferred by the owner. A clean extension-disabled Brave session reached its homepage, but no Kick VOD integration is shipped or claimed verified.
- Subscriber/private VOD playback, mobile autoplay, and ad interruption behavior are controlled by Twitch and are not guaranteed by deterministic tests.
