# Contract: Client experience and visual language

This is the binding UI contract for every client: the web PWA today and the
native Android and iOS apps. Platform controls may use native mechanics, but the information hierarchy, honesty
rules and core flows below do not vary by client.

The product should answer the likely journey on open, make correction one tap,
and never present inferred or stale information as observed fact. Precise state
and API semantics live in `client-storage.md` and `api.md`.

## Core flow

- Home is the open state. Its smart header is the zero-tap answer for the
  predicted or focused trip; saved trips sit immediately below it under the
  `MY TRIPS` anchor. The saved list ends with `— End of trips`.
- The smart header is a section, not a single tap target: the
  saved-trip row is the affordance, and the header's own trip carries the same
  `DEPARTURES ›` cue as every other row. A journey the app inferred rather than
  the user chose carries one control below the heavy rule. While the
  `strip-placement` experiment runs, variant A2 places that same control in
  the receipt slot. An empty answer caused by service preferences also links
  to Settings. Before departure, a separate 44px next-service rail opens the
  following journey's detail. The `Pinned` label is a 44px-high button that
  unpins the service; other header content remains read-only.
- Tapping a saved-trip row opens that trip's departure board. It records the
  explicit selection and never changes the focused journey; browsing therefore
  never replaces the focused train.
- Tapping a board row opens the journey detail view, whose back control reads
  `← <departure station> departures` and returns to that board.
- `Pin this train` on journey detail is the only control that focuses a
  journey. It returns home and pins that service in the smart header;
  directions begin when it departs. Tapping `Pinned` on home or `Unpin this
  train` in detail clears the explicit pin and returns to the ordinary home
  answer for that trip. The board never shows a separate focus strip.
- An explicitly pinned journey has an `Unpin this train` (or ferry) action
  rail, including when cancelled. Other cancelled or inferred journeys carry
  no action rail; the back control is the way out.
- When a focused journey is over, home may offer the opposite direction. The
  client fetches a real return journey and never reverses the outbound snapshot
  or invents transfer platforms.
- Correction is the ordinary trip choice: the predicted eligible trip is first,
  and choosing another compatible saved trip is one tap.
- `Change destination` is the correction for an inferred journey. It reopens
  the new-trip sheet with From filled from that journey's origin and the
  destination field focused; saving re-enters travel mode on the same departure
  when a journey toward the new destination matches, and opens that pair's
  board when none does. Browsing another trip still never exits travel mode.

All interactive rows and controls have a tap target of at least 44 logical
pixels. Back navigation is explicit; labels such as `EDIT` or `DONE` are not
substitutes for going back.

## Tiny train preview

Web/PWA, Android and iOS share an off-by-default Easter egg. Production is
gated by the evaluated public flag `tiny_train`, read from the one flags request
each client already makes per open, foreground return and 30-second refresh
tick, so the toy appears and disappears within a tick of the flag flipping.
On a local development server only, the browser opts in with `/?tinyTrain=1`
and out with `/?tinyTrain=0`; persistence is defined in
[client-storage.md](client-storage.md#local-preview-flags).

On Home, activating the coloured trip line beneath the station names sends a
tiny double-decker along it. Each pass has six carriages; further taps during
a pass are ignored. The drawing has a yellow nose, two rows of windows and warm windows in dark appearance. It is silent and never starts
automatically. A pass lasts about 2.6 seconds. Reduced motion shows a stationary
train for 650ms instead.

The trip line has an accessible “Run a tiny train” button with a 44-point tap
target. Web also supports Enter and Space with a visible focus indicator. It
preserves surrounding layout and leaves departure information and journey actions unobstructed. The train runs on the
existing line without moving it or the divider. Platform labels and the journey
progress marker paint above the animation. Scrolling My trips leaves the fixed
header control in place. No game state is saved, and no event is sent.
Home redraws move the passing train onto the freshly rendered trip line, keeping
platform and route data current. Leaving Home, backgrounding the client or
disabling the flag ends it. A header without a journey has no toy control.
When the flag is off, the trip line remains unchanged and does no animation work.

## Web runtime and performance

- The web client is a static, dependency-free ES-module PWA with no build
  step. Its JSON API remains reusable by other clients.
- A saved board renders synchronously from `localStorage`; a live response
  replaces it without layout shift. The selected trip refreshes every 30
  seconds while home, board or detail is visible, pauses while the document is
  hidden, and refreshes immediately when visibility returns.
- The one-second tick rewrites a view only when that view's markup has changed;
  the freshness age is patched in place on its own node. A scroll in progress, a
  selection and keyboard focus therefore survive every tick.
- The experience bar is a service-worker-controlled warm open with cached rows
  painted in under 500ms and a working-network departures response completed in
  under 2s. `tools/measure-open.js` measures both from the page's Performance
  API and fails when either threshold is missed.
- The service worker keeps a versioned cache-first application shell and a
  network-first API cache. An API fallback preserves the response's original
  `generatedAt`; if neither network nor cache can answer, the request rejects
  and the client enters its offline state. `/healthz` is never cached.
- Installing a new shell reloads every precache request from the network;
  it must not reuse old bytes from the browser's HTTP cache. A new cache name
  alone does not prove that a returning browser received the new code.
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
- The header is content-sized rather than centred in a reserved box, so a
  receipt appearing pushes the heavy rule down instead of taking up slack. The
  band above it is the device's top inset with a 14px floor, which is the
  screen's only notch clearance. Its rhythm is 20px above the figure row, 12px
  to the journey device and to a receipt, 8px above the instruction line and
  12px below the block to the rule.
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
  focused saved-trip row. An explicitly pinned service adds a pin icon and
  `PINNED` in the header, and `PINNED` in the row. Before departure, an ordinary
  `RUNNING` status is replaced by `PINNED`; late, cancelled and completed
  statuses retain their words. Inferred travel never gets a pin indicator.
  A cancellation replacement is not labelled as the pinned service.
  The header pin indicator releases the pin when tapped; the saved-row label
  is read-only. No copy claims the rider is aboard. The status line keeps
  identical height with and without the icon; the trip grid starts 14px below
  the status band.
- `RUNNING LATE` requires all three of: fresh data, neither stale nor offline;
  a realtime estimated departure on the relevant leg; and a positive difference
  between the printed clock minutes of that estimate and its schedule. The
  relevant leg is leg 0 before departure and while riding it, and leg *i+1*
  while dwelling before or riding it. `CANCELLED` and `TRIP OVER` outrank late.
  A degraded server response still within the freshness window retains this
  status and its countdown, with the degraded freshness indication. Retained
  journey evidence cannot borrow a newer board's freshness. Otherwise the
  status is `RUNNING`.
- `RUNNING LATE` and `CANCELLED` are in the warning colour, and a late journey
  paints its large countdown in the warning colour too. `LIVE` is a separate
  fact about the data and keeps the live colour however late the journey is.
- A focused journey cancelled before it departs shows the next running service
  from the live board, under the instruction
  `<cancelled time> CANCELLED · NEXT TRAIN` and the status `CANCELLED`, and so
  does a journey whose first leg is cancelled while it is being ridden. When a
  LATER leg is cancelled after departure the focused journey stays on screen:
  the figure keeps counting to the next action, and the instruction names the
  leg that was lost rather than the one that left —
  `<HH:MM> FROM <STATION> CANCELLED`, its departure clock time and its
  boarding station. Recovery from a cancelled leg belongs to the smart header;
  cancelled journey detail carries no recovery control (owner ruling
  2026-09-03).
- The smart header omits `SCHEDULED` and realtime-source labels. Its status
  row collapses completely when empty; meaningful delay and travel labels
  (`N MIN LATE`, `TO CHANGE`, `TO GO`, `AGO`) keep their existing spacing.
- While the first board loads the header prints no provenance. The slot is
  empty rather than carrying a claim about data that has not arrived; the
  instruction line says `Getting the next trains…`, or
  `No saved board for this trip yet` with nothing cached and no network.
- A tight change still ahead paints the header's dwell segment in the warning
  colour in every phase, including before the train has left. The paint alone
  carries the warning there: the instruction line stays the headsign before
  departure, and becomes `Tight change · <n> min · Platform <n>` only once the
  journey is under way, with the receipt `Printed change was <n> min.` when the
  window has shrunk below what was printed.
- Before departure, a 44px rail below the main answer and above the heavy rule
  shows the next distinct service: countdown, departure time, arrival time and
  a detail chevron. Its label uses the first leg's mode: `Next train`,
  `Next metro`, `Next ferry`, or `Next service` if unknown. The arrival time
  matters because a later departure need not arrive equally late.
- The next-service candidate is the earliest later effective departure on the
  displayed pair and direction, with every leg enabled and none cancelled.
  Exclude alternate itineraries sharing the lead's first line and scheduled
  departure. Keep its countdown visible for stale and offline data, using the
  candidate's own times and source freshness indication. No candidate means no rail, not a claim
  that no later service exists. The rail disappears once the lead departs.
  Opening its detail never pins it; the detail action performs the pin.
  The detail's first paint retains the tapped rail's response and freshness;
  an older cache must not replace that source during navigation.
- The header may fetch live data only for the selected trip. Saved-trip rows
  use device-held facts such as line identity, distance and last ride; opening
  home must not fan out one upstream request per saved trip.
- An inferred journey puts one line between the heavy rule and `MY TRIPS`:
  `Going somewhere else?` at the left in the offer-paragraph type, `CHANGE` at
  the right in the offer-button idiom, a hairline below it, 49px tall with a
  44px tap target. It appears in inferred travel mode only — never above a
  journey the user chose, and never outside travel mode.
- During `strip-placement`, A2 moves that same question and CHANGE action
  into the receipt slot and removes the line below the rule. The question
  stays on one line, ellipsising only if necessary; CHANGE keeps its full
  44px tap target. The receipt adds height to the content-sized header.
  Copy and action behavior are identical in both variants.
- Saved-trip rows are 72px with a `DEPARTURES ›` cue at the right, which the
  sub line reserves 106px for. Names use 19px type; an overflowing paired
  name fits down in 0.25px steps to a 16px floor. If the complete pair still
  cannot fit, it wraps at that floor and the row expands only as needed;
  names are never truncated or made smaller. The sub line is the status on the focused row,
  `SHOWN ABOVE` and the distance on the header's own unfocused trip, and the
  distance with the last ride on every other. On the one open where the app
  itself saved the trip it is showing, that row's sub line reads `Just added`
  in 12px italic in place of `SHOWN ABOVE`, with the distance beside it as
  usual; the mark is gone by the next open. Rows carry both stacked
  line-colour rules and coloured line-code badges for known lines, in journey
  order. With no known lines, show names and the arrow without an invented
  badge or colour rule; retain the empty line-column space so names align
  with other saved trips. The web list is capped by
  the storage contract's ten-trip LRU. Other-row metadata may ellipsise inside
  the remaining track; station names and the `Just added` mark with its
  distance must fit.
- A receipt explains a prediction only when the app made a meaningful leap.
  It names real evidence. A manually focused trip needs no receipt.
- A trip chosen because it ends where the phone's days start carries
  `Your days usually start at <home>.` once three or more daily first-open
  votes agree, and `You usually travel from <home>.` when home is only the
  first saved trip's origin. A trip chosen because it is the usual one from
  where the user is carries no receipt: it explains itself. Nothing offers to
  move home; the votes re-infer it silently.
- The view-history receipt appears only when all of: the shown trip was
  predicted rather than tapped or focused; at least two trips are saved; there
  is no location fix; and the shown (trip, direction) has at least three
  history events the predictor itself counts — same day type as now and within
  two hours of this hour. `You check this trip most weekday mornings.` further
  requires now to be a weekday before 12:00 and those events to fall on at
  least three distinct days; otherwise the receipt reads `You often check this
  trip around now.`. Failing the evidence, the header carries no receipt.
- Copy about the train is always safe. Copy about the person requires evidence
  supplied by their action or persisted ride record. App opens are looks, not
  rides: a receipt drawn from view history says the user checks a trip
  (`You check this trip most weekday mornings.`, `You often check this trip
  around now.`), never that they ride it. Only a persisted ride supports the
  reverse-direction receipt.
- `Train` is the generic word for any service, metro included (`Next train`,
  `Pin this train`, `Getting the next trains…`). The word `metro` appears only
  where the distinction changes what the rider does: the setup sheet's mode
  label under a station, the next-service rail, and a change between modes
  in journey detail. Line colour and headsign carry the rest.
- Ferry-first journeys use `ferry` where journey-specific copy uses `train`:
  `Next ferry`, `Pin this ferry`, and `<time> cancelled · next ferry`.
  Loading and no-journey states remain generic: `Getting the next trains…`.
  Train and metro legs call their boarding place `Platform`; ferry legs call
  it `Wharf`. A transfer uses the word for the leg being boarded. The client
  adds that word only when the upstream value needs it. Complete names and
  side-only values remain verbatim: `Wharf 3, Side A`, `Balmain Wharf`, and
  `Side A`, never `Wharf Balmain Wharf` or `Wharf Side A`. These full values
  remain intact in directions and accessibility text. The initial ferry cap
  uses the full numbered or side label, such as `Wharf 4, Side A`. When the
  supplied place has no public number or side, its cap says `Wharf`; it never
  repeats the stop name or invents `Wharf 1`.
  Transfer chips use the train platform grammar with the side joined to the
  number: `5B` and `2B`. A side-only value uses its side (`B`); a named value
  with no number or side uses an em dash. Both sides retain their full raw
  labels and stop associations in accessibility text, and journey detail
  repeats the full boarding label in its secondary direction. Unknown
  boarding places remain unknown; never infer a numbered wharf from the
  origin name or use a transfer's wharf as the journey origin.
- Location permission is requested contextually, never on first load. Native
  setup requests it after “Use my location” is tapped, with the explicit-action
  feedback below. Missing or denied location on Home degrades silently to device
  history and time.
- The panel that asks for location appears only once the permission state is
  known to be askable; a denied or granted permission never shows it, and it
  never flashes before the query answers.
- While the first board for the selected trip is still in the post, the
  freshness pill is empty with its resting dot, as on the board; `OFFLINE`
  appears only once a request has failed. `Not now`
  is remembered: the panel stays away for 30 days across reloads, and a
  permission the browser already reports as `granted` or `denied` suppresses
  it entirely.

## Setup and station search

- With no saved trips, setup collects origin and destination, saves the pair,
  and returns home. Add-trip uses the same search flow. The sheet carries no
  lede: the two fields say what it is for.
- From may arrive filled — from an inferred journey's origin, or from a fix on
  the first run when the permission is already granted — with the destination
  field focused. A filled From stays editable, and the destination results
  before any query are then the saved and recent destinations from that origin,
  newest first, under `YOU SEARCHED BEFORE`.
- On web, the From results before any query carry one location row, and nothing
  prompts on load. While the permission is still askable and there is no fix,
  it is `Use my location`, which asks once when tapped and disappears silently
  if the answer is no or names no station. Once a fix exists and From is empty,
  it is a `NEAREST STATION` group holding the single nearest station.
- Native setup keeps “Use my location” available whenever From is empty and
  its query is blank, including with an existing permission or disabled app
  location preference. An explicit tap enables the preference if needed, asks
  for foreground permission only if undecided, and shows “Finding your location…”
  in the existing Nearby group. The keyboard closes during the lookup and for
  nearby choices, leaving the results visible; successful autofill opens it on To.
  Repeated taps cannot start duplicate requests.
- A fresh fix (at most five minutes old, never future-dated) selects the nearest
  station supporting an enabled mode only when reported accuracy is valid and
  at most 200 m, the station is within 2 km, and the next eligible station is
  farther away by more than twice the accuracy radius. From fills and To gains
  keyboard focus. It stays editable and needs no confirmation tap. This applies
  to explicit requests on both first and additional trips.
- Otherwise, offer up to three eligible stations in distance order, within
  2 km plus the accuracy radius (extra radius capped at 3 km; unknown accuracy
  uses that cap). Never autofill an approximate, unknown-accuracy or ambiguous
  result. Say “Choose your starting station. Your location isn’t precise enough
  to pick one.” An empty list says “No stations found nearby. Search for your
  starting station.”
- Manual typing, selection or clearing of From cancels pending autofill, and
  navigation discards setup request intent. A subsequent explicit location tap
  starts a new attempt. Permission/lookup callbacks cannot erase a query, replace
  a manual station or move focus after that cancellation. Silent fixes prefill
  only an untouched first trip before its initial lookup resolves. Once choices
  or a lookup failure have been shown, a silent fix cannot select From; an
  explicit retry is required. Pending permission/Settings recovery retains the
  original request intent. Other setup lookups offer station choices.
- An explicit lookup timeout/failure says “Couldn’t get your location. Try again
  or search for a station.” A refusal says “Location permission wasn’t granted.
  You can search for a station.” Keep retry available when the system can ask
  again; blocked permission offers “Open Settings”. Disabled device location
  explains that Location Services must be turned on, while retaining search.
  Returning from Settings continues the pending lookup when permitted. Errors
  remain inline rather than opening another modal; all station rows retain
  their normal minimum tap target and scroll with the setup results.
- The client sends no station query before three normalized characters. Search
  answers are memoized by trimmed, whitespace-normalized, case-insensitive
  query for the browser session; failures are not memoized.
- Enter, or the keyboard's Search key, picks the top match while matches are
  shown; while a hint stands in for them instead, it does nothing.
- Pending search says `Searching…`. An empty answer at four characters or fewer
  says `No match yet · keep typing`; a longer empty answer says
  `No stations match`. A failed call says `Station search is unavailable`.
- A board with no cached answer says `Getting the next trains…` while the first
  request is pending.

## Departure board

- The header gives both endpoints equal-width columns around a 26px arrow,
  with 9px gaps. Both names wrap by the same rule at 25px/300 with a 1.03
  line height, inside a minimum 62px name band. The origin aligns left and
  destination right. Keep `Wharf`, `Junction` and compass words in full;
  only the existing terminal `Station` suffix is dropped. Neither endpoint
  is ellipsised. A single word wider than its column wraps within the word
  as a last resort, preserving every character. At widths up to 375px, the type is 24px with a 22px arrow
  and 7px gaps.
- The first boarding cap stays visible in the smart header, result rows and
  promoted detail row. An unnumbered ferry place such as `Pyrmont Bay Wharf`
  displays `Wharf`; `Wharf 4, Side A` remains a full numbered cap. The raw
  supplied location remains in accessibility text. Unknown boarding locations
  stay absent. Ferry transfer pins
  use the same compact treatment as rail pins, with the side joined directly
  to the number.
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
  40.5px, right aligned in its column and vertically centred on the row, with
  a 9px uppercase provenance beneath it; a figure too wide for the column
  drops to 27.9px. At desktop width these figures are 46.8px and 36px.
  `min` and `H` stay 12px/500 with a 2px gap, inheriting the figure's colour
  so scheduled, past and cancelled states retain their distinction. The departure time is 18px, a struck
  scheduled time 13px, the arrival 16px in secondary ink at the right. Beneath
  them sit the 22px journey line — boarding cap, time axis, platform pins — and
  the 13px headsign line.
- Direct rows retain their 96px minimum. Transfer rows grow to reserve a
  separate station-label band and at least 6px before the headsign. The board
  uses the dynamic viewport, its rows scroll when the frame is too short for
  them, and its footer keeps a separate line
  outside the scroller. A sparse board leaves the space under its last row
  empty rather than distributing rows through it. When six services with at
  most two changes are returned, all six remain whole and reachable at 390×844
  and 412×732. A three-change row is taller, so a board of them shows fewer
  whole services; each row still renders whole and every row stays reachable.
- Every change names its station beneath the midpoint of its transfer interval,
  shared by the alighting and boarding platform markers. Names have their own
  band on Home, results and detail; they never overlap a headsign or instruction.
  Long names clamp to the device width and wrap; intersecting change names use
  separate lines and expand the row. The second change's alighting pin remains
  hidden on two-change results. Platform chips retain their rounded corners,
  including the boarding chip's left edge. Rides join the corresponding chip
  without an exposed overhang or a ground-colour slit. Use the measured chip
  frame and corner radius to end/start overlapping ride paint inside the chip body; do not
  add ground-colour masks or spacer strips (owner ruling, 2026-09-08).
  Temporal anchors and actual dwell gaps remain unchanged.
  The boarding cap and both transfer chips use a 3px radius on all four
  corners on web, 3dp on Android and 3pt on iOS (owner ruling, 2026-09-08).
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
- Clock times are printed in Australia/Sydney regardless of the device's zone.
- A departed service dissolves before the timeline closes upward, and remains
  in the past register from the last live estimate the client saw for it rather
  than waiting for a past page to reach it or for upstream to drop it. The
  `NOW` anchor keeps its place on screen while the row moves across it, so the
  board closes upward instead of pushing itself down a row. Reduced motion
  removes the transition; state variants otherwise preserve row geometry.
- The board closes with `— SIX SERVICES SHOWN` when six services are returned
  and `— END OF BOARD` otherwise; a board of three or fewer adds
  `Nothing scheduled after HH:MM.`

## Past, stale and exceptional data

- Every past row shows elapsed time with `AGO`. An actuals row counts from the
  actual departure and may also carry actual clock times, a struck scheduled
  time and a delay; a timetable-only row counts from the scheduled departure in
  the quieter scheduled weight and carries no struck time, delay, coral warning
  or other punctuality claim. A late train whose actuals have aged out therefore
  reads as having left on time, which the owner chose over a second register for
  elapsed time (ruling, 2026-09-05).
- Whether a past row has actuals is decided by its realtime data, never by its
  age or position. Where a live response and a past page carry the same service,
  the live response wins for as long as it still shows it as a departure; once
  it has run, the last live copy of it is the past row.
- No past row shows a departure countdown.
- Future countdowns remain visible on web, Android and iOS for stale,
  offline, scheduled and retained data (owner ruling, 2026-09-08). Count from
  the displayed effective departure; use the same Now/minutes/rounded-hours
  formatting as fresh data. Cancellation keeps its dash. Freshness indicators
  keep their existing meaning and appearance; a visible countdown does not
  make cached data live. Web's existing departed-row filtering is unchanged.
  Native boards retain departed rows and the last header answer under the
  [native retention rules](native-data.md#cached-boards-and-departed-services).
- Scheduled-only numerals are visually quieter and labelled `SCHEDULED`.
- Delays show both the scheduled and effective time, and paint the figure and
  the effective departure in the warning colour. Cancellation remains
  visible and a cancelled lead names the next train rather than disappearing:
  `<cancelled time> CANCELLED · NEXT TRAIN`.
- There is no `ON TIME` label. The closed provenance vocabulary is `MIN`,
  `DEPARTING`, `SCHEDULED`, `CANCELLED`, `n MIN LATE`, `AGO`, `TO CHANGE` and
  `TO GO`. Retained rows use the same vocabulary. `CANCELLED` and
  `n MIN LATE` are in the warning colour, because each
  names an exception. An ordinary live board countdown
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
- Under the rule the chosen board row keeps the board's grammar, at least
  100px tall. Detail uses a 69px figure column, shared by the promoted row
  and step times; the board retains 72px. Transfer labels and headsigns must
  remain separate and readable, with extra row height when needed. The
  promoted row is not a tap target. A cancelled journey keeps the board's
  cancelled treatment.
- The journey then reads as steps in travel order: a board step, one step per
  change, an arrive step. Steps are at least 72px, change steps at least 82px
  with a heavy rule above and below. Wrapped names and instructions expand
  the step; text and chips stay at least 4px clear of each divider. Each states a time, a station and a platform chip in its
  line's colour with a label — `BOARD <code> · <headsign>`, then `GET OFF` and
  `BOARD <code> · <headsign>` across a change's two chips, with the complete
  boarding place, then `ARRIVE`, which
  becomes `ARRIVE · JOURNEY CANCELLED` when the final leg is cancelled. The
  boarded leg supplies the place, and its full label keeps the wharf and side
  together. A ferry's initial step cap uses the same numbered/side label or
  unnumbered `Wharf` fallback as the shared journey device. Ferry transfer
  chips use the same compact number-and-side grammar as the board, while the
  secondary boarding direction retains the full label.
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
  colour with the time struck. Freshness appears at the top right beside the
  Detail back control on all three clients (owner ruling, 2026-09-08), using
  its existing status copy and colours. The tail is followed by the 66px
  action rail `Pin this train` or `Pin this ferry`,
  chosen from the first leg (`Unpin this train` or ferry when pinned), which shares its geometry with home's `New trip`
  rail.
- Once the journey has departed, the promoted row's figure and provenance are
  the directions ladder's, `TO CHANGE` or `TO GO`, and the steps the rider is
  past take the quiet done treatment: secondary ink, no strike. There are no
  per-leg countdowns. Stale detail keeps numerical figures based on its stored
  times and preserves the existing stale/offline freshness indication. During
  a transfer dwell, To change counts to the next leg's effective departure,
  including offline and retained journeys. Cancelled detail keeps its dash.
- The journey bar is a percentage time axis: departure is 0%, arrival is 100%,
  and each ride and transfer segment uses its true share of total journey time,
  measured from effective times. There is no minimum visual transfer width.
- A transfer gap is bracketed by the alighting platform numeral in the first
  leg's colour and the boarding platform numeral in the next leg's colour.
  Platform markers overlay the axis and do not consume its width. When the
  service legs meet at different stop IDs because a walk lies between them,
  the change label names both supplied endpoints as `<alighting stop> →
  <boarding stop>`. Focused riding directions name the alighting stop; focused
  change directions name the boarding stop. Same-stop changes keep one name.
- Directions count to the next required action and use `TO CHANGE` or `TO GO`.
  The instruction line names the station and boarding place of that action:
  while riding, `Get off at <station> · <place> <label>`; while dwelling at a
  change, `Change at <station> · <place> <label>`; and, with a tight change
  still ahead, `Tight change · <n> min · <place> <label>` in place of either.
  `<place>` is `Platform` for train and metro, and `Wharf` for ferry. The clause
  is omitted when upstream gives none. The boarding-place cap disappears after
  boarding.
- The progress marker moves continuously from timetable and live estimates only
  during a ride or change. It is hidden before departure, even when pinned, and
  after completion. The centered station label's small grey stem follows the
  same active phases. Keep at least 6px between the station text and the
  instruction below it. Progress is a time inference, never a claim of
  continuous location tracking.

## Visual language

The interface reads as a printed timetable: one column measure, one type-scale
ladder, a heavy masthead rule, hairline row rules, system fonts and tabular
figures. Labels use one letterspaced uppercase idiom. There are no cards within
cards, ornamental chrome or happy-path spinners. No scrolling region draws a
scrollbar — not the board, the trip list or journey detail — because on a
pointer device it was the one piece of chrome on a screen that is otherwise all
hairlines (owner ruling, 2026-09-05).

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
service. Multi-leg bars split by leg and transfer duration. Rail services use
the palette key matching their visible line code. Every ferry uses the `FERRY`
mode key regardless of its visible code, including private operators: official
green `#5AB031` in dark and `#428024` in light, where it measures 4.59:1 on
paper. Implementations use the palette defined in `web/app.css` (the reference;
native ports generate theirs from the same values); new rail line codes and new
mode keys must update every client's mapping and its tests in the same change.

Line colour has two roles. Every filled device — the boarding cap, the platform
pins, the saved-trip badges and spine bars, the journey-detail chips and the
axis ride segments — paints `--line-fill-<key>`; every bare use of line colour
as text paints `--line-<key>`. The key is the line code for rail and `FERRY` for
ferries. In the dark scheme the two are equal. In light only T1 and BMT differ:
the fill is the official `#F99D1C` under paper `#FAF9F5`
type, while the same codes as bare text keep the readable `#A46204`. Paper on
that yellow measures 2.02:1 against the binding 3:1 rule for filled devices.
The owner's verdict of 2026-09-03 accepts that exception for TfNSW line
identity: the yellow may only ever be darkened by an imperceptible amount and
never returned to a brown fill, and the regression test asserts the exact pair
rather than a ratio. Text on any other fill is at least 14px/700 and meets 3:1.

Platform and wharf numerals on a service-colour chip are paper in the light
scheme, on every service: paper reads better than ink on all fifteen
light-scheme palette colours and
is the only value that clears 3:1 on T4 and HUN. In the dark scheme, T4, T5,
T9, CCN and HUN use light ink; the remaining fills use the dark ground,
including ferry green at 7.21:1.

## Anonymous instrumentation

The fixed event vocabulary and assignment rules are in
[analytics.md](analytics.md). Screens emit only these categorical counters;
analytics adds no in-app disclosure or settings.

| Surface | Counters |
| --- | --- |
| Home answer | `shown_<kind>`, first-row `hit_<kind>` or `miss_<kind>` |
| Journey detail | `hit_<kind>` when focusing home's last shown trip and direction |
| Inferred travel | `entered_inferred`, `change_inferred`, `back_inferred` |
| Hand-focused return | `back_focus` |
| Home location panel | `asked_panel`, `granted_panel`, `denied_panel`, `later_panel` |
| Setup | `shown_setup`, `saved_setup`, `asked_setup`, `granted_setup`, `denied_setup` |

An explicit board selection does not add a home exposure. A row tap followed
by focusing the same trip adds two hits; later row taps are browsing.
Silent location fixes do not emit permission outcomes. The first displayed
answer increments the local open count once; a milestone `opened` event, if
due, precedes the first `shown_*`.

## Calibration and verification

The authoritative comps live at `assets/comps/latest/`. It always holds the
current calibration exemplars and nothing else; when an owner verdict
replaces a screen's design, the new exemplar frames replace the old ones in
the same change as this contract, and git keeps the history. Shipped-screen
frames are shots of the built client from `tools/shoot-states.js`,
`tools/check-settings-browser.js`, `tools/shoot-android.sh` or
`tools/shoot-ios.sh`. A frame no instrument can reproduce is removed rather
than left to rot.

An accepted, not-yet-built design may be retained here as an explicitly labelled
visual target with its reproducible comp source. The 2026-09-08
[travel tracker target](../../assets/comps/latest/travel-tracker/README.md) uses
short prose plus the quiet trip line. Its browser frames remain the iOS visual
target; [Android calibration](../../assets/comps/latest/travel-tracker/android/README.md)
contains actual system-rendered cards from the production integration. Neither
set establishes completion of the remaining native verification gates.
Replace illustrations with verified native exemplars as implementation lands. Platform
boxes on that line remain an optional visual follow-up, not part of the accepted
baseline. The active behavior/design boundary is in its
[backlog handoff](../backlog/persistent-travel-tracker/design.md).

The board, home and detail calibration frames are listed below.
`tools/check-settings-browser.js --frames assets/comps/latest` adds twelve
Settings frames and two filtered-Home frames:

- Settings: `settings-390x844.png`, its `light`, `long-home`, `all-off` and
  `feedback` variants, plus `settings-412x732.png` and its `light` variant.
  `settings-390x844-ask.png` is the location-row permission exemplar.
  They preserve the C1 grouping, controls, spacing and reachable final rows.
- Settings with the `transferLimit` flag on:
  `settings-390x844-transfer-limit.png` is the capped default,
  `settings-390x844-transfer-limit-any.png` the uncapped choice,
  `settings-390x844-transfer-limit-light.png` the light scheme and
  `settings-412x732-transfer-limit.png` the narrow page that still reaches its
  last row. `android-settings-390x844-transfer-limit.png` and
  `ios-settings-transfer-limit.png` and their variants are the native ports.
- Filtered Home: `home-390x844-services-filtered.png` preserves the eligible
  prediction and rows; `home-390x844-services-empty.png` shows the all-hidden
  recovery without a journey header, blank clocks or Live indicator.
- Board: `board-390x844-hero.png` plus its `past`, `delayed`, `cancelled`,
  `long`, `two-change` and `hero-light` variants, and `board-412x732-hero.png`.
  `two-change` is the two-transfer row grammar.
- Ferry board: `board-390x844-ferry-pyrmont.png`,
  `board-390x844-ferry-doublebay.png`, `board-390x844-ferry-numeric.png` and
  `board-390x844-ferry-side-only.png` preserve the equal-column header, the
  generic `Wharf` fallback for named-only origins in both directions, compact
  transfer number/side markers with their true alight/board associations, and
  unchanged full numeric/side-only initial caps.
- Journey detail: `detail-390x844-hero.png` plus its `tight`, `cancelled`,
  `direct`, `long`, `departed`, `focused` and `hero-light` variants, and
  `detail-412x732-hero.png` with its `tight`, `cancelled` and `long` variants.
  `departed` is the post-departure promoted row under `TO CHANGE`; `focused` is
  the explicitly pinned journey, which carries an unpin action rail.
- Ferry detail: `detail-390x844-ferry-pyrmont.png` carries the generic `Wharf`
  origin cap, the compact `5B` to `4B` transfer and its full secondary
  boarding instruction. `detail-390x844-ferry-numeric.png` preserves the full
  initial `Wharf 4, Side B` cap.
- Smart home and directions: `home-390x844-before.png` plus `change`, `final`,
  `tight`, `cxl`, `focused-cxl`, `late`, `back` and `before-light`, and
  `home-412x732-change.png`. `tight` is a late unfocused lead, `cxl` the
  unfocused cancelled lead, `focused-cxl` a focused journey cancelled before it
  departs, `late` the `RUNNING LATE` treatment, and `back` the return direction
  with its real transfer platforms after the offer is accepted.
- Pinned and next service: `home-390x844-mascot-before.png`,
  `home-390x844-mascot-pinned.png` and `home-390x844-mascot-active.png`, with
  `-light` variants and the same six frames at `412x732`. These reproduce the
  approved short Mascot–Central leg: centered Central, separated platform
  labels, the 44px next-service rail, explicit pin indication and at least
  6px to the instruction. The source screenshot's overnight services are
  scheduled-only; the active frame advances the clock to show travel state.
- Ferry smart home: `home-390x844-ferry-pyrmont-focused.png` calibrates the
  generic `Wharf` origin with the compact `5B` to `4B` transfer;
  `home-390x844-ferry-numeric-focused.png` calibrates the full initial
  `Wharf 4, Side B` cap. `home-925x844-ferry-pyrmont-focused.png` carries the
  same generic origin at desktop width.
- Location-first home: `home-390x844-inferred.png` and its `inferred-light`
  variant are inferred travel mode carrying the `Going somewhere else?` line;
  `home-390x844-just-added.png` is the open on which the app saved the pair it
  is showing, marked once in the sub line.
- Inferred experiment A2: `home-390x844-inferred-a2.png` and
  `home-390x844-inferred-a2-light.png` put the correction in the receipt slot.
- Setup: `setup-390x844-origin.png` is the sheet opening with From filled from
  a fix and the destination field focused.

Measurements these frames carry deliberately, so nothing above reads as drift:
the two header clocks share a baseline to within 1px, which is the tolerance
the instrument allows. Header height follows its transfer-label band, receipt
and optional next-service rail. A future pinned journey keeps its boarding cap
but has no progress marker or station stem;
`home-390x844-inferred` carries the inferred line at 49px with its 48px action;
its A2 variant has a 44px action;
`home-390x844-just-added` carries the 63px mark inside the sub line's 212px track;
`detail-*-tight` shoots a change shortened by a late first leg,
so its promoted row reads `5 MIN LATE`.

The screenshot tool checks contrast against the nearest opaque background,
compositing translucent ink first. Dark/light reference ratios are 4.3/4.83:1
for `Just added`, 8/8.13:1 for the inferred question, and 17.6/17.8:1 for
its action. The instrument allows 0.1 below each reference ratio for the
difference between the page and panel backgrounds.

Client markup carries the data attributes the comps harness probes, so the
instrument measures the built screen with the probes that judged its comps.

Visual changes are compared side-by-side with the relevant calibration asset
and verified in the real client. `tools/visual-regression.js` proves the
unchanged screens on all three clients still match `tools/baselines/`; an
intended change accepts new baselines in the same commit. Use `tools/shoot-states.js` for web geometry
and flows; a native port must ship an equivalent seeded-state shooter before
its first verdict (PROJECT.md, "Native clients"). A design change requires
new divergent comps and an owner verdict before product implementation
(`tools/comps/`). That harness's acceptance oracle reproduces the archived
board v2 exemplar set as pinned in git at `b218dd5`, pixel-identically: it
gates the harness, not the frames listed above, which are shot from the client.
Update this contract when an owner verdict changes current behavior.

## Settings

Home's footer pairs `+ New trip` with an outlined cog and `Settings`, in equal
56px targets. The existing contextual location panel temporarily replaces that
footer. `#/settings` returns to Home in one tap and remains reachable offline.
It follows the approved C1 Grouped buttons composition: paired Location/Home
rows, four equal service buttons, three equal appearance choices, then quiet
feedback and version rows. Controls keep visible labels, non-colour selection
markers, 44px minimum targets and reachable content at 390×844 and 412×732.

Location is an app preference, distinct from browser permission. Off prevents
fixes and contextual prompts, including late results from earlier requests.
Settings uses one location row with the state in its subtitle and the next
action in its mark; there is no separate permission strip.

| Preference | Permission | Subtitle | Mark | Tap |
| --- | --- | --- | --- | --- |
| Off | Any | Location is not used | `TURN ON` | Enable the preference and request location |
| On | Not decided | Location needs permission | `ALLOW` | Request system permission |
| On | Blocked | Location is blocked | `OPEN SETTINGS ›` | Open the app's system settings |
| On | Granted | Nearby trips use location | `TURN OFF` | Disable the preference |

Web's blocked state instead uses `Blocked in browser` and `TURN OFF`, which
disables the preference; browsers cannot open site permission settings.
Enabling the preference cannot revoke a browser denial. On Android, blocked
means a permission request has returned an answer, permission is absent and
the system will no longer show a permission rationale. A soft refusal or
dismissed first dialog remains `ALLOW`; dismissal records no answer. iOS treats denied
and restricted permission as blocked. Returning from system settings refreshes
the row from the current permission.

The action mark uses primary ink in every state; blocked subtitles use warning
ink. Only `OPEN SETTINGS` has the next chevron, meaning it leaves this screen.
Row height stays equal across states (web minimum 56px, Android 72dp, existing
iOS geometry). Each row is one accessible button, read as title, subtitle,
then action. Pressed/toggle semantics apply only to Off and Granted; awaiting
permission and blocked are plain buttons, including web's blocked deviation.
Web shows `ALLOW` until its permission query resolves. An answer superseded
by a newer location action or navigation cannot repaint Settings, and keyboard
focus stays on the row when its action changes. Setup's location action and
the web Home footer location panel are unchanged.

Home displays the current automatic station and allows a local station
selection. `Use automatic home` removes only the override. Automatic votes
continue while overridden; the manual-home receipt says `You set <station> as
home.` The picker uses existing station ranking without saving a trip.

Trains, Metro and Ferries are independent pressed buttons; Buses is off and
disabled. Every service leg must be enabled for a suggestion to qualify.
Changing services fetches replacements through the existing departures API.
Keep eligible cached results while it answers; never restore excluded
journeys on failure. All-off suppresses new suggestions and points to Settings.
A saved trip is hidden from Home and excluded from prediction when either
endpoint has no enabled service in the station index. Train, metro and ferry
use this same rule. An endpoint served by multiple modes remains eligible if
any is enabled; unknown endpoints remain candidates for the planner. An old
cached journey does not prove an endpoint or pair requires that mode.
Hidden trips, history and caches remain stored and return when re-enabled.
If every saved trip is hidden, Home shows a short empty state with Change
settings and the usual footer, with no blank journey or Live indicator.
Service filters also apply to followed journeys, including every leg of a
mixed train/metro/ferry trip. An incompatible followed journey contributes
no header, status, directions or forced saved-trip row. Its stored snapshot
and background updates remain intact; re-enabling its modes restores it while
it is still current. Home shows an eligible suggestion or the filtered empty
state. A saved pair remains eligible for alternative routes only when its
endpoints support the enabled modes; focus never bypasses that check.
Preferences cause no new history or prediction exposure event.

The transfer limit is one row inside Services, directly after the services
note, and it appears only while the backend publishes the `transferLimit` flag
as on. With the flag off Settings renders exactly as it did before the row
existed. The row is the Location row's composition without its icon column,
because no glyph in the set means a change count: the title `Transfer limit`,
the current value as the subtitle, and the other value as the action mark in
the mark's letterspaced caps. It has no heading, no note, no glyph, no journey
line and no colour, and it is one 56px button read as title, subtitle, then
action, with the same row height in every state.

| Choice | Subtitle | Mark | Tapping it |
| --- | --- | --- | --- |
| Up to two changes (default) | `Up to 2` | `NO LIMIT` | lifts the limit |
| No limit | `No limit` | `UP TO 2` | caps changes at two |

Tapping swaps the value and takes the service change's path: eligible cached
rows are kept, replacements are fetched through the departures API, and an
excluded journey is never restored on failure. While capped, a journey with
more than two changes is hidden wherever the service allow-list applies, and
the followed journey's own all-mode refresh stays uncapped. Turning every
service off changes the note above the row, never the row itself. A flag
answer that changes the cap mid-session repaints Settings and refetches the
board exactly as a tap does.

Appearance has radio semantics for System, Light and Dark. Manual choice wins
before first paint and updates browser chrome; System follows device changes.
The existing palettes remain unchanged. Feedback and home search are short
subpages returning to Settings. The release row reads `Version <major.minor.patch>`
from the canonical `web/js/version.js`, in production and local development.
The Git revision remains internal image metadata; it is not the app version.

Feedback requires Problem, Suggestion or Other plus a message. The form says
`Don’t include personal details.` One in-memory draft survives navigation
within this visit; reload discards it. Submission disables duplicate taps,
retains the draft on errors, and clears only after 201. See analytics.md for
transport and operator access.

The feedback message field indicates focus with a strong bottom rule and its
label in primary ink. It has no surrounding focus rectangle; keyboard and
pointer focus receive the same visible field treatment.
