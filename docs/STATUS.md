# Verification status

Last updated: 2026-09-25.

This file records actual checks and their limits. A passing build does not prove third-party playback is available.

## Automated coverage

70 core/provider/player-clock tests pass, with TypeScript, formatting, and production-build checks. Coverage includes timestamp formats, URL validation, timezones, exact start/end boundaries, gaps, corrections, subsecond arithmetic, Unicode sessions, v1 migration, oversized shares, stripping unknown credentials, clip zero/null offsets, missing VODs, uploads/highlights, official API routing, auth errors, initial unconfirmed player clocks, and the isolated experimental Kick adapter.

## Browser and deployment

- Tested at 1440×1000 desktop and 390×844 mobile: all-recording link rows, before/after labels, timeline pointer seeking, Home/End, exact-end states, recording timestamp settings, watch mode, Escape, and no page-level horizontal overflow.
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
