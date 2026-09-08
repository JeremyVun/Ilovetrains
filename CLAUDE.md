# trains_app — ilovetrains

Sydney train, metro and ferry clients that answer “What train should I take right
now?” with no account, ads or server-side personal state. The web app is live
at https://ilovetrains.jeremyvun.com.

The installable web PWA, Kotlin Android app and SwiftUI iOS app use the same
stateless Go API, which caches Transport for NSW Open Data. Native clients also
route over a bundled, updatable offline timetable. Saved trips, history, prediction,
location and focused journeys stay on the device.

## Read first

- `AGENTS.md` — execution, verification and repository rules for agent work.
- `docs/PROJECT.md` — product purpose, principles and design process.
- `docs/contracts/api.md` — binding backend API and caching behavior.
- `docs/contracts/client-storage.md` — binding persisted client state,
  prediction, focus and home inference.
- `docs/contracts/ui.md` — binding client behavior, visual language and
  calibration rules.
- `docs/contracts/analytics.md` — anonymous event vocabulary, experiment
  assignment, privacy controls and aggregate interpretation.
- `docs/contracts/native-data.md` — Android timetable, routing and realtime.
- `docs/contracts/android-deviations.md` — reviewable native differences.
- `docs/operations/android.md` — Android build, signing and installation.
- `docs/operations/ios.md` — iOS build, signing and simulator/phone installation.
- `docs/contracts/ios-deviations.md` — reviewable iOS differences.
- `assets/comps/latest/` — the authoritative comps: the current calibration
  exemplar frames every screen is judged against. Replaced, never
  accumulated, when an owner verdict changes a design.
- `docs/ROADMAP.md` — work queue and candidate product directions.
- `docs/references/tfnsw-open-data.md` — upstream observations. Resolve any
  **[verify]** item with a correctly invoked live probe before relying on it.
- `docs/operations/deploy.md` — production topology, deployment and checks.
- `docs/backlog/` — disposable workspaces for active design and build work.
  Completed items are closed out into contracts and deleted.
- `tools/README.md` — verification instruments, invocation and known traps.

Contracts change in the same commit as the behavior they describe. Backlog
folders are never durable documentation: when an item ships, migrate only its
current contracts, seams and decisions into `docs/contracts/`, update surviving
references, and delete the entire folder. Git retains any history.

## Structure

- `cmd/server/` — Go entrypoint. It serves the API and `web/` at `/`.
- `internal/api/` — handlers, validation, cache headers and error envelope.
- `internal/cache/` — TTL cache, single-flight and stale-on-error behavior.
- `internal/tfnsw/` — TfNSW client, upstream types and response mapping.
- `web/` — dependency-free vanilla ES-module PWA, service worker and tests.
- `android/` — native Kotlin/Compose app, JVM and emulator tests.
- `ios/` — native SwiftUI app, Xcode project, XCTest and simulator tests.
- `internal/native/` — shared timetable publication and realtime ingestion.
- `native-data/bootstrap/` — verified public timetable bundled in the server.
- `assets/` — durable media; `assets/comps/latest/` is the only comps
  location.
- `tools/` — TfNSW probes, captured fixtures and browser verification tools.
- `Dockerfile` and `docker-bake.hcl` — the production image build.
- `../projects/stacks/ilovetrains/` — production compose/config in the infra
  repository; it is not owned by this repository.

## Local development

Never load or source `.env` directly or indirectly without explicit user permission.
Never print or commit `TFNSW_API_KEY`.

With `TFNSW_API_KEY` already present in the process environment:

```sh
go run ./cmd/server
```

Open http://localhost:8080. Runtime variables are `TFNSW_API_KEY` (required),
`PORT` (default `8080`), `WEB_DIR` (default `./web`),
`MIN_CONNECTION_TIME` (default `3m`), `MAX_CONNECTION_TIME` (default `60m`),
`FLAGS_URL`, `FLAGS_KEY`, `FLAGS_PROJECT`, `FLAGS_ENV` (all optional;
without `FLAGS_URL` every feature flag reads its default), and
`ANALYTICS_URL`, `ANALYTICS_PROJECT`, `ANALYTICS_KEY` (optional; without
`ANALYTICS_URL` the server's accuracy counters stay in its log).

During iteration, run the affected platform's unit suite; add the relevant
device tests when changing platform integration or gestures. Both helpers
accept optional test class/method filters and retain complete logs:

```sh
tools/build-android.sh --unit
tools/build-ios.sh --unit
tools/build-ios.sh --ui AppFlowTests/testSwipeRevealsDeleteAndUndoRestoresRow
```

Before completing a native feature, run the full affected-platform gates once
on the final sources (plus its instrumented/system integration checks). Do not
repeat unchanged gates after documentation or baseline-only edits. Shared
fixtures or behavior changes require all affected clients. Primary full gates:

```sh
go test ./...
(cd web && npm test)
tools/build-android.sh
tools/build-ios.sh --test
```

The web app is the reference implementation every later port is measured against
(see `docs/PROJECT.md`, "Native clients").

## Verification and tools

Read `tools/README.md` before trusting or modifying an instrument. In
particular:

- `tools/screenshot.js` captures a real Chromium viewport and checks for
  viewport lies and horizontal overflow.
- `tools/shoot-states.js` seeds and drives the real web client while checking
  geometry, scrolling, tap targets and content reachability.
- `tools/measure-open.js` measures cached paint and live-data timing.
- `tools/visual-regression.js` shoots web, Android and iOS and compares frames
  with `tools/baselines/`. During iteration, use `--platform` and `--screens`
  for affected screens; shared styling requires the full affected-platform
  matrix. Run that matrix on final UI sources before completing the feature.
  Inspect and accept intended changes with `--compare <existing-run> --accept`
  to reuse the verified captures instead of shooting them again.
- `tools/probe-tfnsw.sh` makes live upstream requests and requires an API key;
  use captured fixtures for normal tests.

Visual behavior needs a real-client drive at the affected phone sizes and
schemes. Unit tests alone do not prove layout, service-worker or offline
behavior. Follow the exact invocation documented by each instrument before
believing a failure.

Keep independent platforms parallel. Reuse session-owned devices and warm
build directories; never wipe an entire emulator for routine app-state reset.
`tools/start-android-emulator.sh AVD_NAME PORT` starts an existing AVD with
host graphics, 4 GB guest RAM and Quick Boot. Select its printed
`ANDROID_SERIAL`, and shut it down when the session finishes. Do not reuse,
reconfigure or stop another session's device. Keep performance measurements
separate from concurrent build/UI load; wall-clock thresholds under contention
do not identify app performance regressions.

## Non-negotiable rules

- The server remains stateless. Do not send location, saved trips, history,
  rides or identity to it without an owner ruling and contract change.
- The API key exists only in the server process.
- Any change to a file listed in `web/sw.js`'s `SHELL` array must bump
  `VERSION` in the same change. Returning browsers otherwise keep old code.
- Develop service-worker changes with “Update on reload” or a throwaway
  browser profile; the browser tools use a throwaway profile by default.
- After a backlog item is completed, close it out and deploy it using the operations
  runbook.
