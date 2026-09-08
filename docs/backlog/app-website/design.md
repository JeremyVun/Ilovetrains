# App website

Status: **design, opened 2026-09-08**. No build has started.

## What and why

A small public website at `https://ilovetrainsapp.jeremyvun.com` with three
pages: a landing page, a privacy policy and a support page. It exists because
both app stores refuse a public listing without a privacy policy URL, and
Apple also requires a support URL. Internal TestFlight needed neither, which
is why the first iOS upload went through without a site. Nothing about the
app itself changes; the site is documentation that stores and users can
reach.

The owner ruled on 2026-09-08:

- The site lives in this repository under `site/`, as its own stack on the
  infra repo, on its own Caddy subdomain `ilovetrainsapp.jeremyvun.com`. The
  app origin `ilovetrains.jeremyvun.com` and its Go server are untouched.
- The first version is landing, privacy and support. About and per-platform
  install guides are not in scope.

## Facts the pages must state truthfully

Verified against the contracts and code on 2026-09-08:

- The server is stateless. No accounts, no server-side personal state
  (`docs/contracts/api.md`, `docs/PROJECT.md`). Saved trips, ride history,
  prediction, focus, home inference and location stay on the device
  (`docs/contracts/client-storage.md`).
- Departure requests carry a station pair and time. The server relays them
  to Transport for NSW Open Data and caches the answer. The site sits behind
  Cloudflare's proxy and the shared Caddy edge, which see the requester's IP
  address as any web host does.
- Anonymous usage counters: events are exactly project, event name,
  categorical dimensions and a repeat count. No device or session ID,
  timestamp, station, trip, coordinate or user agent. Sending stops when the
  browser sets Do Not Track. There is no in-app disclosure copy today; the
  policy is the disclosure (`docs/contracts/analytics.md`, "Privacy and
  enablement").
- Explicit feedback: a user who chooses Settings → feedback sends a category
  and their message to `analytics.jeremyvun.com/feedback`. Nothing else
  travels with it. The owner can list, export and delete submissions.
- Location: web uses browser geolocation only when the user enables it in
  preferences; Android declares coarse and fine location; iOS declares
  when-in-use location with the string "Your location stays on this phone."
  A position is used on the device to choose the nearest station and is never
  sent.
- Notifications and the travel tracker: Android declares notifications and a
  foreground service, iOS uses local Live Activities. No push service is
  involved; nothing leaves the phone.
- Uninstalling deletes saved trips; there is no cloud backup.
- Encryption: HTTPS only; CryptoKit is used for SHA-256 integrity checks.

## Mechanism

- `site/` holds static HTML and CSS, no JavaScript, no build tool, no service
  worker. Three routes: `/`, `/privacy/`, `/support/`, each an `index.html`,
  plus a `/health` liveness response.
- The visual language is the app's own: the `app.css` colour tokens and
  system typeface, dark and light schemes. Look is settled through a
  `design-comps` round before the build; the comp verdict is a design input.
- Copy is drafted by Codex on `gpt-6-astra` (owner ruling 2026-09-08) under
  the `user-facing-copy` skill and ruled on by the owner. The current draft is
  [copy.md](copy.md). The privacy policy is written from the facts above, in plain
  language, with an effective date.
- Packaging follows the `mortgage-calc` exemplar: an nginx image whose listen
  port comes from `ILOVETRAINSAPP_PORT`, built by a second target in this
  repo's `docker-bake.hcl`, pushed to `registry.jeremyvun.com/ilovetrainsapp`.
- The infra stack `stacks/ilovetrainsapp/` has no secrets, no volumes, one
  Caddy label for the subdomain, and the standard healthcheck. Assignment to
  `hosts/syd1.yaml` and the Cloudflare DNS record are owner actions.

## Decisions

Recorded as the owner rules on them; open items are listed at the end.

| Date | Decision |
| --- | --- |
| 2026-09-08 | Own stack and subdomain in this repo, under `site/`. |
| 2026-09-08 | Pages: landing, privacy, support. |
| 2026-09-08 | Landing shows App Store and Google Play badges now, before either listing exists, alongside the web app link. Until a listing is live its badge is present but inert, pointing at the web app; the build wires each real store URL when the owner supplies it. |
| 2026-09-08 | The privacy policy and support page name Jeremy Vun as the operator. Store listings use the same display name. |
| 2026-09-08 | Owner: "Make it look nice too. If you need screenshots, you can spin up the ios app and grab them." The landing page is a designed page with real iOS app screenshots, not a text page. Look is settled by a `design-comps` round; screenshots come from the iOS simulator via `tools/shoot-ios.sh`, with `tools/baselines/ios/` as the stand-in material for comps. |

## Rejected alternatives

- Serving the pages from the existing Go server on a second hostname. Rejected
  because it couples the marketing site to app deploys and the service
  worker's shell list.
- A separate repository. Rejected because the privacy policy must track the
  analytics and client-storage contracts, and drift is easiest to catch in
  the same tree.

## Open questions

1. ~~Support contact~~ Answered: `admin@jeremyvun.com`.
   The owner is setting up a forwarding address on the jeremyvun.com domain
   through Cloudflare Email Routing; record the address here once it exists.
   Comps and copy use `support@jeremyvun.com` as a declared placeholder.
2. Whether the landing page also links the Android APK at
   `ilovetrains.jeremyvun.com/downloads/`, or only the store badge.
