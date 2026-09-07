# Timetable reliability investigation — 2026-09-07

The native realtime pipeline has confirmed compatibility failures. The main
Sydney Trains feed is silently normalized to zero updates. Fixing that gate
alone leaves incomplete replacement/platform handling and native history
retrieval. This investigation adds a replay instrument and evidence; it does
not change or deploy application behavior.

## Evidence boundary

- Replayed all ten hash-verified raw protobuf captures from September 6 through
  the current Go `NormalizeRealtime` function. Source files and metadata are in
  `/tmp/trains-gtfs-20260906-design`; their durable hash/coverage summary is
  `tools/fixtures/gtfs_realtime_summary.json`.
- Checked the public production API September 7 at 20:38–20:40 Sydney. JSON
  evidence is in `/tmp/ilovetrains-reliability-20260907`.
- Read both native planners, board merging, history retrieval, realtime
  overlays, backend normalization/tests and TfNSW's Train v3.7 specification.
- No `.env` was read and no authenticated upstream request was made during
  this investigation. Fresh raw-source capture requires owner permission to
  load the unexported key. Current public snapshots do not reveal discarded
  upstream entities.
- The reported T9 Epping service has no exact departure timestamp/capture in
  this evidence. The historical train's individual failure cannot be proved.

## 1. Sydney Trains updates are all discarded

`internal/native/realtime.go` counts identities only when `start_date` exists,
then rejects every update without a valid date. The September 6 Sydney Trains
feed omits it in all 308 updates. Replaying the unmodified feed produces **zero
normalized updates with no error**; the second capture does the same (306/306).

The [GTFS Realtime TripDescriptor specification](https://gtfs.org/documentation/realtime/reference/#message-tripdescriptor)
makes this field conditionally required, not universally mandatory. Resolve
an unambiguous service instance using the static calendar and event times;
do not blindly substitute today's date, particularly after midnight.

Production at 20:38:03 Sydney still returned zero Sydney Trains updates with a
fresh 20:37:37 header and 20:39:07 expiry. Other normalized source counts were
NSW Trains 209, Metro 7, ferries 110 and MFF 83. MFF's header was still July 1;
its expired snapshot is correctly unusable despite containing updates.

This affects native local routing/realtime refresh. Online Trip Planner
responses take a separate path, so the app can show a real delay online while
its independent realtime overlay is entirely broken.

## 2. Platform changes and replacement services use unsupported semantics

Both `OfflineRealtime.kt` and `OfflineRealtime.swift` iterate existing static
connections. They expect `assignedStopId` for a platform change; a replacement
with an absent old endpoint cancels that connection. They do not build a new
connection pattern from replacement stops or add trips absent from static data.

The captured Sydney Trains feed has 88 replacements; 15 include stop IDs absent
from that trip's static pattern. None of its updates use `assigned_stop_id`.
For example, `Y476.442.149.128.D.10.91066680` replaces Wyong platform 1
(`2259941`) with platform 3 (`2259943`), with a trip timestamp equal to the feed
header. Even after date resolution, the current algorithm cannot route the
replacement connection correctly. There are also two ADDED trips, neither in
the captured static trip table.

[TfNSW Train v3.7, section 5.1](https://opendata.transport.nsw.gov.au/sites/default/files/2026-04/Real%20Time%20Train%20Technical%20Document%20v3_7_Open_Data.pdf)
explicitly includes platform changes, added/skipped stops, reroutes, changed
starts and early terminations in replacements. An overlay limited to delays
and static connections does not implement that coverage.

## 3. A second freshness gate needs source-specific validation

The normalizer rejects an entire update when its trip timestamp is more than
90 seconds older than the feed header, regardless of relationship. Isolating
the date gate with a diagnostic-only placeholder leaves 144 of 308 Sydney
Trains updates; 164 fail the timestamp threshold. Those 164 include 46
replacements and nine cancellations. Metro drops 20 of 24 in the same capture.

These counts prove discarded coverage, **not that every old update should be
accepted**. Some are genuinely old. Validate the lifetime of a structural
change/cancellation separately from the age of a delay prediction and from
the service date. Keep protection against expired feeds such as MFF. A blanket
removal of either date or timestamp validation is unsafe.

## 4. Online, offline and historical searches have different coverage

Both native `TrainViewModel` implementations race local routing against the
online API. `mergeBoardResults` gives a successful online response authority
over future services, including an empty response. Local future alternatives
are excluded once that online answer exists. This is the current contract,
but it means online availability still determines candidate coverage.

Both native `earlier()` implementations query only the local planner. They
never request the backend's supported historical `at` window. Thus they cannot
recover an online-only added/replacement service or its recent actuals from
the planner when that service is absent from retained cache.

At 20:39:53 Sydney, Town Hall (`200070`) → Rhodes (`213820`) returned four direct
T9 services for a current request. An explicit 20:10 window also returned the
departed 20:20 and 20:35 services. Their estimates were null, whereas the
20:50 service carried a 20:50:18 estimate. The earlier documentation's
roughly-one-hour actuals retention observation is not a guarantee for every
recent service. Retaining observations the rider already saw remains necessary.

Recent cache fixes preserve previously seen services offline, including
observed delays. They do not repair the missing feed join, reconstruct
unseen added services, or make static history equivalent to actual departures.

Journey deduplication uses line plus scheduled departure per leg, while local
legs carry exact GTFS identity and online legs do not. This is another seam
requiring cross-source identity tests; no collision was demonstrated here.

## 5. Health checks and tests did not catch usable-data loss

Normalization returns success after dropping every entity. The refresh service
publishes the empty result, and its logging reports errors rather than raw,
accepted, rejected and client-match counts. A fresh HTTP 200/header therefore
does not prove useful realtime coverage.

Existing backend fixtures supply `start_date` and explicitly expect missing-date
entities to be discarded. Native platform tests supply `assignedStopId`.
These prove the chosen internal contract, not compatibility with the captured
Sydney Trains feed. Real-source acceptance tests were missing at these seams.

Freshness also has a presentation mismatch: online API adapters mark boards
`source=live`, and the header's LIVE badge is board-level. Local boards become
live if any returned journey matches an update. The selected train or every
leg need not have an estimate. Individual figures have a separate Scheduled
provenance, but the header badge is not proof of that train's realtime coverage.

## 6. Arrival estimates can freeze while the train is still travelling

Additional owner report: on September 7 morning, Android showed a Rhodes →
Central arrival time but never reflected an approximately five-minute late
arrival when reopened. Departure time and whether this was travel mode or
trip detail remain unconfirmed.

The online-focused refresh in Android `TrainViewModel.refreshFocus()` queries
`at=focus.journey.departure` after boarding. The backend rounds that down to a
ten-minute bucket. `internal/api/server.go` selects a one-hour cache whenever
the bucket is more than 20 minutes old, without considering arrival times.
Thus an in-progress journey is treated as settled historical data. Rounding
can put a journey into this tier before 20 minutes have elapsed since boarding.

A deterministic handler reproduction confirmed the failure independently of
TfNSW: at 17:52 a departure 25 minutes earlier had an estimated 17:57 arrival.
The simulated upstream then changed arrival to 18:02. At 17:55 the same request
still returned 17:57, with only one upstream fetch and
`s-maxage=3600, stale-while-revalidate=86400`. The diagnostic asserted the
current failure, not desired behavior. Its source is retained in
`arrival-cache-reproduction.go.txt`, outside the normal passing test suite.

Two adjacent paths also require correction:

- A focus created by local routing skips online focused refresh entirely and
  relies on the realtime overlay. Missing Sydney Trains updates therefore
  prevent new arrival estimates from reaching this path.
- `settleFocus()` runs on resume before network refresh. It records completion
  once the stored effective arrival time passes, even when that observation is
  stale. `UiHome` also declares completion from the clock. Once a ride record
  exists, a later corrected arrival does not remove that completion flag.
  Expected arrival is being treated as evidence of actual arrival.

If the report was on trip details rather than travel mode, board refresh
normally queries future departures; a departed detail keeps a matching merged
row or a retained snapshot, rather than requesting updates for that exact
service independently. This needs a separate in-progress detail refresh test.

These are confirmed implementation paths, not proof of which one affected
the reported morning train. Active arrival refresh must stay on a short
freshness policy, preserve known estimates when no new observation exists,
and distinguish an expected finish from confirmed completion. This cache
fault is shared by the iOS online-focus path as well.

## Repair order and acceptance evidence

1. Implement a verified service-instance resolver with explicit ambiguous,
   unmatched and stale outcomes. Replay real source fixtures, including the
   omitted-date feed, overnight services and calendar rollover.
2. Implement replacement stop patterns/platforms and added services, and
   distinguish structural validity from prediction freshness. Include the
   Wyong platform swap, cancellation, skipped stops and broken transfers.
3. Define one native candidate/identity authority across local routing,
   online fallback, cache and recent history. Retrieve available past online
   evidence; preserve the train already observed across connection loss. Keep
   in-progress arrival refresh out of the long-lived history cache and do not
   record an arrival solely because a stale estimate has passed.
4. Expose source and journey coverage and rejection reasons. Alert on sudden
   raw-to-accepted or accepted-to-matched collapse. Show live status only at
   the level supported by actual evidence.
5. Gate release with captured-feed end-to-end tests on both native clients,
   plus sampled current direct, interchange, disruption, midnight and offline
   journeys. Validate timetable facts independently; agreement with Trip
   Planner alone is not sufficient evidence.

Reproduce normalization counts without credentials:

```sh
go run tools/diagnose-realtime.go /tmp/trains-gtfs-20260906-design
```

`dateGateOnlyBypassedDiagnostic` uses an arbitrary in-memory date solely to
measure the next rejection gate. It is not a service-date inference strategy
and no altered feed is saved.

Validation: the hash-checked replay completed for ten captures;
`go test ./internal/native ./tools` and `git diff --check` passed. Existing
unit tests passing alongside the zero-update replay demonstrates the missing
source-compatibility gate; it does not certify timetable correctness.
