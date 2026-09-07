# Build plan — timetable-realtime repairs

Owner rulings 2026-09-07 (see `design.md`, "Owner rulings — 2026-09-07"):
fix the in-progress arrival freeze and the stale ride completion together;
resolve Sydney Trains service dates carefully; give structural updates their
own freshness rule; log what the realtime refresh actually accepted. Evidence
for every phase is in `investigation-2026-09-07.md`.

Numbers marked **[owner]** are policy. The owner may edit them in place; the
edited value is the spec.

Each phase is one Opus 5 agent in its own worktree under `/private/tmp`,
forked from current `main` (landmark: this file exists). Phases 1 and 2 are
independent and may run in parallel. Phase 3 depends on phase 2; phase 4 is
folded into phase 3.

## Phase 1 — arrival-aware settled cache and honest ride completion

Owns: `internal/api/server.go`, `internal/cache/cache.go`,
`internal/api/server_test.go`, `docs/contracts/api.md`, `web/js/main.js`,
`web/js/focus.js`, `web/test/*` for focus, `android/.../TrainViewModel.kt`,
`ios/ILoveTrains/Core/TrainViewModel.swift`, `docs/contracts/client-storage.md`.

Seam contract, backend:

- A settled bucket (`at` more than 20 minutes before now) is served from the
  one-hour store only when a response for it is already there. A miss fetches
  through the 30-second store's single flight, then the handler classifies the
  response: **settled** when every journey has arrived, using effective
  arrival (estimated, else scheduled) and counting a cancelled journey and an
  empty list as arrived; otherwise **in transit**. A settled response is
  copied into the one-hour store and served with the past `Cache-Control`. An
  in-transit response stays in the 30-second store and is served with the live
  `Cache-Control`, so the CDN also re-asks within 30 seconds.
- `internal/cache` gains three small methods to support this: a fresh-only
  read that does not fetch, a put, and a stale read used only after the
  30-second flight has failed, so the 24-hour stale fallback `api.md` already
  promises for a settled window stays reachable (build deviation accepted
  2026-09-07). Nothing from a stale read is ever promoted. No other cache
  semantics change.
- The contract paragraph in `api.md` that begins "Cache: a bucket more than 20
  minutes in the past is settled" changes to state both conditions. The
  sentence in the paging paragraph saying a settled page's `estimated` "can
  be up to an hour behind" becomes: such a page is held on the live policy
  until its last journey has arrived, and only then cached hard.
- Arithmetic a builder can check: departure 08:39, client sends
  `at=08:38`, bucket 08:30, settled tier eligible from 08:50:01. A 25-minute
  ride arrives 09:04, so under the old rule the estimate froze for the last
  14 minutes; under the new rule the response stays live until 09:04 and is
  cached hard on the first request after that.

Seam contract, clients (the "in line with 1" ruling):

- Completion is decided after the arrival evidence has had a chance to move,
  never before. Web: `main.js` currently records the completed focus from the
  old journey before applying the fresh body
  (`refreshFocus(recordCompletedFocus(doc), …)`); apply the body first, then
  record. Android and iOS: `resume()` and `start()` call `settleFocus()`
  before any network refresh; settle after the focus refresh completes or
  fails, and immediately only when the app cannot network.
- A ride already recorded during a live focus takes the refreshed effective
  arrival when a later refresh in the same focus lifetime moves it; the
  dedupe key (trip, direction, scheduled departure) identifies the row. If
  the refreshed arrival is again in the future, the ride row is removed and
  the focus is no longer OVER. Location-based completion within 200 m is
  unchanged.
- `client-storage.md`, "Completed rides", gains one sentence for the
  correction rule and one for the ordering rule.

Verify gate:

- Invert `arrival-cache-reproduction.go.txt` into a passing test: the second
  request 3 minutes later returns the moved arrival, two upstream fetches, live
  `Cache-Control`; then a third request after the arrival has passed returns
  the past `Cache-Control` and a fourth costs no upstream fetch.
- Web unit test for the record-after-apply ordering. Android JVM test and
  XCTest for settle-after-refresh and the ride arrival correction.
- `go test ./...`, `(cd web && npm test)`, `tools/build-android.sh`,
  `tools/build-ios.sh --test`. `sw.js` `VERSION` bump if `main.js` or
  `focus.js` are in `SHELL`.
- Done marker: delete `arrival-cache-reproduction.go.txt`.

Done: ☑ 2026-09-08 (backend merged 2026-09-07; clients merged after two Fable rounds and integration with the native-review and transfer-cap landings)

## Phase 2 — Sydney Trains service-date resolver

Owns: `tools/compile-timetable.py`, `tools/test/test_compile_timetable.py`,
`internal/native/realtime.go`, new `internal/native/servicedate.go` and test,
`internal/native/service.go`, `internal/native/timetable.go`,
`native-data/bootstrap/`, `tools/fixtures/` (new raw capture),
`docs/contracts/native-data.md`, `docs/references/tfnsw-open-data.md`,
`tools/README.md`, `Dockerfile` if the bootstrap copy needs the new file.

Facts the design rests on (verified 2026-09-07 against the September 6
capture):

- All 308 Sydney Trains updates omit `start_date` and `start_time`. 112 carry
  absolute stop times; the rest carry only delays. Trip IDs are unique within
  the feed. The static Sydney Trains bundle has 83,990 trips; 254 of the 308
  feed IDs match one exactly.
- The server holds the compiled timetable only as a SQLite file inside a ZIP
  and has no SQLite driver. The resolver therefore needs a server-readable
  trip index.

Seam contract:

- `compile-timetable.py` additionally writes a deterministic, gzipped,
  tab-separated sidecar beside `manifest.json`, one row per trip:
  `source, trip_id, first_departure_secs, service start, service end,
  weekday mask, added dates, removed dates`. The manifest records its name
  and SHA-256. It is server-only; phones never download it and the package
  hash is unchanged. Regenerate the bootstrap from the September 6 capture
  (`/tmp/trains-gtfs-20260906-design`) if it still exists; otherwise from a
  fresh `probe-gtfs.py` capture, which needs the key exported by the owner.
- `timetable.go` loads the sidecar with the active manifest and exposes a
  `ServiceDates` lookup; `NormalizeRealtime` takes it as a parameter.
- Resolution for an update without `start_date`: candidate service dates are
  the header's Sydney date minus one, itself, and plus one, filtered by the
  trip's calendar and exceptions. Each candidate's instance start is its date
  plus `first_departure_secs` as Sydney civil time. If the update has any
  absolute stop time, choose the candidate whose instance places that stop
  within **3 hours [owner]** of the given time. Otherwise choose the
  candidate whose instance start is nearest the header time within a window
  from **24 hours [owner, widened from 6 on 2026-09-07]** before the header
  to **3 hours [owner, narrowed from 24 on 2026-09-07]** after it. The
  narrowing followed the look-ahead measurement: Sydney Trains publishes
  nothing more than 0.9 hours ahead, and a 24-hour look-ahead would let a
  morning trip republished in the evening resolve to tomorrow's instance. The widening followed the replay: 40
  updates, 23 of them cancellations with a current timestamp, had their only
  running instance 7 to 21 hours before a 01:33 header, and phase 3's rule
  that a cancellation is true for the service day needs the whole day
  reachable. Two candidates at equal distance, or none in the window, is
  *ambiguous* or *unmatched*: the update is dropped and counted. A trip ID
  absent from the index is *unknown* and dropped and counted. An explicit
  `start_date` still wins when present. When the stop-time rule finds no
  instance within 3 hours (the index carries only first departures, so a
  late stop on a long trip misses), resolution falls through to the header
  rule rather than dropping the update (orchestrator ruling on the phase 2
  review, 2026-09-07).
- The runtime refresh persists the compiler's manifest, trip index included,
  to `current.json`; only the *served* manifest strips it (phase 2 review
  defect, 2026-09-07). Replay counts live in tests, not in contracts.
- The resolved date fills `serviceDate` in the snapshot, so client joins are
  unchanged.
- Add `sydneytrains-0.pb` (79,085 bytes) and its capture metadata to
  `tools/fixtures/` as a real-source fixture; existing fixtures keep their
  synthetic dates.

Verify gate:

- Replaying `sydneytrains-0.pb` through the normalizer with the September 6
  bootstrap index yields a non-zero accepted count; zero is the failure. The
  plan's earlier ≥200 target was miscounted (owner accepted the measured
  chain 2026-09-07): only 149 of the 308 feed trips exist in the compiled
  package, the rest being non-revenue, out-of-service or NSW
  TrainLink-operated trips phones can never join. Measured with the 6-hour
  look-back and the old 90-second gate: raw 308, accepted 69, unknown 159,
  ambiguous 40, stale 40. With the 24-hour look-back, 3-hour look-ahead and
  phase 3's relationship rule the same replay is raw 308, accepted 129,
  unknown 159, ambiguous 0, stale 20, with all 98 indexed cancellations and
  replacements published; those pins live in
  `TestNormalizeRealtimeReplaysTheCapturedSydneyTrainsFeed`.
- Table tests: trip running daily seen just after midnight resolves to the
  previous service day; the same trip seen at 23:00 resolves to today; a
  Friday-only trip seen on Saturday 00:30 resolves to Friday; a trip with an
  absolute stop time resolves by that time; equal-distance candidates are
  ambiguous; unknown trip counts.
- `python3 -m unittest discover -s tools/test`, `go test ./...`,
  `go run tools/diagnose-realtime.go /tmp/trains-gtfs-20260906-design` shows
  non-zero `normalizedUpdates` for both Sydney Trains files.
- `native-data.md`: replace the "Sydney Trains realtime coverage gap" section
  with the resolver rule; `tfnsw-open-data.md`: close the service-date gap
  note with the outcome.

Done: ☑ 2026-09-07 (merged to main, Fable-reviewed)

## Phase 3 — freshness by relationship, and refresh observability

Owns: `internal/native/realtime.go` and test, `internal/native/service.go`,
`cmd/server/main.go` if wiring a logger, `docs/contracts/native-data.md`,
`docs/operations/deploy.md` (what to look for in logs).

Seam contract:

- The snapshot-level rule is unchanged: expiry is header plus 90 seconds, and
  a feed header in the future or missing is rejected.
- Per-update trip timestamp rule replaces the single 90-second gate:
  - `cancelled`, `replacement`, `added`, `unscheduled` updates are accepted
    at any age within the snapshot. Their truth lasts the service day.
  - `scheduled` updates are accepted when the trip timestamp is absent or no
    older than **10 minutes [owner]** before the header, and no more than
    5 seconds after it. Older delay predictions are dropped and counted.
  - The accepted timestamp is still carried to clients unchanged.
- Captured distribution to check the number against (Sydney Trains, 01:33
  capture, measured with the original 6-hour look-back): scheduled updates
  aged ≤90 s: 42; ≤5 min: 6; ≤30 min: 5; ≤6 h: 23; older: 74. Cancellations:
  59 fresh, 9 older than six hours. Re-measured under the shipped resolver
  (indexed rows only): scheduled 51, of which ≤90 s 24, ≤10 min 7, ≤1 h 3,
  ≤7 h 5, older 12, so 31 accepted and 20 dropped; cancellations 59 (53
  fresh, 6 older than 7 h) and replacements 39 all accepted.
- `refreshSource` logs one line per successful refresh:
  `realtime source=<s> raw=<n> accepted=<n> unknown=<n> ambiguous=<n>
  stale=<n> duplicate=<n> header_age=<s>`; and one warning line when raw is
  non-zero and accepted is zero. Counts come back from `NormalizeRealtime`
  as a small struct rather than being recomputed.
- `native-data.md`, "Realtime snapshots", rewrites the freshness sentence to
  the two-tier rule; `deploy.md` gains the log line to grep for.

Verify gate:

- Table tests for each relationship at 0 s, 5 min, 11 min and 7 h old.
- Replay of `sydneytrains-0.pb`: every cancellation and replacement whose
  trip is in the index is accepted (120 structural updates are `unknown`
  because their trips are outside the compiled package); the count of
  dropped stale delays is asserted.
- A test that a feed normalizing to zero accepted updates emits the warning.
- `go test ./...`; run the server locally without a key and confirm the log
  line appears on the first refresh cycle.

Done: ☑ 2026-09-07 (merged to main, Fable-reviewed)

## Phase 4 — feed poll cadence

Owner ruling 2026-09-07: "agreed, raise the feed poll to 60 seconds."

Owns: `internal/native/service.go`, its test, `docs/contracts/native-data.md`,
`docs/operations/deploy.md`.

Seam contract: `defaultRealtimeInterval` becomes 60 seconds. Snapshot expiry
stays header plus 90 seconds, so a snapshot whose header was under 30
seconds old at receipt is still fresh when the next fetch lands at second
60 (the refresh log's `header_age` shows the margin), and clients keep
their own 30-second refresh against the server. Phone refresh and the Trip Planner
30-second cache are unchanged: they cost one upstream call per distinct
station pair per 30 seconds however many phones ask. Feed requests fall from
14,400 to 7,200 a day against a quota recorded as believed 60,000, unverified.

Verify gate: the service test that asserts the interval; `go test ./...`;
neither contract currently states the feed cadence, so add one sentence to
`native-data.md`, "Realtime snapshots". The 30 seconds at its "Foreground
refresh" sentence is the phone's refresh against the server and stays. Small enough to fold into phase 3's agent.

Done: ☑ 2026-09-07 (merged to main with phase 3)
