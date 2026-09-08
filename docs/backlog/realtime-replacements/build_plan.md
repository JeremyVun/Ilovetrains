# Replacement trips: build plan

Status: ready; no implementation phase completed. Binding behavior:
[design.md](design.md). Start build in a fresh context under `backlog-item`.

## Execution

Read repository instructions, design and referenced contracts. Inspect the
working tree: concurrent travel-tracker changes touch native models, refreshes,
presentation and tools. Preserve those changes and coordinate ownership before
parallel work. Never read/source `.env` or print credentials. Follow the build
skill's model guidance; repository instructions require `gpt-5.6-sol` for
computer use and review. Keep implementation and verification phases separate.
Record each exact gate/result here; skipped or partial gates are not done.

## Phase 1 — Fixtures and normalizer

- [ ] Done
- Own: `internal/native/realtime.go`, snapshot types/tests in `internal/native/`,
  minimal `tools/fixtures/` cases, extraction/replay tooling if needed,
  `tools/README.md`, `docs/contracts/{api,native-data}.md`.
- Add replacement validity without dropping the identity of malformed trips.
  Preserve stop order, absolute times, service dates and freshness rules.
- Extract Clarendon/Gosford passenger examples and excluded Wyong from the
  committed protobuf and package using the production date resolver. Include
  complete minimal static patterns/stop metadata for JVM/Swift tests. Declare
  synthetic variants and explicit expected connections and forbidden routes.
- Gate: `go test ./internal/native ./internal/api`; preserve deliberate capture
  replay counts; corrupt stops cannot form shortened routable replacements;
  fixtures reproduce from committed inputs without credentials or `/tmp` data.

## Phase 2 — Android routing

- [ ] Done
- Own under `android/app/src/`: `OfflineRealtime.kt`, `OfflinePlanner.kt`,
  `OfflineRouter.kt`, `Models.kt`, replacement helper(s), relevant JVM tests
  and `OfflinePlannerInstrumentedTest.kt`.
- Prepare one immutable pattern representation for routing/focus. Resolve it
  against one database generation. Enumerate replacement trips independently
  of the static query window, suppress static instances, construct connections,
  then filter/sort by effective time. Do not mutate static caches.
- Implement ordered occurrence matching, timing validation, inserted/skipped
  calls, passenger restrictions, changed terminal and schedule-known metadata.
- Gate: shared JVM fixture expectations plus the real SQLite planner gate
  documented in `tools/README.md`. New platform routes; old one does not;
  termination blocks travel beyond it; moved-in-window service appears;
  expiry and package switch cannot leak old derived patterns.

## Phase 3 — iOS routing

- [ ] Done
- Own: `ios/ILoveTrains/Core/{OfflineRealtime,OfflinePlanner,OfflineRouter,
  TransitModels,OfflineDatabase}.swift`, helper(s), relevant XCTest files and
  generated Xcode project if files are added.
- Implement the same phase-2 seam with actor/generation guards and shared
  fixture expectations. Preserve baseline platforms and old-data decoding.
- Gate: `tools/build-ios.sh --test`, including real SQLite planner tests for
  the Android cases, suffix updates and loops. Use the documented project
  generator for new files. Do not accept divergent platform expectations.

## Phase 4 — Native focus, retention and presentation

- [ ] Done
- Own Android: `Models.kt`, `Storage.kt`, `UiPresentation.kt`,
  `TrainViewModel.kt`, `MainActivity.kt`, existing tracker projection/tests.
  Own iOS: `TransitModels.swift`, `DeviceStore.swift`, `TrainViewModel.swift`,
  `AppState.swift`, affected home/board/detail/common views and existing
  tracker projection. Own corresponding storage, retention, settlement and
  focus tests; contracts `client-storage.md`, `native-data.md`, `ui.md` and
  relevant native deviations.
- Project prepared patterns onto exact selected services before cache merge
  and settlement. Preserve identity anchors, source ownership, partial-leg
  freshness and tracker session. Distinguish missing historical prefixes from
  removed future endpoints. Fresh structure defeats cached static routes even
  with an empty local board or no numerical delay.
- Add optional structured failure reasons and shared unusable predicates;
  audit cancellation-only selection/progress/arrival checks. Render the design's
  copy in existing slots and preserve observations across expiry/restart.
- Gate: `tools/build-android.sh`, `tools/build-ios.sh --test`; repeat-refresh,
  storage migration, arrival correction, removed endpoint, historical prefix,
  partial-source, cache-resurrection and tracker-session tests. No unusable
  journey earns an automatic successful ride or achievable arrival claim.

## Phase 5 — Web and shared online path

- [ ] Done
- Own: `internal/tfnsw/map.go` and mapping tests if needed; affected
  `web/js/` journey/focus/board/home/detail/API/storage modules and tests,
  `tools/shoot-states.js` fixtures/drives, `web/sw.js`, affected contracts.
- Prove returned replacement details survive mapping/rendering and focused
  refresh. Stable scheduled-key platform/headsign changes update pins; changed
  onward services cannot steal them. Unmatched results stay last known. Fix
  failures without direct GTFS consumption or nearest-time identity guesses.
  Include equivalent online-native behavior.
- Add tests/drive states even when production behavior already passes. Bump
  service-worker `VERSION` with any changed file listed in `SHELL`.
- Gate: `go test ./internal/tfnsw ./internal/api`, `(cd web && npm test)`.
  First/last summaries agree with leg details; changed platforms survive reload;
  missing results neither manufacture cancellation nor switch selected trains.

## Phase 6 — Integrated verification and review

- [ ] Done
- Own: verification tools/fixtures and intended `tools/baselines/` updates.
  Fix findings in their owning phase; do not accept unrelated visual changes.
- Run `go test ./...`, `(cd web && npm test)`, `tools/build-android.sh`,
  `tools/build-ios.sh --test`.
- Drive real web/Android/iOS clients through cached static → replacement →
  stale → reload, covering board, detail, pinned home and existing Android
  tracker. Cases: platform-only, changed terminal, removed boarding stop,
  broken transfer and ambiguous update.
- Read `tools/README.md`; use documented 390×844 / 412×732 matrices, native
  size mappings, both schemes and enlarged native text. Assert platform,
  headsign, no false arrival, recovery/unpin reachability and no clipping.
  Run `node tools/visual-regression.js --platform web,android,ios`; inspect
  affected frames against exemplars and accept only intended differences.
- Review implementation with `gpt-5.6-sol` per repository instructions; verify
  and fix surviving findings. Distinguish synthetic online fixtures from live
  disruption evidence and simulator results from physical-device delivery.

## Phase 7 — Release and closeout

- [ ] Done
- Own: version/release artifacts, durable contracts, roadmap and this folder;
  infra only if deployment configuration changes.
- Migrate final rules/seams to contracts, update links and retain added services
  as a separate roadmap candidate. Use `backlog-item` close guidance plus
  deployment skills/runbooks. Never close merely because code compiles.
- Bump canonical version; build signed Android download; prepare iOS according
  to its operations runbook. Commit completed release scope without sweeping
  in concurrent work. Deploy committed server/web through
  `docs/operations/deploy.md`; source push alone does not deploy.
- Gate: production health, shell/version and snapshot compatibility; confirm
  downloadable APK release and actual iOS archive/install outcome. A server
  deployment is not native distribution. After all gates pass and current
  rules are durable, delete this entire backlog folder; git retains history.
