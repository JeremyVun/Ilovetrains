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

## Next

Decide after living with M3 on real commutes. The owner's playtest notes
are the spec for the next round, verbatim, as they were for board v2.
Suggested order, each its own backlog folder:

### M4 — Smart header accuracy
The number one metric. Today's inputs are view history (time of day, day
type, recency), a one-shot geolocation term, completed rides from focused
journeys, and a three-vote home inference. Candidate work, all to be judged
by whether the header answers the user's real intent more often:
- **Measure before tuning.** Record, on the device only, whether the
  header's pick was the trip the user then acted on (tapped, focused) or
  corrected away from. Without a hit rate, tuning is guessing.
- **Better signals over harder guessing**: use the time of the last ride
  and the trip's own duration to judge "trip over" and "on the way back";
  weekday/weekend and public-holiday awareness; a walking-distance term that
  prefers the station the user is nearest to, not just the origin they
  saved; ride detection once a native client can observe it.
- **Receipt copy system**: every leap class has a receipt, the receipt names
  the real evidence, and no receipt appears when none is needed. Copy
  reviewed with the `user-facing-copy` skill.
- **Home-may-have-moved** flow iterated from real use (it is built but the
  experience is untested in the wild).
- Known accepted gap to watch: right trip, wrong service (missed the 09:24,
  caught the 09:39) — revisit only if it bites.

### M5 — Usability hardening
Every item is a measured complaint from a real phone, not a hypothesis.
Standing checks: tap targets ≥44px, six whole services at 412×732, no
ambiguity about what is tappable, no figure without its provenance, offline
paint from the worker, pixel agreement with the exemplars in both schemes.
Comp round first for anything compositional; instrument first for anything
geometric.

### M6 — Routing that just works
- Tune the server transfer floor (`MIN_CONNECTION_TIME`) from real
  connections rather than defaults; never show a trip the user would not
  take.
- Baked station index: build the ~300-entry train/metro station list into
  the server (from the GTFS stops bundle) so `/api/v1/stops` never touches
  TfNSW — instant autocomplete, zero upstream calls. Motivated by live use
  2026-09-01: every distinct search prefix is a cold ~0.5–1.5s upstream call.
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
  the same catalogue before its first verdict.
- **Parity tool**: per-platform pixel regression against its own golden,
  cross-platform diff of a debug layout dump, and a side-by-side sheet.
- A reusable comps harness in `tools/` (shoot script, contact-sheet
  generator, seeded fixture data, the standard frames and schemes, the
  measured probes for tap targets, scroll landing and axis geometry) so a
  round is a directory of HTML plus a one-line shoot, not a copied `shoot.js`.
- Comps built from the live `web/app.css` and `tools/fixtures/` by
  reference, never by hand-copy, so a comp cannot drift from the product's
  language. Instrument traps documented once (`tools/README.md`).

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
- Other modes: bus, ferry, light rail.
