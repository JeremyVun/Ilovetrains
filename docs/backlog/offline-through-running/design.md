# Offline through-running: stay seated at Central

Stage: diagnosed, design not started. The owner asked on 2026-10-02 for this to
be investigated separately from `commute-reliability`, after phases 2b and 3a
both found that the bundled timetable never offers a direct Rhodes → Town Hall
train offline.

## Symptom

Offline (bundled or downloaded timetable, no network), every Rhodes → Town
Hall plan changes trains: T9 → T9 → T1 via Central, T9 → T4/T1, or via the M1,
one itinerary taking 99 minutes. In reality the T9 runs Rhodes → Strathfield
→ Central → Town Hall → Wynyard → North Sydney → Gordon without a change.
Online answers come from the TfNSW Trip Planner and are not affected.

## Cause, verified on the bootstrap package on 2026-10-02

The source GTFS splits a through-running train into two trips at Central, and
the package keeps them as unrelated trips:

- Trip `101E.2006.101.124.T.8.90669060` (headsign "Gordon via Lindfield")
  runs Epping → Rhodes → Strathfield → Redfern and ends at Central Platform 16
  at 09:02:00.
- Trip `101F.2006.101.124.T.8.90669062` (T9 "Gordon") starts at Central
  Platform 16 at 09:03:01 and runs on through Town Hall.

The two trips are run 101, with suffixes E and F, on the same service. Nothing in
`internal/native` reads `block_id`, the package's `trips` table has no block
column, and neither offline router knows about staying seated. Staying on the
train is therefore a 61 s change, below the routers' minimum (Android
`OfflineRouter.minimumTransferMillis` is 5 min), so the direct train is
unusable and the router finds other changes.

Scale: in the 30-day bootstrap (`serviceDateFrom 20260905`), about 19,000
same-run continuations within 5 minutes sit at Central's through platforms
(16, 17, 18, 20, 21). Any offline journey that rides through Central is
affected: Northern, Western and Inner West lines to the city and North Shore,
and the reverse. Journeys that end before Central (Rhodes → Redfern) are not.
Same-run matches at Olympic Park, Bondi Junction, Tallawong and Sydenham are
terminal turnbacks, not through-running.

## Consequences

- The owner's offline Rhodes → Town Hall board shows changes that do not exist,
  and arrival estimates follow the wrong itinerary.
- Offline on-board entry (`commute-reliability` rule 5) matches against those
  multi-leg journeys, so a guessed trip on the direct T9 shows a phantom change
  at Central.

## Open before design

- Confirm with a keyed probe that TfNSW's GTFS links the split trips with
  `block_id`, or find what else links them (run number, `trip_id` prefix).
- Mechanism: stitch same-block continuations into one trip when compiling the
  package, so routers and the trip index stay simple but realtime has to map
  two source trip ids; or carry a block column and teach both routers to stay
  seated without a transfer or minimum connection.
- How realtime updates (`internal/native/realtime.go`, native
  `OfflineRealtime`) attach to a stitched trip.

## Related observation

The bundled bootstrap expires `2026-10-04T23:59:59+11:00`. Phones that are
online refresh the timetable automatically. A phone that never comes online
keeps only the bundled package, so the next release should ship a regenerated
bootstrap.
