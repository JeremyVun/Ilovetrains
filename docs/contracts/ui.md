# Contract: Client experience and visual language

This is the binding UI contract for every client: the web PWA today and the
native Android and iOS ports to come. Platform controls may use native mechanics, but the information hierarchy, honesty
rules and core flows below do not vary by client.

The product should answer the likely journey on open, make correction one tap,
and never present inferred or stale information as observed fact. Precise state
and API semantics live in `client-storage.md` and `api.md`.

## Core flow

- Home is the open state. Its smart header is the zero-tap answer for the
  predicted or focused trip; saved trips sit immediately below it.
- Tapping the header or a saved trip opens that trip's departure board.
- Tapping a board row opens the journey detail view.
- Focusing a journey returns home and turns the smart header into directions.
  The board never shows a separate focus strip.
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
  arrival time, with the journey time axis beneath. Both station names share
  one top edge and both times share one baseline.
- The header may fetch live data only for the selected trip. Saved-trip rows
  use device-held facts such as line identity, distance and last ride; opening
  home must not fan out one upstream request per saved trip.
- A receipt explains a prediction only when the app made a meaningful leap.
  It names real evidence. A manually focused trip needs no receipt.
- Copy about the train is always safe. Copy about the person requires evidence
  supplied by their action or persisted ride record. App opens are looks, not
  rides.
- Location permission is requested contextually, never on first load. Missing
  or denied location degrades silently to device history and time.
- Saved-trip rows carry both stacked line-colour rules and coloured line-code
  badges. The web list is capped by the storage contract's ten-trip LRU.

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
  scroll affordance (`EARLIER`, `NOW`) and no reverse control on the board;
  reversal belongs to the smart header.
- Rows rank by effective departure. Past and future rows use the same grammar
  and equal height; past rows are distinguished through type colour, not
  container opacity.
- When six services are returned, all six remain whole and reachable at
  390×844 and 412×732. Row height adapts to the available timeline; a fixed
  pixel height must not crop or hide a service. The board uses the dynamic
  viewport, its rows scroll when necessary, and its footer keeps a separate
  line outside the scroller. Sparse boards may distribute their rows through
  the available space.
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
- Delays show both the scheduled and effective time. Cancellation remains
  visible and a cancelled lead names the next train rather than disappearing:
  `<cancelled time> CANCELLED · NEXT TRAIN`.
- There is no `ON TIME` label. The closed provenance vocabulary is `MIN`,
  `DEPARTING`, `SCHEDULED`, `CANCELLED`, `n MIN LATE`, `AGO`, `TIMETABLE ONLY`,
  `ON BOARD`, `TO CHANGE` and `TO GO`. An ordinary live board countdown leaves
  the provenance label empty because `min` is already attached to its numeral;
  other labels appear only when they change the figure's interpretation.
- A response is fully stale when its `generatedAt` age exceeds 90 seconds, or
  when a live request fails. `X-Data-Stale: true` alone only
  removes the confident live-dot treatment; recent data may still count down.
- A board that has never loaded has no update age. Its footer is empty while a
  request is pending and says only `OFFLINE` if the request fails.

## Journey detail, time axis and directions

- Journey detail uses the board's row grammar in travel order, alternating
  service legs with transfer bands. A transfer is bracketed by the masthead's
  heavy rule, names its station once at headline scale, and shows the alighting
  and boarding platforms together. A closing line owns the destination,
  effective arrival time and final leg's arrival platform.
- Every service leg names its line code and headsign and renders its own
  realtime, scheduled-only or cancellation state. A cancelled leg stays in
  place and marks the journey broken; the client does not invent or substitute
  a replacement service absent from the API response. The final arrival is
  struck only when the final leg is cancelled.
- Transfer waits are computed from each leg's effective times after flooring
  both sides to the displayed clock minute. The wait therefore agrees with the
  two clock times printed beside it.
- A transfer under five minutes is tight even when it was scheduled that way.
  When realtime shortens a transfer, detail shows the current and printed
  windows and strikes the earlier arrival time. A merely short scheduled
  transfer must not claim a previous window, and a cancelled connection is
  broken rather than tight. Only the transfer warning uses the warning colour;
  the journey's arrival figure does not.
- While a leg is being ridden, its figure counts to that leg's effective
  arrival, uses `ON BOARD`, and shows the alighting time, station and platform.
  A completed leg remains in travel order with an empty figure slot. Stale
  detail keeps absolute clock times but removes live countdown figures.
- The journey bar is a percentage time axis: departure is 0%, arrival is 100%,
  and each ride and transfer segment uses its true share of total journey time.
  There is no minimum visual transfer width.
- A transfer gap is bracketed by the alighting platform numeral in the first
  leg's colour and the boarding platform numeral in the next leg's colour.
  Platform markers overlay the axis and do not consume its width.
- Directions count to the next required action and use `TO CHANGE` or `TO GO`.
  The boarding-platform cap disappears after boarding.
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
client's mapping and its tests in the same change. Filled
line-colour devices are permitted; text on a fill is at least 14px/700 and
meets 3:1 contrast. Line colour used as text must use the scheme-specific
readable mapping.

## Calibration and verification

The authoritative comps live at `assets/comps/latest/`. It always holds the
current calibration exemplars and nothing else; when an owner verdict
replaces a screen's design, the new exemplar frames replace the old ones in
the same change as this contract, and git keeps the history.

- Board: `board-390x844-hero.png` plus its `past`, `delayed`, `cancelled`,
  `long`, `hero-light` and `412x732` variants.
- Smart home and directions: the `home-390x844-*.png` state family
  (`before`, `change`, `final`, `tight`, `cxl`, `back`, `before-light`) and
  `home-412x732-change.png`.

Visual changes are compared side-by-side with the relevant calibration asset
and verified in the real client. Use `tools/shoot-states.js` for web geometry
and flows; a native port must ship an equivalent seeded-state shooter before
its first verdict (PROJECT.md, "Native clients"). A design change requires
new divergent comps and an owner verdict before product implementation
(`tools/comps/`, whose acceptance oracle reproduces the frames above
pixel-identically); update
this contract when that verdict changes current behavior.
