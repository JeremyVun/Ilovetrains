# Replacement trips: build plan

Status: ready; no phase done. Binding behaviour: [design.md](design.md).
Start the build in a fresh context under `backlog-item`.

## Execution

Read the repository instructions, the design, `docs/contracts/native-data.md`
and `tools/README.md`. Run `git log main --since='1 day'`, `git status` and
`coord status` first. On 2026-09-14 a peer session had uncommitted changes to
native UI, `TrainViewModel`, `Models.kt`, `AppState.swift`, `web/` and
`docs/contracts/ui.md`, for a startup status fix. This plan owns none of those
files; if a phase finds it needs one, coordinate through coord first. Never
read or source `.env`. Record each gate's exact command and result here; a
skipped or partial gate is not done.

Phase 5's visual-regression run is visual QA, so only Opus 5 or Astra may run
or judge it; Sol never does. All other work is nonvisual. Phases 2, 3 and 4
are independent after phase 1 and may run in parallel. Assign their models
under the owner's routing and delegation limits at build time. An Astra
assignment needs the owner's explicit authorization.

## Phase 1 — Server flag and shared fixture

- [ ] Done
- Own: `internal/native/realtime.go`, the snapshot types, `realtime_test.go`,
  the refresh log line in `service.go` and its exact-log assertions in
  `service_test.go` and `review_probe_test.go` (all in `internal/native/`),
  the `stopsDropped` lines in `docs/contracts/api.md` and
  `docs/contracts/native-data.md`, the example log line in
  `docs/operations/deploy.md`,
  `tools/fixtures/conformance/replacement-overlay.json`, its generator under
  `tools/`, and a `tools/README.md` entry.
- Server: implement the design's flag. Emit `stopsDropped: true` only on a
  `replacement` update that lost a supplied stop; never on other statuses;
  never `false`. Count affected updates in `RealtimeCounts` and add
  `stops_dropped=<n>` to the refresh log line, with a nonzero test case.
  Normalizing the capture must emit no flag and leave the preserved capture
  counts unchanged.
- Generate the fixture from committed inputs only, each verified before use:
  - the capture metadata `gtfs_realtime_sydneytrains_20260906.json`, which
    gives the byte count, SHA-256 and `receivedAt`
  - the capture `.pb`
  - `native-data/bootstrap/manifest.json`
  - the trip-index sidecar it names, checked against its SHA-256
  - the package zip, checked against the manifest's SHA-256
  Service dates must come from the
  production resolver, `NormalizeRealtime` with the capture's `ServiceDates`
  as `loadSydneyTrainsCapture` builds them, because the updates carry no start
  date. One documented command regenerates the file byte for byte, with no
  network, credentials or `/tmp` inputs.
- Contents: the normalized update and the full timetabled stop list (stop ID,
  station ID and name, platform, sequence, scheduled times, pickup and drop-off)
  for all 23 non-`Empty Train` passenger replacements in the capture. They
  include `700Z…` and `83-W…`, which pass Central twice with exact matches.
  Add these declared synthetic cases:
  - an ambiguous pinned pair without a unique exact pair
  - a skipped endpoint
  - an update stop the timetable cannot resolve
  - a `scheduled` update with a missing stop, whose behaviour must not change
  - a loaded window that cuts a trip and starts at the second visit of a
    repeated station
  - a replacement that reaches its next matched stop sooner than the
    timetable's passed stations imply, so the clamp keeps the ride
  - passed stations whose previous or next matched stop is `noData` or has
    no usable event, so the clamp uses that stop's timetable time
  - a replacement whose matched stop carries an `assignedStopId` at the same
    station (the platform changes), and one at another station (cancelled),
    for both new plans and pinned trips
  - a `metro` replacement with a platform move, which keeps today's exact
    matching because only `sydneytrains` changes
  - two successive snapshots, where the second drops the stops a ridden train
    has passed. The pinned leg becomes unconfirmed and keeps its values. A
    leg cancelled before its departure stays cancelled after it.
  - an update whose last stop is `skipped`
  - an update whose last stop is unresolvable, where the headsign stays
  - a `stopsDropped` replacement, which must give today's exact-match
    outcomes: platform move cancelled, no passed stations, headsign kept
- Ground truth per boarding/alighting pair comes from the update alone. A pair
  is served when the update lists the boarding station before the alighting
  station. Pairs need timetable pickup at the boarding stop and drop-off at
  the alighting stop. Record the expected counts:
  - 6,527 pairs, 4,968 of them served
  - 370 served pairs cross a feed time fault: `N782…` Gosford → Point Clare
    or `N601…` Eastwood → Epping
  - 53 pinned pairs have a departure after their arrival
  A difference from these numbers is a finding to explain, not a count to
  edit.
- Explicit assertions:
  - `535U…`: Windsor → Clarendon is served at platform 1 with headsign
    Clarendon, and Mulgrave → Richmond is cancelled.
  - `N785…`: Gosford → Wyong departs platform 3, and Central → Gosford is
    cancelled.
  - `149M…`: Central → Blacktown is routable through the omitted stations, and
    Lidcombe reads platform 4.
  - `152R…`: Central → Wynyard departs platform 17 and arrives at platform 6,
    Wynyard → North Sydney is cancelled, and the headsign is Central.
- Gate: `go test ./internal/native ./internal/api`; run the generator twice
  and diff the output (identical); the JSON parses; the counts match the
  design's evidence section.

## Phase 2 — Android

- [ ] Done
- Own: `android/app/src/main/java/com/ilovetrains/app/OfflineRealtime.kt`, the
  lookups it needs in `OfflinePlanner.kt` (each replaced trip's complete
  timetabled stop list, and stations),
  `OfflineRealtimeTest.kt`, a new fixture-driven JVM test, and two cases in
  `OfflinePlannerInstrumentedTest.kt`.
- Implement the design's planning and pinned-trip rules for `replacement`
  updates only. Parse the optional `stopsDropped` field; a trip whose update
  carries it keeps today's exact matching. Keep the overlay signatures'
  callers working. Memoize station and stop-list lookups per plan and per
  focused refresh. Never mutate cached static connections.
- Fixture test: apply the planning overlay per trip. For every pair, check
  that it is routable exactly when it is served, by walking non-cancelled
  connections with pickup at the boarding stop, drop-off at the alighting stop
  and non-decreasing times. The 370 fault-crossing pairs must be refused.
  Then apply the pinned-trip overlay to every pair. Give each leg a retained
  departure after the header, like a rider waiting to board, so the
  dropped-history exception does not apply; the two-snapshot case covers it.
  Served pairs are usable,
  except the 53 whose departure is after their arrival, which are unconfirmed.
  Unserved pairs are cancelled. Among the synthetic cases, only the declared
  ambiguous pair is unconfirmed. Check the explicit assertions and the
  synthetic cases. Update
  `replacementCannotReuseAStaticStopMissingFromItsPattern` to the new meaning,
  since a stop beyond the new ends is still cancelled.
- Real SQLite cases with the bundled package, each using the capture's update
  with the snapshot header rebased to the test clock and the stops kept:
  - Plan Windsor → Clarendon on `535U…`. Expect the train at platform 1
    headed to Clarendon. The same plan without the update returns the
    timetabled platform 2.
  - Plan from Central on `700Z…` at a time after its first Central departure,
    so the loaded window starts at the second Central visit. Expect the
    second visit's departure and platform, which proves the lookup reads the
    complete ordered stop list.
- Gate: `tools/build-android.sh`, then
  `cd android && ./gradlew :app:connectedDebugAndroidTest
  -Pandroid.testInstrumentationRunnerArguments.class=com.ilovetrains.app.OfflinePlannerInstrumentedTest`
  with `ANDROID_SERIAL` set to an emulator this session owns. The build script
  does not run instrumented tests.

## Phase 3 — iOS

- [ ] Done
- Own: `ios/ILoveTrains/Core/OfflineRealtime.swift`, the matching lookups in
  `OfflinePlanner.swift`, `ios/ILoveTrainsTests/OfflineRealtimeTests.swift`, a
  new fixture-driven XCTest, the two real-SQLite planner cases,
  `tools/generate-ios-project.rb` and the generated Xcode project.
- The generator lists conformance fixtures by name. Add
  `replacement-overlay.json` to that list, regenerate the project, and have
  the XCTest fail if the fixture is missing from its bundle.
- Same rules, the same fixture expectations and the same two real-SQLite
  cases as phase 2. Platforms must not diverge. If they are forced to, record
  it in `ios-deviations.md` and stop for an owner ruling.
- Gate: `tools/build-ios.sh --test`, with `ILOVETRAINS_SIMULATOR_ID` exported
  as the UDID of a simulator this session owns. Create one with
  `xcrun simctl create` if needed. The script otherwise picks any booted
  iPhone, including a peer's. The baseline manifest names a device rather
  than giving a UDID, and that named device no longer exists.

## Phase 4 — Web and online proof

- [ ] Done
- Own: a mapping test in `internal/tfnsw/`; a pinned-trip test in
  `web/test/focus.test.js`.
- Go: the Central leg of `tools/fixtures/trip_central_parramatta.json` maps
  to Platform 13 (live) rather than Platform 12 (planned).
- Web: `refreshFocus` with a journey matching on every leg's line and scheduled
  departure, but with a new platform, updates the pin's platform. A journey
  whose onward leg is a different service leaves the pin unchanged.
- Only tests change, so there is no `web/sw.js` bump. Confirm no `SHELL` file
  changed.
- Gate: `go test ./internal/tfnsw ./internal/api`, `(cd web && npm test)`.

## Phase 5 — Contracts, review and full gates

- [ ] Done
- Own: `docs/contracts/native-data.md`, any headsign-source line in
  `docs/contracts/ui.md` (coordinate with the peer's edits there),
  `docs/ROADMAP.md`, `docs/references/tfnsw-open-data.md`.
- Record the design's upstream observations in the reference document:
  - replacement stop lists are in travel order, with no sequences or
    assigned stops
  - a platform move appears as another platform's stop ID
  - stations passed without stopping are omitted, and passed stops are kept
  - some replacements carry backwards times
  - Trip Planner's `platformName` carries the live platform
- Write the design's rules into `native-data.md`: replace the current
  replacement sentence and the platform paragraph, and add the headsign rule
  and the backwards-time limit. The roadmap already carries the two
  follow-up candidates (added 2026-09-14). At closeout, remove only this
  item's own entry.
- Get an independent nonvisual review of phases 1–4 against the design under
  the owner's model routing. Verify each finding and fix the survivors in
  their owning phase.
- Gate on the final sources, one platform at a time: `go test ./...`,
  `(cd web && npm test)`, `tools/build-android.sh`, the phase-2 connected
  planner test, and `tools/build-ios.sh --test`. Then run
  `node tools/visual-regression.js --platform android,ios` under the
  `visual-regression` skill. No frame should change because of this item,
  since baselines contain no replacement. A fresh iOS simulator already
  differs from the baselines on digit glyphs, identically on `main`. So judge
  any difference against a run of the base commit from a second worktree on
  the same devices, and never accept a frame unseen. The playtest suite is
  not required because no web behaviour changes.

## Phase 6 — Release and closeout

- [ ] Done
- Own: version and release artifacts, contracts, this folder.
- Follow `backlog-item` close guidance, `docs/operations/android.md`,
  `docs/operations/ios.md` and `docs/operations/deploy.md`. Bump the canonical
  version; publish the signed APK; upload the iOS build. The server changed,
  so deploy it through the runbook no later than the phone releases. Older
  phones ignore the new field. If `main` is dirty, stop and tell the owner.
- Gate: downloadable APK and actual iOS upload outcome confirmed; production
  health and version checks pass; production
  `/api/v1/realtime/sydneytrains` still decodes, and carries `stopsDropped`
  only where set. Then check that the current rules live in contracts,
  delete this folder, and fix links to it.
