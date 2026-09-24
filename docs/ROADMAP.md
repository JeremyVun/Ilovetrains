# Roadmap

Read `docs/PROJECT.md` first: it says what the product is for, what it is
today and how work on it is done. This file lists only what still needs
doing. The north star is the one in PROJECT.md — **the smart header's
accuracy** — followed by usability, then routing that just works. A
candidate that does not serve one of those needs an owner ruling to be
scheduled.

The owner's playtest notes from real commutes are the spec for each round,
verbatim. Each item below gets its own `docs/backlog/<item>/` folder while
active and is closed into the contracts when it ships.

## Smart header accuracy
Judged by whether the header answers the user's real intent more often, using
the anonymous counters in `docs/contracts/analytics.md`.
- **Better signals over harder guessing**: public-holiday awareness, and ride
  detection once a native client can observe it in the background.
- **Receipt copy**: test the evidence-specific receipts in real use.
- **Focused-journey disruption recovery**: when a later leg is cancelled while
  the user may already be travelling, the smart header switches to the next
  best alternative. Recovery lives in the header, never as a control in the
  cancelled journey detail (`docs/contracts/ui.md`).
- Known accepted gap to watch: right trip, wrong service (missed the 09:24,
  caught the 09:39). The `service` share of `pinned_<kind>` measures it
  (`docs/contracts/analytics.md`); revisit if that share bites.

## Usability hardening
Every item is a measured complaint from a real phone, not a hypothesis.
Standing checks: tap targets ≥44px, six whole services at 412×732, no
ambiguity about what is tappable, no figure without its provenance, offline
paint from the worker, pixel agreement with the exemplars in both schemes.
Comp round first for anything compositional; instrument first for anything
geometric. Observations waiting on an owner ruling:
- After departure the promoted journey-detail row's live `TO CHANGE` figure
  paints in the board's dimmed past-row ink, while the same count in the smart
  header is full ink. Which ink does a live figure on a past row take?
- A journey whose first leg is cancelled has no word on its board step: the
  step is struck and dimmed and still names the service, where the change step
  for the same fact reads `CANCELLED`. Does that step get a word of its own?
- The home top line's `LATE` word sits 4.5px right of the approved comp, and
  cancelled detail's tail strike is 2px where the comp's is 1px. Is either
  drift worth correcting?
- The reverse-direction home frame carries no view-based receipt, because only
  a persisted ride supports a reverse receipt. Does a view-based one exist at
  all?
- A lost connection with no recovery candidate draws both legs with the two
  platform chips touching (`home-390x844-lost-none.png`); the comps round drew
  the ridden leg alone. Which axis does the owner want?

## Routing that just works
- Offline searches on closed-line days take minutes: the app's board request
  across the captured Sunday metro gap took 155 s on Android and over 240 s
  in the iOS drive (2026-09-23). The refresh no longer cancels them, so they
  finish. [Offline router speed](backlog/offline-router-speed/design.md).
- Tune the server transfer floor (`MIN_CONNECTION_TIME`) from real
  connections rather than defaults; never show a trip the user would not
  take.
- Disruption and trackwork awareness surfaced on saved trips and in the
  header.
- Stop phones falsely cancelling or dropping replaced trains, and show their
  new platforms and ends: [replacement trips](backlog/realtime-replacements/design.md).
- Full replacement routing on phones was narrowed out on 2026-09-14:
  boarding at stations a replacement adds, services moved into the search
  window, and the declined “No longer stops at {station}” wording. Only
  revisit it with new evidence that riders need it. NSW TrainLink, Metro and
  Ferries replacements, which carry stop sequences, keep exact matching until
  they are captured and checked.
- Replacement updates whose times run backwards. In the 2026-09-06 capture,
  `N782.442.149.128.D.6.91065721` lists Ourimbah to Gosford about an hour
  late. Phones show those feed times for matched stops today.
- Consider locally routing added services without a static timetable trip;
  separate from replacement trips and dependent on complete feed metadata.
- No routing configuration surface beyond the transfer limit row
  (`docs/PROJECT.md`, principle 3). If a case seems to need one, bring it to
  the owner as a routing defect first.
- A journey with three changes renders as shipped code renders it and has
  never had a comps round: on a four-minute middle leg the alighting pin
  draws over and left of the boarding pin so travel order reads wrong, the
  Home header stacks the names on three lines, at font scale 1.3 the six
  pins exceed the axis and the clamp cuts two numerals, and the taller row
  shows five whole services instead of six on a 390 board. Only reachable
  under `No limit`.

## Feedback hillclimbing
Turn the analytics feedback inbox into verified fix pull requests with the
owner approving every merge and release. This repo's share shipped on
2026-09-10: the [automated fixes contract](contracts/hillclimbing.md),
platform and version on feedback, the fixture-backed TfNSW stub and the
checked-in playtest regression suite (`tools/README.md`). The daemon that
runs the loop lives in `~/projects/hillclimb` (its `docs/project.md` and
`docs/backlog/daemon/` hold the design, the trust boundaries and the
cross-repository work); the playtest repair claim and web origin guard, the
analytics `platform` and `client_version` columns, and the infra
`ILOVETRAINS_VERSION` pin are tracked from there.

## Design system and tooling as infrastructure
The comps loop is how the product moves and the native ports copy a design
truth from it (PROJECT.md, "Native clients"). Make one round cost less than
the last and make the ports mechanical. Still to build:
- **Design tokens**: one machine-readable file in `docs/contracts/` that
  generates the CSS custom-property block, the Kotlin object and the Swift
  enum. `web/app.css` stops being the place values live.
- **View-model contract**: the row model, directions state, home model and
  journey-bar geometry recorded as a data contract, so each screen is a
  renderer of data the fixtures can check.
- **Conformance fixtures**: the remaining pure-logic unit tests re-expressed
  as canonical JSON cases (document, clock, fix, API responses in; view model
  out), generated by the web implementation and committed.
- **State catalogue and seeded shooters**: `shoot-states.js`'s state list
  becomes a shared directory of seeded documents, clocks and API fixtures;
  the web shooter reads it and each native shooter reads the same catalogue.
  `tools/comps/scenarios.js` is the start of it, but emits mapped view rows
  where `shoot-states.js` seeds API-shaped documents.
- **Parity tool**: per-platform pixel regression against its own golden,
  cross-platform diff of a debug layout dump, and a side-by-side sheet.

- Verification debt: `internal/analytics` has a test-side data race under
  `go test -race`; the `tracker-*` rows of `tools/visual-regression.js` have
  no committed Android or iOS baselines; nine `tools/shoot-states.js` states
  fail their invariants on main (`home-over`, `home-arrived`, `past-register`
  and siblings); the older playtest baseline transcript is garbled.

## Native Android and iOS
Both apps exist (`android/`, `ios/`) and lag the web by one round. Remaining:
- Background ride detection and notifications.
  OS-rendered artifacts (icons, widgets) pass through the real renderer
  before a verdict.
- **Sleepers icon delivery**: the artwork, `tools/make-icons.sh` and the
  worker VERSION bump are in main, and the real iOS SpringBoard render is
  accepted. Still owed: the Android launcher rendered through the real
  adaptive mask, and a returning service-worker profile picking up the new
  PWA icon bytes on the next app deployment.
- Physical iPhone verification, waiting on a connected phone and an Xcode
  account sign-in (`docs/operations/ios.md`).

## Candidates (unscheduled)
- **Travel tracker follow-ups** (the tracker shipped in 1.6.0; contracts in
  `ios-deviations.md`, `android-deviations.md`, `native-data.md` and
  `client-storage.md`): platform-number boxes on the trip line in the app's
  visual language, which the owner wants to see but has not required; and
  the iOS verification drives accepted as limits on 2026-09-10: enlarged
  text, the 390-point phone, the minimal Dynamic Island and VoiceOver.
- **Ride history as a stat**: "you rode this 4 times this week" in the
  saved-trip row's meta, beside "last ridden Friday". Count only what can
  actually be observed; a count inferred from app opens is a count of looks
  and must be named as such. Needs background ride detection first.
- General A→B trip planner.
- Other modes: bus, light rail.
- Metro loose ends worth a live probe when a key is at hand: the only metro
  fixture answered three journeys when asked for six on a ten-minute headway,
  and no metro-only station has been searched live.
