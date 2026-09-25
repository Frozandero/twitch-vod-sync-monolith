# Deployment

The app currently uses [GitHub Pages](https://frozandero.github.io/twitch-vod-sync-monolith/), deployed by `.github/workflows/pages.yml` from `main`. Keep GitHub Actions as the Pages source. Never commit `apps/web/dist` or create a separate deployment repository.

## Custom domain: deferred

The owner requested `vodsync.frozander.dev`. On 2026-09-25, Cloudflare's registrar API reported that `frozander.dev` expired on 2026-08-02; the registry's [RDAP response](https://pubapi.registry.google/rdap/domain/frozander.dev) included `redemption period` and `pending delete`. Both Cloudflare and Google public DNS returned NXDOMAIN for the parent domain. An active Cloudflare DNS zone does not establish that the domain registration is active.

The owner chose to restore the working `github.io` address until registration is restored. Pages has no custom domain and enforces HTTPS. The temporary `vodsync` CNAME was removed, so there is no unclaimed alias left by this migration. No other DNS records or registrar settings were changed.

Cloudflare's registrar dashboard is required to inspect restoration eligibility and quoted fees. The installed `cf registrar registrations update` command only supports auto-renew settings; it does not restore registrations. See [Cloudflare's restoration guidance](https://developers.cloudflare.com/registrar/faq/#domain-restoration). Check fresh registration and public DNS state before retrying; do not assume expiry is just DNS propagation or incur restoration charges without the owner's approval.

## Migration after registration is active

1. Confirm `cf registrar registrations get frozander.dev` reports an active registration and public DNS delegates the domain to the assigned Cloudflare nameservers. Inspect the exact `vodsync.frozander.dev` record for conflicts.
2. Set the repository's GitHub Pages custom domain to `vodsync.frozander.dev` before adding its DNS alias.
3. Use `cf` to create a DNS-only CNAME: `vodsync.frozander.dev` → `frozandero.github.io`, automatic TTL, with Cloudflare proxying disabled. Do not include the repository name in the target or change unrelated zone settings.
4. Run the existing Pages workflow. `actions/configure-pages` derives `/` for `PAGES_BASE_PATH`; verify the deployed HTML references root-relative assets. No `CNAME` file is required for the custom Actions workflow.
5. Verify authoritative/public DNS and GitHub's certificate status. Once the certificate is available, enable HTTPS enforcement. Check valid HTTPS, asset responses, the old Pages URL redirect, and shared URL fragments.
6. Inspect the app on the actual new origin, including a mixed Twitch/Kick session, player parent hostname, seeking, playback, and share/reload. Update the README app link, repository homepage, and verification status only once the new site is usable.

Twitch embeds derive `parent` from the current hostname. An optional registered Twitch application must include `https://vodsync.frozander.dev/` among its allowed redirect URLs. Browser-local sessions are origin-specific: move recordings with a shared link or JSON export/import before switching domains; changing DNS does not move local storage.

If migration fails, clear the Pages custom domain, remove only the DNS record created for the migration, and rerun the workflow so assets use `/twitch-vod-sync-monolith/` again. Verify HTTPS and the rendered app before reporting restoration.
