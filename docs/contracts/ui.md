# Contract: Client experience and visual language

This is the binding UI contract for every client: the web PWA today and the
native Android and iOS ports to come. Platform controls may use native mechanics, but the information hierarchy, honesty
rules and core flows below do not vary by client.

The product should answer the likely journey on open, make correction one tap,
and never present inferred or stale information as observed fact. Precise state
and API semantics live in `client-storage.md` and `api.md`.

## Core flow

- Home is the open state. Its smart header is the zero-tap answer for the
  predicted or focused trip; saved trips sit immediately below it under the
  `MY TRIPS` anchor.
- The smart header is read-only. It is a section, not a tap target: the
  saved-trip row is the affordance, and the header's own trip carries the same
  `DEPARTURES ›` cue as every other row.
- Tapping a saved-trip row opens that trip's departure board. It records the
  explicit selection and never changes the focused journey; browsing therefore
  never replaces the focused train.
- Tapping a board row opens the journey detail view, whose back control reads
  `← <departure station> departures` and returns to that board.
- `Take this train` on journey detail is the only control that focuses a
  journey. It returns home and turns the smart header into directions. There is
  no manual unfocus anywhere, and the board never shows a separate focus strip.
- Journey detail for a journey that is cancelled, or already focused, carries no
  action rail at all; the back control is the way out.
- When a focused journey is over, home may offer the opposite direction. The
  client fetches a real return journey and never reverses the outbound snapshot
  or invents transfer platforms.
- Correction is the ordinary trip choice: the predicted trip is first, every
  saved trip remains visible, and choosing another trip is one tap.

All interactive rows and controls have a tap target of at least 44 logical
pixels. Back navigation is explicit; labels such as `EDIT` or `DONE` are not
substitutes for going back.

## Web runtime and performance

- The web client is a static, dependency-free ES-module PWA with no build
  step. Its JSON API remains reusable by other clients.
- A saved board renders synchronously from `localStorage`; a live response
  replaces it without layout shift. The selected trip refreshes every 30
  seconds while home, board or detail is visible, pauses while the document is
  hidden, and refreshes immediately when visibility returns.
- The experience bar is a service-worker-controlled warm open with cached rows
  painted in under 500ms and a working-network departures response completed in
  under 2s. `tools/measure-open.js` measures both from the page's Performance
  API and fails when either threshold is missed.
- The service worker keeps a versioned cache-first application shell and a
  network-first API cache. An API fallback preserves the response's original
  `generatedAt`; if neither network nor cache can answer, the request rejects
  and the client enters its offline state. `/healthz` is never cached.
- Service-worker registration runs after window load so it cannot delay first
  paint. Every change to a file in `web/sw.js`'s `SHELL` list updates `VERSION`
  in the same change; the shell list must contain every module and icon needed
  to boot offline.

## Smart home

- The smart header uses the same information grammar as a board row, promoted
  through scale and spacing: origin above departure time, destination above
  arrival time, with the journey time axis beneath, carrying the boarding cap
  and the coloured platform markers of every change. Both station names share
  one top edge and both times share one baseline; the arrival clock, the
  smaller of the two, takes a 7px top margin to reach it.
- Station names are never ellipsised. A name that would clip is shortened by
  rule until it fits: `Station` dropped, `Junction` to `Jn`, then leading
  compass words to initials.
- The line above the header answers how far away the origin station is:
  `AT <station>` within 200 m of it, `<distance> TO <station>` beyond,
  `NEXT TRAIN` with no fix. Distances under a kilometre round to 10 m.
- On home open a client whose geolocation permission is already granted takes
  one fix without prompting. It never prompts on open, the fix is not
  persisted, and it never leaves the device.
- When a journey is focused, that line is its status instead: `RUNNING`,
  `RUNNING LATE`, `CANCELLED` or `TRIP OVER`. The same string appears in the
  focused saved-trip row. The status describes the train; no copy claims the
  rider is aboard it.
- `RUNNING LATE` requires all three of: fresh data, neither stale nor offline;
  a realtime estimated departure on the relevant leg; and a positive difference
  between the printed clock minutes of that estimate and its schedule. The
  relevant leg is leg 0 before departure and while riding it, and leg *i+1*
  while dwelling before or riding it. `CANCELLED` and `TRIP OVER` outrank late.
  Otherwise the status is `RUNNING`.
- `RUNNING LATE` and `CANCELLED` are in the warning colour, and a late journey
  paints its large countdown in the warning colour too. `LIVE` is a separate
  fact about the data and keeps the live colour however late the journey is.
- A focused journey cancelled before it departs shows the next running service
  from the live board, under the instruction
  `<cancelled time> CANCELLED · NEXT TRAIN` and the status `CANCELLED`. A
  cancellation after the journey is under way keeps the focused journey on
  screen with its warning copy.
- The header may fetch live data only for the selected trip. Saved-trip rows
  use device-held facts such as line identity, distance and last ride; opening
  home must not fan out one upstream request per saved trip.
- Saved-trip rows are 72px with a `DEPARTURES ›` cue at the right, which the
  sub line reserves 106px for. The sub line is the status on the focused row,
  `SHOWN ABOVE` and the distance on the header's own unfocused trip, and the
  distance with the last ride on every other. Rows carry both stacked
  line-colour rules and coloured line-code badges. The web list is capped by
  the storage contract's ten-trip LRU.
- A receipt explains a prediction only when the app made a meaningful leap.
  It names real evidence. A manually focused trip needs no receipt.
- Copy about the train is always safe. Copy about the person requires evidence
  supplied by their action or persisted ride record. App opens are looks, not
  rides: a receipt drawn from view history says the user checks a trip
  (`You check this trip most weekday mornings.`, `You often check this trip
  around now.`), never that they ride it. Only a persisted ride supports the
  reverse-direction receipt.
- Location permission is requested contextually, never on first load. Missing
  or denied location degrades silently to device history and time.

## Setup and station search

- With no saved trips, setup collects origin and destination, saves the pair,
  and returns home. Add-trip uses the same search flow.
- The client sends no station query before three normalized characters. Search
  answers are memoized by trimmed, whitespace-normalized, case-insensitive
  query for the browser session; failures are not memoized.
- Pending search says `Searching…`. An empty answer at four characters or fewer
  says `No match yet · keep typing`; a longer empty answer says
  `No stations match`. A failed call says `Station search is unavailable`.
- A board with no cached answer says `Getting the next trains…` while the first
  request is pending.

## Departure board

- The board is a timeline anchored at now. It opens at the anchor, never in the
  past, and scrolling upward reveals earlier departures. There is no labelled
  scroll affordance (`EARLIER`, `NOW`), and no reverse control anywhere in the
  client: the smart header offers the return direction itself once a focused
  trip is over. The anchor reads `NOW · HH:MM`.
- Rows rank by effective departure. Past and future rows use the same grammar
  and equal height; past rows are distinguished through type colour, not
  container opacity.
- A row is 96px in a 72px figure column and a body column 14px to its right,
  inside 22px page sides; the sides narrow to 18px at ≤375px, and at ≥900px the
  measure opens to 64px sides, a 120px figure column and a 24px gap. The row's
  1px rule is drawn edge to edge of the row rather than inset. The figure is
  45px, right aligned in its column and vertically centred on the row, its
  `min` unit at 0.21em, with a 9px uppercase provenance beneath it; a figure
  too wide for the column drops to 31px. The departure time is 18px, a struck
  scheduled time 13px, the arrival 16px in secondary ink at the right. Beneath
  them sit the 22px journey line — boarding cap, time axis, platform pins — and
  the 13px headsign line.
- Row height is fixed. The board uses the dynamic viewport, its rows scroll
  when the frame is too short for them, and its footer keeps a separate line
  outside the scroller. A sparse board leaves the space under its last row
  empty rather than distributing rows through it. When six services are
  returned, all six remain whole and reachable at 390×844 and 412×732.
- Every change on a journey names the station it happens at beneath the
  platform pin the rider boards from, so where to change and which platform to
  go to are both readable without opening detail. On a two-change row the
  second station label left-aligns and the second change's alighting pin is
  hidden.
- A tight change paints the dwell segment of the journey axis in the warning
  colour, and nothing else: never a ride segment, and never on a cancelled row.
  The row does not name the window; journey detail does.
- Our own copy is never ellipsised. An upstream headsign may be, but only once
  it has used the whole row.
- A cancelled row dims its figure, times and headsign to label ink, strikes
  both the departure and the arrival, appends `CANCELLED` to the arrival and
  fades its journey device.
- One general row area communicates minutes or elapsed time, platform and line
  colour. Departure station/time and arrival station/time each read as a
  scanning group. Every number earns its place and states its provenance.
- Board rows omit line codes; colour and headsign carry line identity. Line
  codes remain available on home and journey detail.
- Every board state reserves the same three-line figure/provenance structure so
  countdown, delay, cancellation and scheduled-only changes do not reflow rows.
  Home and journey detail are exempt from the three-line constraint.
- Countdown and delay arithmetic compares the clock minutes printed beside the
  figure, not elapsed milliseconds. A service reads `Now` for its whole
  departure minute and uses `DEPARTING` beneath it unless a more specific state
  applies. Figures beyond 99 minutes use rounded hours with a smaller `H` on
  the numeral's baseline.
- A departed service dissolves before the timeline closes upward. Reduced
  motion removes the transition; state variants otherwise preserve row
  geometry.
- The board closes with `— SIX SERVICES SHOWN` when six services are returned
  and `— END OF BOARD` otherwise; a board of three or fewer adds
  `Nothing scheduled after HH:MM.`

## Past, stale and exceptional data

- A past actuals row may show elapsed time with `AGO`, actual clock times and a
  delay. A timetable-only past row shows scheduled clock time and `TIMETABLE
  ONLY`; it shows no elapsed figure, coral warning or punctuality claim.
- Whether a past row has actuals is decided by its realtime data, never by its
  age or position. Where a live response and past page duplicate a service, the
  live response wins.
- No past row shows a departure countdown.
- Stale or offline future data drops countdown figures, removes already
  departed rows, uses absolute clock times, and states
  `OFFLINE · LAST UPDATED X AGO`. A cached countdown is not presented as live.
- Scheduled-only numerals are visually quieter and labelled `SCHEDULED`.
- Delays show both the scheduled and effective time, and paint the figure and
  the effective departure in the warning colour. Cancellation remains
  visible and a cancelled lead names the next train rather than disappearing:
  `<cancelled time> CANCELLED · NEXT TRAIN`.
- There is no `ON TIME` label. The closed provenance vocabulary is `MIN`,
  `DEPARTING`, `SCHEDULED`, `CANCELLED`, `n MIN LATE`, `AGO`, `TIMETABLE ONLY`,
  `TO CHANGE` and `TO GO`. `CANCELLED` and `n MIN LATE` are in the warning
  colour, because each names an exception. An ordinary live board countdown
  leaves the provenance label empty because `min` is already on its numeral;
  other labels appear only when they change the figure's interpretation.
- A response is fully stale when its `generatedAt` age exceeds 90 seconds, or
  when a live request fails. `X-Data-Stale: true` alone only
  removes the confident live-dot treatment; recent data may still count down.
- A board that has never loaded has no update age. Its footer is empty while a
  request is pending and says only `OFFLINE` if the request fails.

## Journey detail, time axis and directions

- The masthead carries the back control `← <departure station> departures`, the
  kicker `JOURNEY`, the title `<from> → <to>`, and a summary 18px above the
  heavy rule: `1 change · arrives 10:08`, `Direct · arrives 23:36`, or, when
  the journey is cancelled, `The 09:58 from Town Hall is cancelled.` in the
  warning colour, naming the cancelled leg's departure time and station. The
  summary states no journey duration, because a delay that leaves the arrival
  alone would make the journey read as faster.
- Under the rule the chosen board row is promoted intact at 100px, in the same
  grammar and the same figure column it had on the board. It is not a tap
  target. A cancelled journey's promoted row keeps the board's cancelled
  treatment.
- The journey then reads as steps in travel order: a board step, one step per
  change, an arrive step. Steps are 72px, change steps 82px with a heavy rule
  above and below. Each states a time, a station and a platform chip in its
  line's colour with a label — `BOARD <code> · <headsign>`, then `GET OFF` and
  `BOARD` across a change's two chips, then `ARRIVE`, which becomes
  `ARRIVE · JOURNEY CANCELLED` when the final leg is cancelled.
- Every service leg names its line code and headsign. A cancelled leg stays in
  place and marks the journey broken; the client does not invent or substitute
  a replacement service absent from the API response. The final arrival is
  struck only when the final leg is cancelled.
- Transfer waits are computed from each leg's effective times after flooring
  both sides to the displayed clock minute. The wait therefore agrees with the
  two clock times printed beside it.
- A transfer under five minutes is tight even when it was scheduled that way.
  A tight change prints its current window as `N MIN CHANGE` in the warning
  colour on the step's time and label, and prints no other window; the earlier
  arrival is not struck. A cancelled connection is broken rather than tight:
  its step reads `CANCELLED`, dims, and strikes its time and station. Only the
  transfer warning uses the warning colour; the journey's arrival figure does
  not.
- The screen closes with a heavy rule and the tail — effective arrival time,
  destination and arrival platform — or `JOURNEY CANCELLED` in the warning
  colour with the time struck. Beneath the tail is the freshness line, and
  beneath that the 66px action rail `Take this train`, which shares its
  geometry with home's `New trip` rail.
- Once the journey has departed, the promoted row's figure and provenance are
  the directions ladder's, `TO CHANGE` or `TO GO`, and the steps the rider is
  past take the quiet done treatment: secondary ink, no strike. There are no
  per-leg countdowns. Stale detail keeps absolute clock times but removes live
  countdown figures.
- The journey bar is a percentage time axis: departure is 0%, arrival is 100%,
  and each ride and transfer segment uses its true share of total journey time,
  measured from effective times. There is no minimum visual transfer width.
- A transfer gap is bracketed by the alighting platform numeral in the first
  leg's colour and the boarding platform numeral in the next leg's colour.
  Platform markers overlay the axis and do not consume its width.
- Directions count to the next required action and use `TO CHANGE` or `TO GO`.
  The instruction line names the station and platform of that action: while
  riding, `Get off at <station> · Platform <n>`; while dwelling at a change,
  `Change at <station> · Platform <n>`. The platform clause is omitted when
  upstream gives none. The boarding-platform cap disappears after boarding.
- The progress marker moves continuously from timetable and live estimates. It
  is an inference from time, never a claim of continuous location tracking.

## Visual language

The interface reads as a printed timetable: one column measure, one type-scale
ladder, a heavy masthead rule, hairline row rules, system fonts and tabular
figures. Labels use one letterspaced uppercase idiom. There are no cards within
cards, ornamental chrome or happy-path spinners.

Dark is the primary scheme; light is a warm-paper printing of the same contrast
hierarchy, not a colour inversion.

| role | dark | light |
|---|---|---|
| ground | `#0A0B0D` | `#FAF9F5` |
| primary ink | `#F4F5F7` | `#14120E` |
| secondary ink | 66% primary ink | `#4E4C48` |
| label ink | 46% primary ink | `#706E6A` |
| hairline | 10% primary ink | 11% primary ink |
| strong hairline | 20% primary ink | 25% primary ink |
| warning | `#FF7A5C` | `#BF3418` |
| live | `#4ADE80` | `#0F7A4A` |

Line colour belongs to the service and appears as a first-class device once per
service. Multi-leg bars split by leg and transfer duration. Implementations use
the line palette defined in `web/app.css` (the reference; native ports
generate theirs from the same values); new line codes must update every
client's mapping and its tests in the same change.

Line colour has two roles. Every filled device — the boarding cap, the platform
pins, the saved-trip badges and spine bars, the journey-detail chips and the
axis ride segments — paints `--line-fill-<code>`; every bare use of line colour
as text paints `--line-<code>`. In the dark scheme the two are equal. In light
only T1 and BMT differ: the fill is the official `#F99D1C` under paper `#FAF9F5`
type, while the same codes as bare text keep the readable `#A46204`. Paper on
that yellow measures 2.02:1 against the binding 3:1 rule for filled devices.
The owner's verdict of 2026-09-03 accepts that exception for TfNSW line
identity: the yellow may only ever be darkened by an imperceptible amount and
never returned to a brown fill, and the regression test asserts the exact pair
rather than a ratio. Text on any other fill is at least 14px/700 and meets 3:1.

Platform numerals on a line-colour chip are paper in the light scheme, on every
line: paper reads better than ink on all fourteen light-scheme line colours and
is the only value that clears 3:1 on T4 and HUN. The dark scheme knocks them
out per line colour, where ink is the readable value on T4, T5, T9, CCN and HUN
and paper is on the rest.

## Calibration and verification

The authoritative comps live at `assets/comps/latest/`. It always holds the
current calibration exemplars and nothing else; when an owner verdict
replaces a screen's design, the new exemplar frames replace the old ones in
the same change as this contract, and git keeps the history. Every frame in it
is a `tools/shoot-states.js` shot of the built client, so a frame no state can
produce is removed rather than left to rot.

The set is thirty frames:

- Board: `board-390x844-hero.png` plus its `past`, `delayed`, `cancelled`,
  `long`, `two-change` and `hero-light` variants, and `board-412x732-hero.png`.
  `two-change` is the two-transfer row grammar.
- Journey detail: `detail-390x844-hero.png` plus its `tight`, `cancelled`,
  `direct`, `long`, `departed`, `focused` and `hero-light` variants, and
  `detail-412x732-hero.png` with its `tight`, `cancelled` and `long` variants.
  `departed` is the post-departure promoted row under `TO CHANGE`; `focused` is
  the already-focused journey, which carries no action rail.
- Smart home and directions: `home-390x844-before.png` plus `change`, `final`,
  `tight`, `cxl`, `focused-cxl`, `late`, `back` and `before-light`, and
  `home-412x732-change.png`. `tight` is a late unfocused lead, `cxl` the
  unfocused cancelled lead, `focused-cxl` a focused journey cancelled before it
  departs, `late` the `RUNNING LATE` treatment, and `back` the return direction
  with its real transfer platforms after the offer is accepted.

Measurements these frames carry deliberately, so nothing above reads as drift:
the two header clocks share a baseline to within 1px, which is the tolerance
the instrument allows; a focused journey still shows its boarding cap and
pre-departure progress marker before it leaves, so `home-390x844-focused-cxl`
carries both; `detail-*-tight` shoots a change shortened by a late first leg,
so its promoted row reads `5 MIN LATE`. One defect is visible and open, not
accepted: on `board-390x844-past` the provenance `TIMETABLE ONLY` overflows the
72px figure column by 24px, which the sweep prints as a `NOTE` pending an owner
ruling on the column or the word.

Client markup carries the data attributes the comps harness probes, so the
instrument measures the built screen with the probes that judged its comps.

Visual changes are compared side-by-side with the relevant calibration asset
and verified in the real client. Use `tools/shoot-states.js` for web geometry
and flows; a native port must ship an equivalent seeded-state shooter before
its first verdict (PROJECT.md, "Native clients"). A design change requires
new divergent comps and an owner verdict before product implementation
(`tools/comps/`). That harness's acceptance oracle reproduces the archived
board v2 exemplar set as pinned in git at `b218dd5`, pixel-identically: it
gates the harness, not the frames listed above, which are shot from the client.
Update this contract when an owner verdict changes current behavior.
