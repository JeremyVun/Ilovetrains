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

The server reads the `transfer_limit` flag from flagsd and republishes the
evaluated value at `/api/v1/flags` under the name every client reads,
`transferLimit`; flagsd keys must be lower-case, so the adapter translates.
`FLAGSD_URL` belongs in `config.env` as `http://flagsd:8080`; `FLAGSD_KEY`
belongs in `secrets.env`. With either unset the server logs that flags are
disabled and every flag reads `false`, which is the behaviour from before the
flag existed.

flagsd publishes no ports, so the two stacks meet on an external Docker network
created once on the host:

```sh
docker network create shared-flags
```

The flags stack's `flagsd` service and the ilovetrains service both join it.

Enable the flag once, in this order:

1. In the admin UI at https://flags.jeremyvun.com, create project
   `ilovetrains` with the single environment `production`.
2. Create flag `transfer_limit`: boolean, public, off.
3. Mint a read-only key scoped to `ilovetrains/production`. Its secret is shown
   once and is never read back.
4. Paste that secret into `../projects/stacks/ilovetrains/secrets.env` as
   `FLAGSD_KEY`, then commit the infra repository so the pre-commit hook seals
   it into `secrets.env.age`.
5. Deploy, then read `https://ilovetrains.jeremyvun.com/api/v1/flags`. Toggling
   the flag in the admin UI reaches new opens within about a minute.

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
