# Production deployment

The app ships as one multi-architecture image containing the Go server,
`web/`, the native timetable bootstrap and its compiler. Build the signed
Android APK first with `tools/build-android.sh --release` to include the
phone download under `/downloads/`. The infra repository at `../projects` runs that image from
`stacks/ilovetrains/` behind the shared Caddy edge proxy on `syd1`.

Source pushes do not deploy production. Build, push and deployment originate
from this machine.

The `timetables` volume at `/data` contains public schedules and source caches,
never personal client state. The image initializes that directory for its
unprivileged runtime user. A failed upstream refresh retains the validated
generation; the bundled bootstrap serves a new volume immediately.

## Before deploying

- Run the relevant test and real-client verification gates.
- `web/js/version.js` is the canonical app version, starting at `1.0.0`.
  Bump patch for fixes, minor for compatible features, major for breaking
  product changes. Keep major/minor/patch numeric; reset lower components when
  bumping a higher one. Commit the version with its release changes.
- If any file in `web/sw.js`'s `SHELL` array changed, bump its `VERSION`.
- Never read or source `.env` or the infra stack's `secrets.env` without
  explicit user permission. Never print or commit `TFNSW_API_KEY`.

## Deploy

1. Build and push the multi-architecture image to the self-hosted registry:

   ```sh
   ILOVETRAINS_VERSION="$(node --input-type=module -e 'import { VERSION } from "./web/js/version.js"; process.stdout.write(VERSION)')" \
     GIT_REVISION="$(git rev-parse --short=12 HEAD)" docker buildx bake --push
   ```

   `docker-bake.hcl` publishes the numbered version and `latest` to
   `registry.jeremyvun.com/ilovetrains`. Build from the committed release;
   Settings displays its canonical version. The Git revision is retained in
   the image's `org.opencontainers.image.revision` label for diagnostics.

2. If deployment configuration changed, edit
   `../projects/stacks/ilovetrains/`, then commit and push the infra repository.
   The stack uses `docker-compose.yml` and `config.env`. Its pre-commit hook
   seals the gitignored `secrets.env` into the committed `secrets.env.age`;
   the VM decrypts it during reconciliation.

3. Deploy through the infra repository:

   ```sh
   (cd ../projects && cli/deploy.sh ilovetrains)
   ```

   Build the deploy client with `make build` in that repository if required,
   or set `DEPLOYCTL_BIN=agent/deployctl/deployctl`.

## Feature flags

Flag inventory:

| Key | Type | Public | Owner | Default | Removal condition |
| --- | --- | --- | --- | --- | --- |
| `tiny_train` | boolean | yes | Jeremy | off | Remove after the owner accepts or retires the Easter egg |

Target project/environment: `ilovetrains` / `production`. Definition description:
`Play the tiny train Easter egg beneath the Home header.` Boolean variations
are `off=false` and `on=true`; initial environment config is disabled with
`off_variation=off`, empty targets/rules and `fallthrough.variation=on`.
This is a global UX switch, with no per-device targeting or percentage rollout.

The browser boundary is `GET /api/v1/flags`. The local-only `?tinyTrain=1`
preview cannot override production. The server uses one shared Go SDK client,
streaming internal snapshots and evaluating only public definitions locally.
Keys and raw rules never enter the web bundle. The owner approved vendoring
on 2026-09-08; the pinned SDK, unchanged evaluator and additive public accessor
are documented in [third_party/flags](../../third_party/flags/README.md).

Runtime configuration:

| Variable | Value |
| --- | --- |
| `FLAGS_URL` | Internal flagsd base URL; unset leaves the feature off |
| `FLAGS_KEY` | Read-only key scoped to this project and environment; required with `FLAGS_URL` |
| `FLAGS_PROJECT` | Defaults to `ilovetrains` |
| `FLAGS_ENV` | Defaults to `production` |

Boot never waits for flagsd. With no disk cache, each process starts off until
its first snapshot. Once synced, the SDK retains the last valid snapshot in
memory through a flagsd outage; a kill switch update needs a working stream.
Browsers refresh on foreground and every 30 seconds; a failed browser fetch
turns the feature off. Evaluation uses fixed context `ilovetrains`, with no
personal attributes. Read attribution is `svc:ilovetrains` / `ilovetrains-api`.

The owner confirmed creation of the `ilovetrains` project and both `tiny_train`
and `transfer_limit` flags on 2026-09-08. The transfer-limit implementation is
being integrated separately; its flagsd key is `transfer_limit`.
The owner staged `FLAGS_KEY` in the infra stack's `secrets.env` on 2026-09-08.
The prepared Compose configuration supplies the runtime settings above and
joins `shared-flags`. The flags stack creates that named network; deploy it
before ilovetrains. The app joins it as an external network.
The owner sealed and pushed the infra configuration in commit `1e2f564`.
Version `1.3.0` (source `6182609`, service worker `v46`) deployed on 2026-09-08,
with flags first, then ilovetrains. Both deployctl jobs succeeded. Image digest:
`sha256:fbbd7587e6c4f9d8895090113ca7403a8a6dd928ced8782b46d96ac5f0e49dae`.
Production health, version, shell assets and Android download passed HTTP checks;
`GET /api/v1/flags` returned `{"tiny_train":false}` with `Cache-Control: no-store`.
Production Chromium checks passed on fresh and returning profiles: service worker
`v46` installed and controlled the return visit, real departures and Home/Settings
navigation worked, and `?tinyTrain=1` could not enable the production feature.
Live on/off changes, private visibility and deletion passed against a local
flagsd protocol fixture. A production flag-on toggle has not yet been verified.
No production credentials were read during implementation.

## Verify

Check https://ilovetrains.jeremyvun.com/healthz and drive the affected flow on
the production origin. For real-origin open measurements:

```sh
node tools/measure-open.js --url https://ilovetrains.jeremyvun.com/#/board
```

Confirm service-worker-controlled changes in a returning profile as well as a
cold profile; a healthy origin does not prove that existing clients received
the new shell.

Check cached module content as well as the worker version: old HTTP-cached
assets can otherwise enter a newly named shell cache. Installation reloads
all shell requests; the cached controller must match the deployed source.

Check what the realtime refresh actually published. Each source logs one line
per refresh that changed the feed:

```
realtime source=sydneytrains raw=308 accepted=129 unknown=159 ambiguous=0 stale=20 duplicate=0 header_age=6s
```

`grep "realtime source="` shows every source's last count; alert on
`realtime warning`, which is emitted whenever a non-empty feed publishes
nothing. A `/data/current.json` compiled without a trip index makes Sydney
Trains warn (and log `native timetable: manifest declares no trip index` at
startup) until the next daily timetable refresh rewrites it. A source logs
nothing when upstream answers 304 or returns a byte-identical feed; its
snapshot still ages out through `X-Data-Stale`.

Check static response headers too: `/js/main.js` and `/sw.js` must retain
`Cache-Control: no-store` through the edge. A cold profile must load the app
on its first navigation, before a worker-controlled reload can mask stale
HTTP-cached modules.
