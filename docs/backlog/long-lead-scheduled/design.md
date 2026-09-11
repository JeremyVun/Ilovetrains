# Scheduled register beyond the live horizon

Status: design complete 2026-09-11, build plan in `build_plan.md`.

## Owner request

2026-09-11, reading the analytics dashboard's `feed_prediction_scored`
breakdown by `lead.error`: "fair call to add scheduled for 40+ minutes".

Ruling the same day on delays that far out: keep delays and cancellations.
Past 40 minutes an on-time live row renders as `SCHEDULED`; a row the feed
says is late still shows `N MIN LATE` with the struck scheduled time, and a
cancellation always shows. Hiding a real delay costs a rider more than
showing one that later evaporates.

## Problem

A board row with a realtime estimate paints its numerals in the confident
live register whatever its lead. The server's own accuracy tracker
(`internal/native/accuracy.go`, contract in
[analytics.md](../../contracts/analytics.md#server-accuracy-events)) shows
that confidence is not earned far out. Production, 24 hours to
2026-09-11 21:16, predictions off by more than one printed minute:

| Countdown showed | Right to the minute | Off by more than a minute |
| --- | --- | --- |
| 0 to 2 min | 8,179 | below the dashboard's visible floor |
| 2 to 5 min | 7,925 | about 3% |
| 5 to 10 min | 7,194 | about 7% |
| 20 to 40 min | 4,934 | about 5% or more |
| 40 to 90 min | 7,021 | about 12% |

Nearly every miss is "late by 1 to 5 minutes"; no early bucket at any lead
reached the dashboard's top rows. So inside 40 minutes the live register is
honest. Beyond it, one prediction in eight moves, and the row should look
like what it is: a timetable time the feed has not yet contradicted.

The 40 minute edge is the accuracy tracker's own bucket edge
(`leadBounds` in `accuracy.go`: a lead is in `40-90m` when it exceeds 40
minutes), so the dashboard keeps measuring the rule's two sides separately.

## Rule

A future row is **beyond the live horizon** when all of:

- its first leg has a departure estimate (`departure.estimated` non-null
  on web; `legs.first().estimatedDeparture` non-null on native, not
  `journey.realtime`, which is true for an estimate on any leg's arrival
  too), and it is not stale, offline or retained (those already render
  scheduled);
- it is not cancelled;
- its printed delay is exactly zero: `floor(estimated/60000) −
  floor(scheduled/60000) == 0`, the same arithmetic the `N MIN LATE` label
  uses;
- its countdown figure is more than 40 printed minutes: `mins > 40`, where
  `mins` is the value the figure already prints. A row at exactly 40 stays
  live; 41 is beyond.

A row beyond the horizon takes the `SCHEDULED` label and the quieter
scheduled numeral register. Nothing numeric changes: with a printed delay
of zero the estimated and scheduled departures print the same minute, so
the figure, the departure clock and the arrival clock are what they were.
Everything else about the row is unchanged too, including its three-line
body, position, key, colour stem and the journey it opens on tap.

The rule therefore changes exactly one visible thing, already in the
visual language: an on-time far-out row is labelled and weighted as
scheduled. The closed provenance vocabulary in [ui.md](../../contracts/ui.md)
is unchanged.

Rows the rule leaves alone at any lead: cancelled (`—`, `CANCELLED`),
delayed (`N MIN LATE`, struck scheduled time, warning colour), past rows
(`AGO`), anything already scheduled-only, and rows whose estimate is
*earlier* than schedule, which keep today's presentation: live register,
the earlier clock, no label. The accuracy counters score the feed's
predictions against its own final estimate, never against the timetable,
so they say nothing about how often or how far a service leaves early;
there is no evidence on which to hide an early estimate (debate,
2026-09-11).

## Where it applies

The rule lives in each client's single row-presentation seam so every
surface that reads the row agrees:

- web: `journeyRow` in `web/js/rowmodel.js`, which feeds the board and the
  journey detail's promoted row. The smart header builds its own figure in
  `web/js/focus.js` and is not touched.
- Android: `figureFor` in `UiCommon.kt` decides the label, and `UiBoard.kt`
  decides the numeral colour from `journey.realtime` separately. Both must
  read one predicate. `figureFor` also serves the smart header (`UiHome.kt`)
  and the next-service rail (`nextServiceFigure` in `UiPresentation.kt`);
  they read only its value and unit, which the rule never changes, and the
  header strips `Scheduled`, so both are untouched by construction. A
  builder who finds the rule needing to change a figure's value or unit
  has left the design.
- iOS: `figureFor` in `UI/Common.swift` and `figureColor` in
  `BoardView.swift`, likewise; `HomeView.swift` reads value and unit and
  strips `scheduled`.

Native boards routed offline from the bundled timetable and shared
snapshots carry `journey.realtime` too, so the same predicate covers them;
that is why the rule is client-side rather than the server nulling
`estimated` beyond 40 minutes, which would have left the native offline
path live and changed the API's meaning of `estimated` ("realtime
controlled") into "realtime controlled and near".

`mins` is measured against the client clock, so a row crosses the horizon
at the refresh where it drops to 40. It changes register in place; the
three-line invariant means no reflow, and no transition is animated.

## Cross-client conformance

`tools/fixtures/conformance/rows.json` is the shared oracle
(`tools/export-android-conformance.mjs` regenerates it from the web
implementation; the Android JVM test and the iOS XCTest read the same
file). The existing `rounded hour figure` case (offset 100, realtime, no
delay) changes expectation from `''` to `SCHEDULED`; that is the rule
working, not a regression. New cases pin both sides of the edge and the
exceptions: 40 min live, 41 min live on time, 41 min late, an early
estimate whose live countdown is 41 (scheduled 43, estimate −2) staying
live, and 41 min cancelled.

A journey whose first leg has no departure estimate but a later leg is
live is a pre-existing divergence: web labels it `SCHEDULED` because the
departure the rider acts on is timetable-only, Android and iOS paint it
live because `journey.realtime` is true for any leg. Owner ruling
2026-09-11: keep the divergence and record it in
[android-deviations.md](../../contracts/android-deviations.md) and
[ios-deviations.md](../../contracts/ios-deviations.md). It therefore does
not enter the shared oracle; each native client pins with its own unit
test that the horizon predicate reads the first leg's departure estimate
and leaves such a row exactly as it is today.

## Not in scope

- The smart header's figure, the next-service rail, journey detail's leg
  times, the travel tracker and transfer windows keep reading live
  estimates. The header never shows `SCHEDULED`; the rest are about a
  journey the rider chose, not a board of candidates.
- No per-source, per-mode or per-line horizon. One number, from the
  tracker's bucket edge.
- No server change, no new label, no correction of the feed's times, no
  feature flag.

## Rejected

- Scheduled for everything except cancellations beyond 40 minutes: a
  10 minute delay on a train 45 minutes out would be invisible and then
  appear at 40. Owner ruling 2026-09-11, above.
- Server-side nulling of `estimated` beyond the horizon: see "Where it
  applies".
- Substituting scheduled clock times for an early estimate beyond the
  horizon: it would change figure values, which the native smart header and
  next-service rail share through `figureFor`, and the accuracy counters
  give no schedule-relative evidence to justify it. Debate, 2026-09-11.
- A per-line, per-time-of-day correction model: needs server history,
  which the stateless rule forbids, against a feed already 92% right to
  the minute.

## Comps

None. The rule reuses the existing scheduled register and label with no
new look. Build evidence is before/after frames of a board holding a
41-minute on-time row and a 41-minute late row on each platform.
