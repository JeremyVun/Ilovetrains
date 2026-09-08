# Production deployment

The app ships as one multi-architecture image containing the Go server,
`web/`, the native timetable bootstrap and its compiler. Build the signed
Android APK first with `tools/build-android.sh --release` to include the
phone download under `/downloads/`. The infra repository at `../projects` runs that image from
`stacks/ilovetrains/` behind the shared Caddy edge proxy on `syd1`.

Source pushes do not deploy production. Build, push and deployment originate
from this machine.

## App website

The marketing, privacy and support site at
`https://ilovetrainsapp.jeremyvun.com/` is a separate static nginx image and
infra stack, built from `site/`. It uses the same host and Caddy edge as the
app. It needs no API key, database, secrets or persistent volumes.

```sh
GIT_REVISION="$(git rev-parse --short=12 HEAD)" \
  ILOVETRAINSAPP_VERSION=1.0.1 docker buildx bake ilovetrainsapp --push
(cd ../projects && cli/deploy.sh ilovetrainsapp)
```

Increment the website image tag on later releases. The explicit target builds
only the website; the default bake group still builds only the Go app.
Infra configuration lives in `../projects/stacks/ilovetrainsapp/`, assigned
to `syd1`. Port 8080 is set explicitly in Compose and drives nginx, the edge
label and healthcheck. No local `.env` is needed for this build.

On first registration, push the infra manifest and run `cli/deploy.sh --all`
once so the host learns the new stack. A targeted redeploy checks the host's
current assignment before pulling Git and returns 404 until that refresh.
Subsequent releases use the targeted command above.

For local inspection, build a host-architecture image from `site/`, then run
it with a loopback port mapping. Verify `/`, `/privacy/`, `/support/`, assets,
and `/healthz` against nginx, followed by the same public HTTPS paths after
deploy. All pages revalidate their HTTP cache and have no service worker.
The site container disables access logs and serves a restrictive CSP with
local styles and images only. `Cache-Control: no-cache, no-transform` keeps
Cloudflare from replacing email links with script-dependent obfuscation.
[Website contract](../contracts/app-website.md)
records copy, privacy and screenshot requirements.

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
| `transfer_limit` | boolean | yes | Jeremy | off | Retire once the owner rules the transfer cap permanent or drops it |

Target project/environment: `ilovetrains` / `prod` (UI label **Production**).
The label is not the API key: requesting environment `production` returns 404.
`tiny_train`'s definition description is
`Play the tiny train Easter egg beneath the Home header.` Boolean variations
are `off=false` and `on=true`; initial environment config is disabled with
`off_variation=off`, empty targets/rules and `fallthrough.variation=on`.
Both are global UX switches, with no per-device targeting or percentage rollout.

The browser boundary is `GET /api/v1/flags`, which publishes each flag under
the name its clients read: `tiny_train` as `tiny_train` and `transfer_limit`
as `transferLimit`. The local-only `?tinyTrain=1` preview cannot override
production. The server uses one shared Go SDK client,
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
| `FLAGS_ENV` | Set to `prod`; the code's `production` fallback does not name this project's environment |

Boot never waits for flagsd. With no disk cache, each process starts off until
its first snapshot. Once synced, the SDK retains the last valid snapshot in
memory through a flagsd outage; a kill switch update needs a working stream.
Every client refreshes on foreground and every 30 seconds, in the one request
all its flags share; a failed fetch turns the tiny train off and leaves the
transfer limit on its stored answer.
Evaluation uses fixed context `ilovetrains`, with no
personal attributes. Read attribution is `svc:ilovetrains` / `ilovetrains-api`.

To turn either feature on, flip its flag in the admin UI at
https://flags.jeremyvun.com. Clients pick the new value up within a refresh tick
of an open app, and at the next open otherwise.

The owner created both public flags and supplied the sealed read key. The
flags stack creates `shared-flags`; ilovetrains joins it externally. Deploy
flags first if that network does not yet exist.

Production configuration is committed in infra `58f5a36`. An owner-authorized
read-only container probe verified the actual environment key `prod` and a true
`tiny_train` evaluation (`FALLTHROUGH`). No `.env` files were read or credentials
printed; the probe used the container's existing process environment.

Version `1.3.1` (source `e4f25d2`, service worker `v47`) deployed on 2026-09-08
in job `a887f8acc7f488f53f1f22a0def04090`. Image digest:
`sha256:fce592e8a9a92b6870d3603e969655add807491e813f68fdc64233ae27809898`.
Production health, version and shell bytes passed HTTP checks, and the public
endpoint returned `{"tiny_train":true}`. All 342 web tests, the signed Android
release build and the four size/scheme interaction checks passed. Seven affected
Home regression frames matched; no baseline changed. The train starts with six
cars on the coloured trip line; activating it leaves the line and divider fixed.

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

Check accuracy after a deploy that touches realtime, planning or the mapper.
Every 15 minutes each feed source logs how its own predictions held up:

```
accuracy feed source=sydneytrains window=15m0s settled=812 unresolved=40 cancelled=3 tracking=1460
accuracy feed source=sydneytrains lead=5-10m n=640 within60=601 within120=628 early60=9 late60=30 mae=24s max=410s
```

`within60` over `n` is the share of countdowns that were right to the
minute at that lead; `early60` is the count that left earlier than the
countdown said, which is the one a rider cannot recover from. Rising
`unresolved` means the feed stopped covering stops before they passed.

The departures endpoint logs how Trip Planner agreed with the feed for the
legs it actually served, and each disagreement over two minutes as it happens:

```
accuracy tripplanner mode=train window=15m0s compared=212 agree=205 disagree=7 mae=18s max=240s tripplanner_only=3 feed_only=11 scheduled_only=40 unmatched=2 stale=0 cancel_mismatch=0
accuracy tripplanner mode=train trip=145T.1396.158.12.A.8.90984066 stop=2000332 planned=2026-09-08T08:00:00+10:00 tripplanner=2026-09-08T08:01:00+10:00 feed=2026-09-08T08:04:00+10:00 diff=-180s
```

`grep "accuracy "` shows both. A `cancel_mismatch` or a run of large negative
`diff` values means the board is showing an earlier time than the feed
believes, so investigate before riders do. `unmatched` growing means the
join keys changed upstream.

The same windows arrive as counters in the analytics project when the stack
sets `ANALYTICS_URL` (it does, to the public analytics origin), so the
dashboard at `https://analytics.jeremyvun.com/ui?project=ilovetrains` shows
`feed_prediction_scored` split by `lead.error` and
`tripplanner_leg_reconciled` split by `mode.outcome` without reading logs.
The event table is in `docs/contracts/analytics.md`. Analytics delivery is
best effort and never delays a request; a failed post logs
`analytics: N events dropped`.

Check static response headers too: `/js/main.js` and `/sw.js` must retain
`Cache-Control: no-store` through the edge. A cold profile must load the app
on its first navigation, before a worker-controlled reload can mask stale
HTTP-cached modules.
