# Transfer cap: build plan

Status: **ready** (2026-09-07). Every phase's design input is ruled in
`design.md`; the Settings row's exemplar frames are in `comps/`. The
journey line on boards and Home is not touched by any phase.

Read `design.md` first; it holds every ruling and the mechanism. This plan
adds the seams, the owned files, the verify gates and the arithmetic.

## Arithmetic every builder checks against

- A journey's change count is `legs - 1`. `legs` counts service legs only
  (`api.md`: walking legs are folded into gaps), so the count never sees a
  walk. The cap of two changes means `legs <= 3` is allowed.
- The server's `transferLimit` parameter accepts `0` to `9`. Nine is never sent by
  our clients and only bounds junk; a Sydney journey never has nine changes.
- Effective cap on every client: `capped = flags["transferLimit"] == true &&
  transferLimit == "two"`. Capped sends `transferLimit=2` and hides `legs > 3`; not
  capped sends nothing and hides nothing.
- Offline transfer bound: capped → 2; flag on and `any` → 4 (design D2);
  flag off → 2. The router's constructor default stays 2.
- `/api/v1/flags` is fetched once per open, after first paint, never
  awaited before a board request. The stored `flags` value is what the open
  uses.

## Seam contracts shared by every phase

- **`GET /api/v1/departures?…&transferLimit={n}`**: optional, integer `0..9`,
  else `400` with the standard error envelope. Omitted means no cap. Server
  drops `legs - 1 > n` in the same pass as the mode drop, before the
  connection floor and ceiling and before `limit`. When the flag is off the
  server treats `transferLimit` as omitted and it never enters the cache key.
- **`GET /api/v1/flags`** → `200`
  `{"version": "<string, may be empty>", "flags": {"transferLimit": <bool>}}`,
  `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`. Present
  whether or not a flags client is configured; unconfigured means every
  listed flag is `false` and `version` is `""`.
- **Local document**: `preferences.transferLimit` is `"two"` or `"any"`, any
  other value or absence reads as `"two"`. Top-level `flags` is an object of
  flag key to boolean; absent or malformed reads as every flag `false`.
  Schema version stays 1 on every client.
- **Preference change**: changing `transferLimit`, or a fresh `/api/v1/flags`
  answer that changes `capped`, follows the existing mode-change path: keep
  eligible cached rows, refetch through the departures API, never restore
  excluded journeys on failure, repaint Settings if open.
- **Focus**: the followed journey's refresh request never sends `transferLimit`
  (it is already all-mode); its visibility follows `capped`.
- **Settings**: the choice is absent when `flags["transferLimit"]` is false,
  and Settings then renders exactly as today, pixel for pixel.

## Phase 1 — Server: the cap and the flag seam (buildable now)

Owns: `internal/api/params.go`, `internal/api/server.go`,
`internal/api/flags.go` (new), `internal/api/server_test.go`,
`internal/tfnsw/client.go`, `internal/tfnsw/map.go`,
`internal/tfnsw/map_test.go`, `docs/contracts/api.md`.

Build:

- `DeparturesOptions` gains `TransferLimit int` with `-1` meaning none.
  `mapTripWithPolicyModes` (or its successor taking the options struct)
  drops a journey whose service-leg count minus one exceeds a non-negative
  `TransferLimit`, at the point where the mode drop happens today
  (`map.go` around line 113), so the drop precedes the connection rules and
  `limit`.
- `params.go` gains `journeyTransferLimit(value string) (int, error)`: blank → `-1`;
  otherwise an integer in `0..9`, else `badRequest("transferLimit must be a whole
  number between 0 and 9")`.
- `flags.go` defines the seam the SDK adapter fills in phase 2:

  ```go
  type Flags interface {
      Bool(key string, def bool) bool
      Version() string
  }
  func WithFlags(flags Flags) Option
  ```

  plus `publicFlags = []string{"transferLimit"}`, `handleFlags` for
  `GET /api/v1/flags`, and `transferLimitOn()` returning false when no source
  is set. Register the route beside `/api/v1/stops`.
- `handleDepartures`: parse `transferLimit`; if `transferLimitOn()` is false, force
  it to `-1`; append `|transferLimit=<n>` to the cache key only when `n >= 0`; pass
  `TransferLimit` in the options.
- `api.md`: document `transferLimit`, the drop order, the flag posture, and the
  `/api/v1/flags` endpoint under its own heading, in the contract's existing
  register.

Verify gate:

- `go test ./...` green, with new cases: `transferLimit` blank, `2`, `0`, `10`,
  `x`; a fixture whose three-change journey is dropped under `transferLimit=2` and
  kept under `transferLimit=3` and when omitted; the drop happens before `limit`
  (a board asked for 2 with one capped journey in the first two still
  returns 2); cache key differs between `transferLimit=2` and omitted only when a
  `Flags` source returns true; `/api/v1/flags` shape with and without a
  source.
- `go vet ./...` clean.

Done marker: `[x] phase 1 done` (2026-09-07, branch `tc-p1`, commits 741e8b7, 8a07653, cc7f165). Tests: `TestMapTripTransferLimitDropsJourneysWithMoreChanges`, `TestMapTripTransferLimitHappensBeforeLimit`, `TestJourneyTransferLimit`, `TestDeparturesTransferLimitKeysTheCacheOnlyWhenFlagged`, `TestDeparturesRejectsABadTransferLimitWhicheverWayTheFlagIsSet`, `TestFlagsEndpointNamesEveryPublicFlagWithoutASource`, `TestFlagsEndpointPublishesTheEvaluatedValueAndVersion`, `TestFlagsEndpointServesReadsWhileTheSourceChanges`. As landed: `mapTripWithPolicyModes` became `mapTripWithOptions(…, DeparturesOptions)`; `tfnsw.NoTransferLimit = -1` is the exported sentinel (the zero value of `DeparturesOptions` would mean direct-only, so every caller passes the constant); `api.FlagsResponse` is exported; `WithFlags(nil)` is safe.

## Phase 2 — Server: flagsd SDK, vendored, wired (buildable now, after 1)

Owns: `go.mod`, `go.sum`, `vendor/`, `Dockerfile`, `.dockerignore`,
`cmd/server/main.go`, `internal/flagsd/` (new adapter package),
`docs/operations/deploy.md`, project `CLAUDE.md` (runtime variables),
`tools/README.md` only if an instrument changes.

Prerequisite: `~/projects/flags` checked out beside `trains_app` (the
sibling path `../flags`). Its `sdk/go` module requires
`github.com/JeremyVun/flags/server v0.1.0` and resolves it with a local
`replace`; replace directives in dependencies are ignored, so this module
declares both.

Build:

- `go.mod`: `require github.com/JeremyVun/flags/sdk/go v0.1.0` and
  `require github.com/JeremyVun/flags/server v0.1.0`; `replace` each to
  `../flags/sdk/go` and `../flags/server`. Run `go mod tidy && go mod vendor`
  and commit `vendor/` (the core is stdlib-only; expect a handful of files).
- `.dockerignore`: add `!vendor/` and `!vendor/**`. `Dockerfile` build
  stage: `COPY vendor ./vendor` before the sources and
  `ENV GOFLAGS=-mod=vendor`.
- `internal/flagsd/client.go`: `New(serviceURL, key string, cachePath
  string) (*Client, error)` wrapping the SDK with project `ilovetrains`,
  environment `production`, application `ilovetrains`, `FailDefault`,
  `StaleThreshold` 0, `LocalCachePath` = `cachePath`; implements
  `api.Flags` by `BoolVariation(key, flags.EvalContext{}, def)` and
  `Version()`; `Close()` on shutdown.
- `main.go`: when both `FLAGSD_URL` and `FLAGSD_KEY` are set, construct the
  adapter with the cache file under `NATIVE_DATA_DIR` (fall back to the OS
  temp dir when unset) and pass `api.WithFlags`. Log one line saying flags
  are enabled or disabled. Never log the key.
- `deploy.md`: the two variables, the `shared-flags` network, and the flags
  admin steps (project, flag, key) as a numbered runbook section. `CLAUDE.md`
  runtime-variable list gains both variables.

Verify gate:

- `go build ./... && go vet ./... && go test ./...` from a shell where
  `../flags` exists, and again with `GOFLAGS=-mod=vendor` to prove the
  vendored build.
- `docker buildx bake --set ilovetrains.platform=linux/amd64 --load` succeeds
  from the repo (the build never reaches `../flags`).
- Local end-to-end: run flagsd from `~/projects/flags` with a throwaway
  compose project (`docker compose -p transfer-cap-flags --env-file
  /tmp/transfer-cap-flags.env up -d`, generating `FLAGSD_TOKEN` and its
  sha256 into that env file; never read the repo's own `.env`). Create
  project `ilovetrains`, flag `transferLimit` (boolean, public), mint an
  environment-scoped read key through flagsd's API with the bootstrap token,
  start `go run ./cmd/server` with `FLAGSD_URL` and `FLAGSD_KEY`, and show
  `curl /api/v1/flags` flipping within a second of toggling the flag. Tear
  the compose project down afterwards (`down -v`).
- With both variables unset, `/api/v1/flags` returns `false` and the server
  logs flags disabled.

Done marker: `[x] phase 2 done` (2026-09-07, branch `tc-p2` on `tc-p1`, commits d886909, 54263fc, 5cd4813). Local end-to-end: throwaway flagsd compose, project `ilovetrains`, flag `transfer_limit` (see design D4a), read key minted via `POST /v1/keys`; `/api/v1/flags` read `false`, then `true` 0.054 s after the config PATCH, then `false` 0.061 s after the second; unset variables log `flags disabled` and serve `{"version":"","flags":{"transferLimit":false}}`. As landed: `internal/flagsd.New(serviceURL, key, cachePath)`, `flagsdKeys` maps `transferLimit` → `transfer_limit` in the adapter only; `vendor/` holds the two flags packages plus the pre-existing gtfs and protobuf modules (vendoring is all-or-nothing); the image builds without `../flags`.

## Phase 3 — Web client (after 1; parallel with 4 and 5)

Owns: `web/js/preferences.js`, `web/js/storage.js`, `web/js/api.js`,
`web/js/main.js`, `web/js/home.js` (only if the status derivation moves),
`web/js/settings.js`, `web/app.css`, `web/sw.js` (`VERSION` bump), tests in
`web/test/` (`preferences`, `storage`, `api`, `settings`, `home`,
`focus`),
`docs/contracts/client-storage.md`, `docs/contracts/ui.md` (Settings
section and the six-services sentence).

Build:

- `preferences.js`: `transferLimit` in `preferencesOf` and `setPreferences`;
  `journeyAllowed(journey, modes, capped = false)` and
  `filterBody(body, modes, capped)`; export `effectiveCap(doc)`.
- `storage.js`: `flagsOf(doc)` and `setFlags(doc, flags)` with the
  validation in the seam contract. `parseDoc` and `serializeDoc` whitelist
  top-level keys (`locationAsk`, `telemetry`, `preferences` around lines
  147-184), so `flags` must be added to both or it is dropped on save.
- `api.js`: `getDepartures` accepts `transferLimit` and sets it only when given;
  `getFlags()` returns the parsed object or rejects offline.
- `main.js`: fetch flags after first paint, persist, and route a changed
  `capped` through the mode-change path (the block that starts "if
  (before.enabledModes.join…"); send `transferLimit: 2` when capped on every
  board request except the focus refresh; apply `capped` wherever
  `enabledModes()` filters a body.
- `settings.js`: the `Transfer limit` row inside `services()` directly
  after the note, per `comps/settings-390x844-transfer-limit.png` and its
  `-any`, `-light`, `-all-off` and 412 frames: the `st-person-row`
  composition without the icon column, title `Transfer limit`, subtitle the
  current value (`Up to 2` / `No limit`), mark the other value in caps
  (`NO LIMIT` / `UP TO 2`), one 56px button, no journey line, no colour;
  absent when the flag is off; the action handler calls
  `setPreferences({ transferLimit })` and repaints. Any CSS goes in
  `app.css` beside the person-row rules.
- `sw.js`: bump `VERSION`.
- Contracts: `client-storage.md` preferences block and `flags`; `ui.md`
  Settings paragraph for the row and its two states, and the "all six
  remain whole" board sentence qualified to two changes. `journeybar.js`,
  the axis CSS and the Home header are not touched.

Verify gate:

- `(cd web && npm test)` green with new cases: `transferLimit` normalisation
  (`two`, `any`, junk, absent), `flags` normalisation, `journeyAllowed` with
  `legs` 3 and 4 under both caps, `filterBody` under both, `getDepartures`
  URL with and without `transferLimit`, Settings markup with the flag on and off
  (off must equal today's markup byte for byte), and a flag flip mid-session
  triggering one refetch.
- `node tools/check-settings-browser.js --url http://localhost:8197` and the
  `tools/shoot-states.js` board scenarios pass at 390×844 and 412×732, both
  schemes.
- `tools/visual-regression.js` for web: every frame either identical or an
  intended change accepted into `tools/baselines/web/`.

Done marker: `[x] phase 3 done` (2026-09-08, branch `tc-p3` on `tc-p1`, commit 8fd5169). `VERSION` is `v45` (an uncommitted v44 sat in the shared checkout's `web/sw.js` from another session; the integrator re-checks the number at merge). Smoke frames `/tmp/tc-p3-settings-*.png` are byte-identical to the comps and the flag-off frame to `tools/baselines/web/settings.png`; baselines not accepted (phase 6). As landed: `preferences.js` exports `effectiveCap(doc)`, `flagsOf(doc)`, `setFlags(doc, flags)` (kept out of `storage.js` to avoid an import cycle), `journeyAllowed(journey, modes, capped = false)`, `filterBody(body, modes, capped = false)`; `api.js` `getFlags({ signal })` and `getDepartures(..., { transferLimit })`; `settings.js` exports `services(enabledModes, transferLimit = null)` and `transferRow(transferLimit)`; `main.js` `refetchEligible()` is the shared mode/cap refetch path and `loadFlags()` runs after `route()`; `focus.js` `visibleFocus` takes the cap. The aria-label (Codex draft): `Transfer limit, Up to 2 transfers, Change to no limit` / `Transfer limit, No limit on transfers, Change to up to 2 transfers`. Instrument trap for `tools/README.md` (phase 6 records it): `tools/screenshot.js --seed` navigates twice, so a URL with a fragment makes the second navigation same-document and the seed never applies; seed against the bare origin and set `location.hash` from `--eval`.

## Phase 4 — Android (after 1; parallel with 3 and 5)

Owns: `android/app/src/main/java/com/ilovetrains/app/Models.kt`,
`Storage.kt`, `TransitApi.kt`, `TrainViewModel.kt`, `OfflinePlanner.kt`,
`OfflineRouter.kt`, `UiSettings.kt`, tests `StorageTest.kt`,
`TransitApiTest.kt`, `OfflineRouterTest.kt`, `BoardRetentionTest.kt` (if
it asserts the cached-read filter), `docs/contracts/android-deviations.md`.

Build:

- `UserData` gains `transferLimit: TransferLimit = Two` and
  `flags: Map<String, Boolean> = emptyMap()`; `Storage.kt` writes and reads
  both with the seam validation.
- `TransitApi.departures(..., transferLimit: Int? = null)` adds the parameter when
  non-null; `TransitApi.flags()` parses the endpoint.
- `TrainViewModel`: `capped` from data; every place `data.modes` filters
  journeys (the `compatible` and cached-read paths) also applies `legs <= 3`
  when capped; board requests pass `transferLimit = 2` when capped, focus refresh
  never; `setTransferLimit` persists and follows `setMode`'s refetch path;
  flags are fetched after the first paint and a changed `capped` follows
  the same path.
- `OfflinePlanner.plan(..., maxTransfers)` passes the bound to the router
  per the arithmetic; `OfflineRouter` takes the bound per call, default 2.
- `UiSettings`: the `Transfer limit` row inside the Services section after
  its note, ported from `comps/settings-390x844-transfer-limit.png` with
  the screen's existing location-row composition minus the icon (72dp
  row); absent when the flag is off.

Verify gate:

- `tools/build-android.sh` green with new JVM tests: storage round trip and
  defaults; request URL with and without `transferLimit`; router honours 2 and 4;
  cached read filtered under the cap.
- `tools/shoot-android.sh` Settings frames and `tools/visual-regression.js`
  for Android with intended changes accepted into `tools/baselines/android/`.

Done marker: `[x] phase 4 done` (2026-09-08, branch `tc-p4` on `tc-p1`, commits 88ec9b9, a7c1ff7). Smoke frames `/tmp/tc-p4-settings-{capped-dark,any-light,flag-off,flag-off-light}.png`; flag-off frames byte-identical to `tools/baselines/android/settings*.png`; capped-dark matches the comp grammar (72dp row, recorded in `android-deviations.md`). As landed: `UserData.transferLimit`/`flags`/`capped`/`offlineMaxTransfers`, `Journey.withinTransferCap`, `BoardData.withinTransferCap`, `TransitApi.flags()`, `TransitApi.focusedDepartures` (uncapped focus refresh), `UiActions.setTransferLimit`, `AppState.transferLimit: TransferLimit?` (null = flag off), `TrainViewModel.readFlags()`. `UiCalibrationTest.kt` gained capture states `settings-transfer-limit` (capped, dark) and `settings-transfer-limit-light` (uncapped, light): phase 6 adds their rows to `tools/visual-regression.js` and accepts baselines. Tests: `StorageTest.transferLimitAndFlagsSurviveRestartAndFallBackToTheCap`, `StorageTest.cappedNeedsBothTheFlagAndThePreferenceAndBoundsOfflineRouting`, `TransitApiTest.boardRequestsCarryTheTransferLimitOnlyWhenTheCapIsOn`, `TransitApiTest.theFollowedJourneyIsRefreshedWithoutATransferLimit`, `TransitApiTest.flagsReadBooleansAndIgnoreEverythingElse`, `OfflineRouterTest.threeChangeRouteAppearsOnlyWhenTheCallerRaisesTheTransferBound`, `BoardRetentionTest.aCachedBoardLosesItsThreeChangeRowsOnlyWhileTheCapIsOn`.

## Phase 5 — iOS (after 1; parallel with 3 and 4)

Owns: `ios/ILoveTrains/Core/DeviceStore.swift` (`UserData`),
`AppState.swift`, `TransitAPI.swift`, `TrainViewModel.swift`,
`OfflinePlanner.swift`, `OfflineRouter.swift`, `UI/SettingsView.swift`,
tests `StorageTests.swift`, `OfflineRouterTests.swift`,
`ControllerTests.swift`, `docs/contracts/ios-deviations.md`.

Build: mirror phase 4 with the iOS idioms. `UserData` decodes both new
fields with `decodeIfPresent` so an older document reads `two` and no
flags. Simulator id for shots comes from `tools/baselines/manifest.json`
(export `ILOVETRAINS_SIMULATOR_ID`; two booted simulators break the
shooter).

Verify gate: `tools/build-ios.sh --test` green with the same four test
families; `tools/visual-regression.js` for iOS with intended changes
accepted into `tools/baselines/ios/`.

Done marker: `[x] phase 5 done` (2026-09-08, branch `tc-p5` on `tc-p1`, commits ca433e8, 015b471). Smoke frames `/tmp/tc-p5-settings-{transfer-limit,transfer-limit-no-limit,transfer-limit-light,flag-off}.png`; flag-off identical to `tools/baselines/ios/settings.png` outside the clock band. As landed: `UserData.transferLimit`/`flags`/`capped`/`requestTransferLimit`/`offlineTransferBound`, `withinTransferLimit` overloads; `TrainViewModel.cachedBoard`, `currentFocus`, `applyPreferenceChange()` (shared by `setMode`, `setTransferLimit` and a changed flag), `refreshFlags()`; `TransitAPI.flags()`; `OfflinePlanner.plan(..., maxTransfers: Int = 2)` → `OfflineRouter.route(..., maxTransfers: Int? = nil)`; `SettingsTransferLimitPresentation`; `personalRow` icon optional. New test file `TransferLimitRequestTests.swift` (project regenerated). Calibration states `settings-transfer-limit`, `-no-limit`, `-light` added for the shooter: phase 6 adds them to the visual-regression screen table. Row is 72pt (recorded in `ios-deviations.md`). Hazard: peers running `xcodebuild test` on the same simulator install their own bundle mid-run; verify the new test names appear in the log.

Integration: `tc-int` (worktree `/private/tmp/trains-tc-int`) = `tc-p2` + `tc-p3` + `tc-p4` + `tc-p5`, every merge clean; Go, web and Android gates green on it before phase 6.

## Phase 6 — Verification wave and document closeout (after 3, 4, 5)

Owns: `tools/baselines/`, `assets/comps/latest/`, `docs/PROJECT.md`
(principle 3), `docs/contracts/native-data.md` (offline bound),
`docs/contracts/ui.md` (final wording). `native-conformance.test.js` covers
prediction and rows only and needs no change.

Do:

- Run `tools/visual-regression.js` for all three clients from a clean state
  (check APK and app-bundle mtimes and `git status` first: peers' rebuilt
  apps are the usual false diff). Judge every composite; accept only
  intended changes.
- Replace the Settings exemplars in `assets/comps/latest/` with the shipped
  frames (web, Android and iOS, with the row present and flag on).
- Amend principle 3 to name this choice as the justified exception.
- Confirm every contract sentence added in phases 1 to 5 reads as one
  contract, not five patches.

Verify gate: the four primary test gates in `CLAUDE.md` green; the
regression run reports no unaccepted differences.

Done marker: `[x] phase 6 done` (2026-09-08, on `tc-int`, commits 257b37d, e7acb8c, 9ef6e43, ca4d702, 99f932c, 7399edc). Gates: Go ok, web 346 pass, Android BUILD SUCCESSFUL, iOS TEST SUCCEEDED. Regression: web 37 identical + 4 new (`settings-transfer-limit`, `-any`, `-light`, `-412`), Android 29 identical + 2 new (`settings-transfer-limit`, `-light`), iOS 20 identical + 3 new (`settings-transfer-limit`, `-any`, `-light`); no existing frame moved. Exemplars added to `assets/comps/latest/` for all three clients (flag-off exemplars kept, since the flag ships off and the shooter rewrites both sets). Pre-existing defect not accepted: web `home-services-filtered` prints the wall clock of the run (recorded in `tools/README.md`). Known drift: Android's `settings-transfer-limit-light` state is uncapped light while web and iOS `-light` are capped light.

## Integration onto main's flags channel (2026-09-08)

Main moved under this build: a peer shipped its own flagsd integration
(`tiny_train`, commits 6182609..995dc16, production 1.3.1, sw `v47`). Design
D5 rules that this feature adapts to it. `git merge main` into `tc-int`
conflicted in ten files; an integration agent resolves them: main's
`third_party/flags/` snapshot and `FLAGS_*` variables replace phase 2's
`vendor/`, `internal/flagsd` and `FLAGSD_*`; one flat `/api/v1/flags`
(`{"tiny_train": bool, "transferLimit": bool}`, `no-store`) with a
published-name → flagsd-key table in `internal/api/flags.go`; clients parse
the flat object; sw `v48`. Phase 2's done marker above records what was
built and verified; only its mechanism is superseded.

Done marker: `[x] integration done` (2026-09-08, merge commit c0b9c73 on `tc-int`, all four gates plus race and the Docker bake green; `/api/v1/flags` unset reads `{"tiny_train":false,"transferLimit":false}` with `no-store`). Follow-up cb8e51c: web Settings baselines re-accepted for the peer's 1.3.1 version string (the only pixel difference). Second merge cf89ddc (main bf51380, native tiny train): only `project.pbxproj` conflicted and was regenerated with `ruby tools/generate-ios-project.rb`; both sides had bumped `web/sw.js` to `v48`, so e17b165 bumps to `v49`. Gates on e17b165: Go ok, web 353 pass, Android BUILD SUCCESSFUL, iOS 68 unit + 6 UI tests, 0 failures, `TransferLimitRequestTests` present in the log. Third merge (owner committed the peer work as main 6552593, 245 files): conflicts in both native view models, both storage files, the Xcode project, `tools/README.md`, the baseline manifest and `web/sw.js` (now `v51`); the native four are re-attached onto the peer's structure by an integration agent, the project regenerated, and all gates plus three-client visual regression rerun before the fast-forward. Handler table `publicFlagKeys`: `transferLimit` → `transfer_limit`, `tiny_train` → `tiny_train`. Open for the owner: the web app now makes two `/api/v1/flags` requests per open (this item's persisted once-per-open read and the tiny train's 30-second unstored poll); unifying means rewriting shipped tiny-train code. `FLAGS_ENV` defaults to `production` in code while production's key is `prod`, set explicitly in the stack (unchanged from main).

## Phase 7 — Production wiring and deploy (owner in the loop)

Most of this phase was done by the peer's deployment (infra `58f5a36`): the
ilovetrains stack already joins `shared-flags`, `FLAGS_KEY` is sealed,
`FLAGS_ENV=prod`, and the owner created `transfer_limit` (boolean, public,
off) in flagsd. What remains: build and push the image from the landed
main, `cli/deploy.sh ilovetrains`, verify `/api/v1/flags` reads
`transferLimit: false`, flip `transfer_limit` on in the admin UI, see `true`,
open the PWA and both native apps and see the row, flip off and see it
vanish. The original plan follows for the record.

Owned in the infra repository (`../projects/stacks/`), via the
`deploy-stack` skill: `flags/docker-compose.yml` (flagsd joins external
`shared-flags`), `ilovetrains/docker-compose.yml` (joins `shared-flags`),
`ilovetrains/config.env` (`FLAGSD_URL=http://flagsd:8080`),
`ilovetrains/secrets.env.example` (`FLAGSD_KEY`), `ilovetrains/secrets.env`
(the owner pastes the key; never read).

Findings while preparing (2026-09-08): the infra repo is `/Users/jeremy/projects/projects`
(`stacks/`, GitOps via `deployctl`; never SSH to deploy). The deploy engine creates
the shared external networks itself on every reconcile from a hard-coded list
(`agent/deployctl/internal/engine/engine.go` `sharedNetworks`, mirrored in
`agent/install.sh` `SHARED_NETWORKS` and `TestSharedNetworks`), but the host's
agent binary is installed by hand (`docs/DEPLOYCTL.md` §12), so adding
`shared-flags` there only covers future bootstraps. The flags stack's compose
already declares `shared-db` and `edge-proxy` as `external: true`; flagsd listens
on `FLAGSD_PORT=8080` (`stacks/flags/config.env`), so `FLAGSD_URL=http://flagsd:8080`.
The ilovetrains service reads `FLAGSD_KEY` as plain `${FLAGSD_KEY}` (no `:?`):
an unset key means flags disabled, which is the designed fallback.

Steps:

1. `docker network create shared-flags` on the host, once (owner break-glass
   SSH, or reinstall the agent after step 1a). 1a. Add `shared-flags` to
   `sharedNetworks`, `SHARED_NETWORKS` and the test in the infra repo so a
   fresh box gets it.
2. Deploy the flags stack with its compose change.
3. In the flags admin UI: project `ilovetrains` (production), flag
   `transferLimit` boolean public, off; mint a read key scoped to
   `ilovetrains/production`. The owner stages it in `secrets.env` and seals.
4. Build and push the image; deploy ilovetrains per `deploy.md`.
5. Verify `https://ilovetrains.jeremyvun.com/api/v1/flags` reads `false`,
   flip the flag on, see `true` within a minute, open the PWA and both
   native apps and see the choice appear; flip off and see it vanish.

Landed on main 2026-09-08: fast-forward to d291e5f, then ee4386b (release 1.4.0, `web/sw.js` `v51`), 7a589f2 and d09a5d6 (Settings baselines re-accepted for the version string; Android `settings` restored to the light frame the manifest's device renders). Image push and deploy were not run from this session (registry push blocked by the tool permission gate); remaining steps for the owner: the runbook's `docker buildx bake --push` from d09a5d6, `(cd ../projects && cli/deploy.sh ilovetrains)`, then verify `/api/v1/flags` reads `transferLimit: false`, flip `transfer_limit` on in the admin UI, see `true`, open the PWA and both native apps and see the row, flip off and see it vanish.

Done marker: `[ ] phase 7 done` with the production curl summarised.
