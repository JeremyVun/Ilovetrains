# Roadmap

Read `docs/PROJECT.md` first: it says what the product is for and how work
on it is done. This file says what has shipped and what comes next. The
north star for everything below is the one in PROJECT.md — **the smart
header's accuracy** — followed by usability, then routing that just works.
A candidate that does not serve one of those needs an owner ruling to be
scheduled.

## Shipped

### M0 — Pipeline proven — DONE 2026-08-31
API key obtained, probes against real TfNSW endpoints, reference doc
verified against reality, Go proxy live-smoked.

### M1 — Core loop (v1) — DONE 2026-09-01
Saved trips, zero-tap predicted departure board with realtime delays and
platforms, direction flip and station search for setup.

### M2 — PWA polish — DONE 2026-09-01
Installable, offline last-known departures, service worker, perf measured
(warm cached paint 32ms, live < 1s on localhost). Deployed behind
Cloudflare+Caddy on syd1 (see `docs/operations/deploy.md`); real-origin numbers: warm
cached paint 12ms, live data 7ms (edge cache).

### M3 — Board v2 + smart home — DONE 2026-09-02
The locked board v2 design is implemented: home is the open state, the departure board is a
now-anchored past/future timeline, and focused journeys become continuous
directions in the smart header. Includes exact percentage transfer axes,
actuals-vs-timetable past rows, real return journeys, recent/fuzzy station
search, location-aware prediction, completed-ride/home inference, ten-trip
LRU, and the server-tuneable planned transfer floor. The resulting rules and
geometry are binding in `docs/contracts/ui.md`; the exemplars are in
`assets/comps/latest/`. The six rounds of owner rulings live in git history
(`docs/backlog/board-v2/`, closed 2026-09-02).

### Trip selection and journey readability — DONE 2026-09-04
A saved-trip row opens that trip's departure board and the smart header is
read-only, so browsing never replaces the followed train; `Take this train` on
journey detail is the only control that focuses a journey. The board is the C1
full-rule ledger — 96px rows, a stable figure column, edge-to-edge rules, and
the station of every change beside the platform it is boarded from — and
journey detail promotes the chosen row above its steps, tail and rail. The
smart home's top line carries the distance to the origin, or the focused
journey's `RUNNING` / `RUNNING LATE` / `CANCELLED` / `TRIP OVER` status with
late in the warning colour. The rules and geometry are binding in
`docs/contracts/ui.md` and `docs/contracts/client-storage.md`; every exemplar
in `assets/comps/latest/` is shot from the built client.

### Smart header location and travel mode — shipped 2026-09-05
The header starts at a nearby station, uses relevant history before the usual
starting station, and saves an unsaved pair when it becomes the answer. Home
is inferred silently from daily first-open votes. Movement can enter travel
mode from the last shown departure, and a destination fix records arrival
even offline. The inferred header offers `CHANGE` through the existing sheet.
The shared baked station index now serves client location lookup and server
autocomplete. Rules are in the client-storage and UI contracts. The optional
real-phone speed observation remains open in `docs/backlog/smart-header-v2/`.

## Next

Decide after living with M3 on real commutes. The owner's playtest notes
are the spec for the next round, verbatim, as they were for board v2.
Suggested order, each its own backlog folder:

### Settings — implementation complete, release verification in progress
The [Settings](backlog/settings/design.md) C1 page includes local preferences,
web API mode replacements and an in-memory feedback draft. Local verification
passes; rollout awaits authenticated feedback retrieval. Native offline routing
remains separate.

### M4 — Smart header accuracy
The number one metric. A nearby station sets the origin, view history sets
the destination before daily home votes, and movement can infer travel on
the last shown departure. Without a nearby station, the original history
score and location term still apply. Candidate work is judged by whether
the header answers the user's real intent more often:
- **Measure before tuning — shipped.** Anonymous counters record the
  header's answer kind and whether it was acted on or corrected. Usage
  bands replace device identifiers; the inferred strip compares A3 below
  the rule with A2 in the receipt slot. Vocabulary and measurement limits
  are in `docs/contracts/analytics.md`.
- **Better signals over harder guessing**: public-holiday awareness and
  ride detection once a native client can observe it. Location-first origins,
  daily home votes and inferred travel are now the baseline to measure.
- **Receipt copy system**: test the evidence-specific receipts in real use.
  Daily home votes now re-infer silently; the moved-home offer is removed.
- **Focused-journey disruption recovery**: when a later leg is cancelled while
  the user may already be travelling, make the smart header switch to the next
  best alternative. Do not rely on a recovery button in the cancelled journey
  detail (owner ruling 2026-09-03).
- Known accepted gap to watch: right trip, wrong service (missed the 09:24,
  caught the 09:39) — revisit only if it bites.

### M5 — Usability hardening
Every item is a measured complaint from a real phone, not a hypothesis.
Standing checks: tap targets ≥44px, six whole services at 412×732, no
ambiguity about what is tappable, no figure without its provenance, offline
paint from the worker, pixel agreement with the exemplars in both schemes.
Comp round first for anything compositional; instrument first for anything
geometric. Open owner questions, each an observation waiting on a ruling:
- After departure the promoted journey-detail row's live `TO CHANGE` figure
  paints in the board's dimmed past-row ink, while the same count in the smart
  header is full ink. A ruling decides which ink a live figure on a past row
  takes.
- A journey whose first leg is cancelled has no word on its board step: the
  step is struck and dimmed and still names the service, where the change step
  for the same fact reads `CANCELLED`. A ruling decides whether that step gets
  a word of its own.
- The home top line's `LATE` word sits 4.5px right of the approved comp, and
  cancelled detail's tail strike is 2px where the comp's is 1px. A ruling
  decides whether either is drift worth correcting.
- The reverse-direction home frame carries no view-based receipt, because only
  a persisted ride supports a reverse receipt. A ruling decides whether a
  view-based one exists at all.

### M6 — Routing that just works
- Tune the server transfer floor (`MIN_CONNECTION_TIME`) from real
  connections rather than defaults; never show a trip the user would not
  take.
- Disruption/trackwork awareness surfaced on saved trips and in the header.
- No routing configuration surface. If a case seems to need one, bring it to
  the owner as a routing defect first.

### M7 — Design system and tooling as infrastructure
The comps loop is how the product moves, and the native ports depend on a
design truth they can copy (PROJECT.md, "How design work is done" and
"Native clients"). Make one round cost less than the last and make the
ports mechanical:
- **Design tokens**: one machine-readable file in `docs/contracts/` that
  generates the CSS custom-property block today and the Kotlin and Swift
  themes later. `web/app.css` stops being the place values live.
- **View-model contract**: the row model, directions state, home model and
  journey-bar geometry recorded as a data contract, so each screen is a
  renderer of data the fixtures can check.
- **Conformance fixtures**: the pure-logic unit tests re-expressed as
  canonical JSON cases (document, clock, fix, API responses in; view model
  out), generated by the web implementation and committed.
- **State catalogue and seeded shooters**: `shoot-states.js`'s state list
  becomes a shared directory of seeded documents, clocks and API fixtures;
  the web shooter reads it, and each native port ships a shooter that reads
  the same catalogue before its first verdict. `tools/comps/scenarios.js` is
  the start of it — it derives the scenarios from the fixtures already, but
  emits mapped view rows, where `shoot-states.js` seeds API-shaped documents.
- **Parity tool**: per-platform pixel regression against its own golden,
  cross-platform diff of a debug layout dump, and a side-by-side sheet.
- **Done 2026-09-02** — a reusable comps harness in `tools/comps/` (round
  scaffold, matrix shooter, magnifier, contact-sheet generator, pixel diff,
  the scenario catalogue, the standard frames and schemes, the measured probes
  for tap targets, scroll landing, track lockups and axis geometry) so a round
  is a directory of HTML plus a one-line shoot, not a copied `shoot.js`.
- **Done 2026-09-02** — comps built from the live `web/app.css` and
  `tools/fixtures/` by reference, never by hand-copy, so a comp cannot drift
  from the product's language. Instrument traps documented once
  (`tools/comps/README.md`, indexed from `tools/README.md`), each as code plus
  one line, and every probe proven to bite against a planted defect.

### M8 — Native Android and iOS (gated)
Kotlin/Compose and Swift/SwiftUI, each in its own repository or top-level
directory, each a renderer of the shared view models against the shared
tokens. The gate, all three required before the first port brief:
1. M4 has landed and the contracts have been stable for one further round.
2. M7's tokens, conformance fixtures and state catalogue exist and the web
   client passes them.
3. The information architecture has not changed for one round (comps rounds
   changed composition only).
Sequence: Android first (the owner's phone; JVM screenshot tests need no
emulator), iOS second. Each port's first deliverable is its seeded-state
shooter and a green conformance suite, before any screen is judged. What
native buys: cold launch, swipe-to-delete, home-screen widgets, ride
detection via background location, notifications. OS-rendered artifacts
(icons, widgets) pass through the real renderer before a verdict.

## Candidates (unscheduled)
- **Ride history as a stat** (owner idea 2026-09-01): "you rode this 4 times
  this week" in the saved-trip row's meta, beside "last ridden Friday".
  Honesty constraint carried from the board's two-register rule: count only
  what can actually be observed. A count inferred from app opens is a count
  of *looks*, not rides, and must be named as whatever it really measures.
  Needs ride detection first (M8); the PWA cannot observe it today.
- General A→B trip planner.
- Other modes: bus, light rail. Trains, metro and ferries are served. Metro
  product class 2 has been served beside class 1 since M1, including train+metro
  changes, and the owner closed a metro item as already built (2026-09-05;
  the copy ruling is in `docs/contracts/ui.md`). Metro loose ends worth a
  live probe when a key is at hand: the only metro fixture answered three
  journeys when asked for six on a ten-minute headway, and no metro-only
  station has been searched live.
