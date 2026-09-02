# ilovetrains

A Sydney train and metro app that answers one question the moment you open
it: **"What train should I take right now?"** — with zero taps, zero search,
zero ads. Live at https://ilovetrains.jeremyvun.com.

This document is the product's constitution: what it is for, what it must
never do, and how work on it is done. Agent sessions should read it before
`docs/ROADMAP.md`; binding implementation behavior lives in `docs/contracts/`.

## Why

TripView and the official apps make you search origin and destination every
time, even though almost every journey is one of the same two or three trips.
They are ad-laden, save trips badly, and have no memory. This app inverts
that: it remembers your trips, learns your patterns, and shows the right
train before you ask.

## The centrepiece: the smart header

The smart header sits at the top of the home screen and is the whole point
of the app. **Whatever intent the user had when they opened the app, the
smart header should already answer it.** Its accuracy — did it show the trip
the user actually wanted, and the train they should actually take — is the
number one metric to optimise. Everything else in the app is either evidence
that feeds it or a place to fall back to when it is wrong.

What "reading the user's mind" means in practice:

- Opening the app on the way to work shows the next train to work, from the
  station the user is actually near, enriched by location, past rides,
  behaviour and likely intent.
- Opening the app later that day shows the way home: the reverse trip and
  the train to take. The user only ever has to teach the app A→B; the app
  suggests B→A itself, every time.
- When a trip is focused ("I'm on this train"), the header becomes
  turn-by-turn directions: where you are on the journey, what to do next,
  which platform, how many minutes. A person just follows what it says.

Three rules govern how the header earns that trust:

1. **Confidence before cleverness.** A wrong guess reads as buggy and
   useless, not as clever. The header only makes a leap when the signals
   justify it; when they do not, it falls back to the safest answer (the
   trip the user last looked at, or the first saved trip) and says nothing
   it cannot back. Being smart is about gathering better signals — user
   actions, focus and completed rides, geolocation, time of day, day of
   week, search history — not about guessing harder from weak ones.
2. **Every leap comes with a receipt.** A short line explains why this
   answer was chosen, in proportion to the size of the leap the app made.
   Standing at Rhodes and being shown the Rhodes trip explains itself and
   gets no receipt. Being shown the reverse of a trip earns "You rode out at
   09:24. Here's the way back." Picking with no location fix earns "You ride
   this most weekday mornings." A trip the user focused by hand needs no
   receipt at all. The receipt is what keeps surprise from turning into
   suspicion, and it is what makes the app feel personalised rather than
   presumptuous.
3. **Correction is one tap and never a confession.** Every saved trip is
   listed under the header, ranked by the same score, with the predicted one
   on top. Tapping another trip IS the correction; there is no "I'm not on
   this" control and no configuration of the heuristic. A control that
   exists only to correct a rare inference is chrome.

Two honesty disciplines carry through all header copy: sentences about the
TRAIN are always safe ("the 09:24 arrives 10:08"); sentences about the PERSON
are inferred ("you arrive") and are used only where the user's own action
(focusing) supplies the warrant. And a count or claim about the user's own
behaviour must name what it really measures — app opens are looks, not
rides.

The signals, scores and storage the header runs on are the binding contract
in `docs/contracts/client-storage.md` (prediction heuristic, geolocation
term, home-station inference, completed rides, focus). Change the behaviour
there and here in the same change. How the header looks and the states it
moves through are binding in `docs/contracts/ui.md`.

## Product principles

1. **Zero-tap answer.** The home screen answers instantly. Everything else
   is one tap away, and one tap back.
2. **Usability for humans is paramount.** Every change is questioned against
   whether it improves or degrades usability and intuitiveness. Concretely:
   - It is never unclear whether something can be tapped, or what a figure
     is telling you. Rows read as rows, buttons as buttons, and every
     number states its provenance (`SCHEDULED`, `6 MIN LATE`, `AGO`).
   - Visual standards are consistent across every screen — one language
     (`docs/contracts/ui.md`), pixel-accurate against the calibration exemplars,
     measured by instrument rather than judged by eye.
   - Responsive to the phones people actually hold: primary actions in
     thumb reach, tap targets ≥44px, six whole services on a 412×732 Android
     with its browser chrome showing.
   - Fast: paint from cache immediately, refresh live, no spinner on the
     happy path. The experience bar is measured by `tools/measure-open.js`.
   - **Offline is a first-class citizen.** Reception on train lines is
     spotty. The shell installs, the last board is always viewable, a
     focused journey stays viewable after it departs, and a stale board
     tells the truth (clock times, `OFFLINE · LAST UPDATED X AGO`) rather
     than counting down from an old cache.
3. **Routes and transfers just work.** Journey planning must be good enough
   that the user never wants to configure it. No "max transfers" setting, no
   "prefer fewer changes" toggle. The server applies a tuneable minimum
   connection time so unreasonably tight trips are never shown; the UI's
   tight-change treatment fires only for connections that were reasonable
   when planned and degraded since. Any configuration surface anywhere in
   the app must be genuinely justified — the default posture is that there
   is none.
4. **Honest states.** Delays, cancellations, scheduled-only and stale data
   are visually distinct and never buried. The past register is decided by
   the data, never by row age: a punctuality claim appears only where there
   are actuals. No "on time" verb — only exceptions are named.
5. **No ads, no accounts, no tracking.** All personal data (saved trips,
   history, rides, location fixes) lives on the device. The server never
   sees who you are. This is a product guarantee, not an implementation
   detail.
6. **Subtraction is the default.** Under "every affordance earns its place",
   iterate by deletion. The round that produced the current design deleted
   REVERSE, EARLIER/NOW, EDIT, the "on time" verb and the focus strip.

## What the app is today (board v2, locked 2026-09-02)

- **Home** is the open state: the smart header (next train for the predicted
  trip and direction, from-station above departure time, to-station above
  arrival time, the journey bar, the receipt) above the saved-trip rows
  (stacked line colours + `T` badges, device-only facts such as distance and
  last ridden, never a live fetch per row). The only management affordance
  is `+ New trip`; the web list is a ten-trip LRU.
- **Board** (`#/board`) is a now-anchored timeline for one trip and
  direction. It lands at now, scrolls up into the past (past rows are future
  rows, dimmed, counting up with `AGO`), rows rank by departure and carry
  three facts in one area — minutes, platform, line colour — with a journey
  bar drawn as a percentage time axis (0.0px deviation is the standard) whose
  transfer is a real gap bracketed by the alight and boarding platform
  numerals. The board is a browser you come back from; it never carries a
  strip.
- **Journey detail** (`#/journey`) is one tap from any row: every leg with
  both platforms, the change station and computed change time, the tight and
  cancelled treatments, and the focus action.
- **Focus** returns you to home and turns the header into directions:
  `TO CHANGE` / `TO GO`, the boarding platform cap disappears once boarded,
  a continuous progress marker travels the bar driven by timetable and live
  estimates (never continuous tracking). Once the trip is over, home offers
  "Show the way back", which fetches a REAL return journey with its own
  transfer platforms.
- **Setup and add-trip**: recent searches per field, fuzzy-ranked station
  typeahead, one full-width save action. Geolocation is asked contextually
  once the user has two or more trips, never on first load, and denial
  degrades silently.
- Dark is the primary scheme; light is derived by measurement and shipped.

Exact geometry and the driven flows are recorded in
`docs/backlog/board-v2/VERIFICATION.md`.

## Design authority

`docs/contracts/ui.md` is authoritative for current UI behavior and names the
calibration assets for the board, home and directions header. Build against
the images and judge every affected screen side-by-side with them.

It is authoritative, not final: it should be iterated on wherever an
improvement is believed. The way to iterate is another comps round (below),
never a redesign in product code. When the owner rules, the ruling is folded
into the UI contract immediately, so later briefs cite the contract and never
the chat.

## How design work is done: comp boards

The endorsed way to change how the app looks or behaves on screen is the
comps process that produced board v2 (`docs/backlog/board-v2/DESIGN.md` is
the worked example, six rounds from playtest complaints to a locked design).
The `design-comps` skill carries the full method; the shape is:

1. The owner's complaints or intents, near-verbatim, are the spec.
2. Three to five genuinely divergent throwaway HTML comps in `/tmp`, built
   from the product's REAL css (`web/app.css` copied, not re-typed) and REAL
   data (`tools/fixtures/`), shot headless at the standard frames (390×844
   and 412×732, dark and light), including every stress state (delayed,
   cancelled, tight change, longest headsign, past, deep scroll).
3. A contact sheet the owner opens in a browser, with a recommendation and
   an honest "why this might be wrong" per direction.
4. Owner verdict → the winner becomes the calibration exemplar → iterate on
   it, stealing the best organ of each loser → amend `docs/contracts/ui.md`.
5. Only then a build brief, written against the exemplar image.
6. After implementation and verification, migrate every surviving contract,
   seam and current calibration asset out of `docs/backlog/<round>/`, update
   references, and delete the whole backlog folder. Do not keep build plans,
   verification reports, rejected comps or other history outside git.

Because this loop is how the product moves, **the tooling that makes a
high-quality, detailed comp board cheap and fast is product infrastructure,
not scaffolding.** Each round so far has re-inherited a `shoot.js`, a
`base.css`, a `data.js` and an `index.html` sheet by copying the previous
round's; the repo tools (`tools/screenshot.js`, `tools/shoot-states.js`) hold
the instrument traps that make a screenshot trustworthy (viewport clamping,
missing viewport meta, invisible overflow, orphaned Chrome, lazy localStorage
flush). Any session touching this loop should leave it cheaper for the next
one: reusable harnesses over per-round copies, documented traps, measured
probes (tap targets, scroll position, axis geometry) alongside the shots.

## Shape

Thin-client PWA + stateless Go caching proxy in front of Transport for NSW
Open Data. Precise interfaces in `docs/contracts/`.

```
Browser (localStorage: trips, history, rides, focus, home, searches, cache)
  ├─ static shell ─────────── service worker, cache-first, VERSION-bumped
  └─ fetch /api/v1/... ────── JSON, CDN s-maxage ~30s (shared across users)
                └─ Go backend (stateless cache/proxy, in-memory TTL cache,
                   single-flight, stale-on-error) ── TfNSW Trip Planner API
```

## Key decisions

- **Thin-client PWA, not htmx** (2026-08-31). Static shell, ES modules, JSON
  API. Chosen because it is the fastest place to iterate a design, for
  installability and offline last-known data, and so native clients can
  reuse the same API.
- **Native clients are native: Kotlin on Android, Swift on iOS**
  (2026-09-02). Performance is a pillar, and a glance app is cold-launched
  dozens of times a day, which is where a PWA loses to native. Wrapping the
  PWA was rejected because the extra layer costs feel; Flutter was tried and
  deleted because it costs the native feel it was meant to buy. See "Native
  clients" below for how the ports stay in sync.
- **Backend: Go.** Single static binary shipped as one image with `web/`
  baked in.
- **Personalisation is client-side only.** The load-bearing decision:
  because the server holds no user state, every API response is keyed only
  by station pair (and time bucket) and is CDN-cacheable across all users.
  Adding server-side user state needs an owner ruling.
- **Home is the open state, the smart header is the answer** (2026-09-01,
  superseding "the departure board is the screen"). The board is one tap
  away.
- **Focusing a trip is consent** (2026-09-01). It settles the honesty
  question for directions: the user's intentional action is warrant enough
  to speak about their trip, and focusing something else is the correction.
- **Prediction stays simple and documented.** Time-of-day + day-type +
  recency over view history, multiplied by a one-shot geolocation term and
  informed by completed rides and inferred home. Deterministic given
  (storage document, now, fix), and unit tested.
- **The progress marker is continuous** (2026-09-02), inferred from the
  clock rather than observed. The known gap — right trip, wrong service — is
  accepted until it bites in real use.
- **Trains and metro only** for now; station search exists only to set up a
  saved trip; no general trip planner.

## Core user flows

1. **Daily use (the whole point):** open app → the smart header shows the
   next train for the trip you almost certainly want, with a receipt if it
   made a leap → tap it (or a trip row) for the board → tap a row for
   detail → focus it → home becomes directions until you arrive → later,
   home offers the way back.
2. **First run:** welcome → search origin → search destination → trip saved
   → home.
3. **Manage trips:** `+ New trip`; the list is a ten-trip LRU on the web
   (swipe-to-delete belongs to the native clients).

## Native clients

The web app is the permanent design lab and the reference implementation.
Every round runs comps → verdict → web build → exemplar shots first, because
the browser is the cheapest place to iterate and the exemplars come out of
it. The native Android (Kotlin, Compose) and iOS (Swift, SwiftUI) apps are
ported afterwards, against those exemplars, and deliberately lag by one
round. They exist for what the browser cannot give at native quality: cold
launch, widgets, background location for ride detection, notifications,
preloaded assets.

The ports do not start until three things are stable, checked against the
roadmap gate rather than a feeling of "perfect":

- the contracts in `docs/contracts/` (API, storage document, prediction,
  home inference, rides), because porting logic that the next round will
  change is waste;
- the information architecture (home, board, detail, focus, the state
  ladder), so later rounds change composition only;
- the design system below, so a port copies values and rules rather than
  reading them off screenshots.

### One design truth, three renderers

The authority is layered, and only the first layer is shared as code. None
of the layers constrain the renderer, which is what preserves native feel:
each platform keeps its own text engine, scrolling, haptics and controls.

1. **Tokens** are values: both palettes with their contrast ratios, the line
   colours per scheme, the type ladder (sizes, weights, letterspacing,
   tabular figures), spacing, the tap-target floor, motion timings, the
   provenance vocabulary. One machine-readable file in `docs/contracts/`
   generates the CSS custom properties, a Kotlin object and a Swift enum.
   The web already uses the system font stack, so SF and Roboto on native
   are parity, not drift.
2. **Rules** are prose plus exemplar shots in `docs/contracts/ui.md`: the
   journey bar as a 0.0px-deviation time axis, six whole services at
   412×732, past rows dimmed in type colour. Rules cannot be tokenised; each
   platform enforces them with its own probes.
3. **View models** are the data contract between logic and screen: the row
   model, directions state, home model and journey-bar geometry as plain
   data (figure, unit, provenance word, platform numerals, leg percentages,
   receipt string). Each platform's UI is a dumb renderer of that model, so
   visual parity is a question of numbers and strings, not taste.

The pure logic (about a thousand lines) is written once per platform, not
shared through Kotlin Multiplatform or a compiled core: the web client has no
build step by design, the logic is small and deterministic, and a port
against a fixture suite is one bounded brief. Revisit only if on-device logic
grows into something like a routing engine.

### Conformance fixtures

Behaviour is kept in sync by shared fixtures, not discipline. Each case is
plain JSON: the storage document, a pinned clock, an optional location fix,
optional API responses, and the expected view model. Three thin runners load
the same files: the node test, a JUnit test, an XCTest. Two rules make this
work. The expected output is **generated by the web implementation and
committed**, so a web round that changes behaviour shows up as a diff under
the fixtures directory, and that diff is the native port brief. And outputs
are **canonicalised**: sorted keys, ISO timestamps with offset, Australia/
Sydney computed explicitly regardless of the machine's timezone, numbers to
fixed precision.

### Seeded shots and parity

Driving a UI to reach a state is what makes native verification slow and
expensive. Every client instead gets the three hooks `tools/shoot-states.js`
already gives the web, compiled into debug builds only: seed the storage
document, pin the clock, point the API at a fixture server. Then a shot is
launch, first frame, screenshot: Chromium over CDP for web, a JVM screenshot
test (Roborazzi or Paparazzi, no emulator) or `adb` for Android, a snapshot
test or `xcrun simctl` for iOS. One shared **state catalogue** of seeded
documents, pinned clocks and API fixtures feeds all three shooters.

Comparison happens at two levels, because cross-platform pixel diffs are
never zero (text rasterises differently): within a platform, pixel-diff
against that platform's own golden for regression; across platforms, each
app exports a debug layout dump (row heights, axis marks, tap-target rects,
visible strings) and the parity tool diffs those, with a side-by-side sheet
for the owner's eye. The `../playtest` harness (actor agent plus grader,
real gestures) is the final gate, not the inner loop: it is the only
instrument that exercises scrolling into the past and swiping.

## Working on this project

- Read `CLAUDE.md` for the run, test and deploy commands and the shell
  `VERSION` rule.
- Contracts (`docs/contracts/`) update in the same change as the interface
  they describe and the moment an owner rules.
- Verification is empirical: unit tests for the pure modules, and the
  browser drivers in `tools/` for everything visual — geometry, tap targets,
  scroll landing, offline paint. A green suite is not evidence that a screen
  is right; a measured shot from the real client is.
- Backlog folders (`docs/backlog/<round>/`) exist only while their item is
  active. Start a new folder for a new round; close a completed item into the
  contracts and delete its folder.
