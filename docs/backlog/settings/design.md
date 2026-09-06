# Settings

Design session started 2026-09-05. This is a new settings surface, not a
theme-picker sheet: it earns a place because it groups durable, rider-owned
choices that affect the answer. C1 Grouped buttons is visually approved.
Owner ruling, 2026-09-06: web mode replacements use the TfNSW Trip Planner
path; native offline routing in `../timetable-realtime/design.md` is deferred
and no longer a dependency. The owner authorized the existing API refresh pattern and an in-memory
feedback draft on September 6; see Build authorization below. Feedback submit/retrieve
verification remains a release gate.

## Build authorization — 2026-09-06

Owner: “For now, we are focusing on web, so we just have to follow the same
pattern here of fetching from the api again (which is a wrapper around tfnsw
trip planner). Feedback drafts should indeed survive navigation, but don't
overcomplicate it. Proceed with building out the approved comp.”

This supersedes pending owner calls below. Re-fetch through the existing
stateless departures API on service changes, supplying a canonical mode
allow-list and separating cache entries by it. Keep eligible cached results
while fetching; all-off makes no suggestion request. Followed journeys keep
independent updates using all served modes. Feedback category/message live in
one in-memory object for this app visit, survive route navigation, and clear
only after successful submission; reload closes the visit. No draft storage.
Proceed with implementation in this session as explicitly requested.

## The owner's words

Latest steer, 2026-09-05 (binding over the first-round draft):

Final composition verdict: “yep, c1 is definitely the winner.” This selects
round 2's C1 Grouped buttons, not round 1's unrefined Ledger.

Replacement behavior verdict, 2026-09-05: “nah, should definitely feel live.
replacements shoudl come in appropriately.” Filtering only the first six
returned journeys without looking for replacements is rejected. Mode changes
must replenish the live answer with eligible alternatives where available;
the retrieval mechanism must be verified before the build plan is ready.

Earlier architecture verdict, 2026-09-05: “yea i agree. deltas will be annoying to
get right. Ok lets go with this. static timetables + dynamic realtime stuff
overlaid on top”. This originally moved replacement retrieval to local routing.

Superseding platform ruling, 2026-09-06: “yea, so the web experience will have
to use the tfnsw planner, that's fine. i dont see any other choice.” The owner
deferred offline timetable routing to the mobile apps. Web replacement
retrieval now stays on TfNSW Trip Planner; the proposed server `modes` query
can be designed and verified on that basis. C1, live replacements and the
followed-journey ruling remain approved. Exact query/cache semantics are not
settled by this architecture choice.

1. “what happened to the settings cogwheel icon?”
2. “yea use ledger, but tidy it up so it looks nicer. currently looks like
   a mis mash of stuff with no cohesive structure.”
3. “it's a toggle, followed by an expand, followed by a toggle, followed by
   nothing for buses (this should just have the toggle off and disabled for
   now), then suddenly appearance section with no spacing.”
4. “instead of toggles for ferries, buses, trains, metroes, can they be
   respective iconographic buttons that you click to enable / disable?”
5. “Think of a better way to represent the appearance options as well.”

The approved round-2 C1 keeps Ledger's direct one-page approach, restores the
settings cog, and uses a coherent family of service and appearance controls.
Buses has the same control shape, off and disabled. Labels and explicit
selection markers remain part of the approved icon buttons. The prior
mixed-control composition and spacing are rejected.

- “I think it'd be good to have a settings menu. To see app version, turn
  on/off geolocation, change theme, disable enable bus/ferry etc. And let
  people submit feedback for analytics. Maybe also let them set their home /
  anchor station if they want (we can show what we are inferring it to be here
  too if only for debugging / development).”
- “for the setting to set a home override, there should be a way for the user
  to effectively go ‘hey, i want to go back to the auto mode’.”

## What it is

`#/settings` is a short, one-column settings page reached from the home
footer, beside `+ New trip`. The entry is an outlined cog followed by the
visible `Settings` label, as approved in round 2. The earlier text-only
choice is superseded.

The page keeps the home screen's printed-timetable language: masthead, heavy
rule, edge-to-edge rows, one action rail and no card grid. Back returns to
home in one tap. Settings never interrupts the first answer or sits in the
home masthead.

It contains Location, Home, Services, Appearance, Send feedback and the
installed release version. Personal groups Location and Home; Services and
Appearance each have a dedicated choice group with deliberate spacing.
Feedback and version sit in quieter rows below, without Help/About headings.

The page is a rider-facing control surface. It must not describe internal
prediction scores, analytics buckets, request data or other developer-only
details. “Automatic” is the ordinary name for inferred behaviour.

## Rulings

### Entry and navigation

- The home footer contains two equal-width, 56px-high targets: `+ New trip`
  at the left and cog + `Settings` at the right. The one-time location prompt continues to
  temporarily occupy that footer, exactly as it does today; after `Not now`,
  `Use my location`, or a permission result, Settings returns.
- Settings is available only from home. It is not added to board or journey
  detail, where the rider needs the departure and one-tap back path.
- Every preference applies immediately, persists only on the device, and is
  never sent to the train API. A changed preference re-renders the active home
  answer without creating a new prediction/history event.

### Appearance

- `Appearance` offers a three-item mutually exclusive chooser: `System`,
  `Light`, `Dark`. Absence means `System`.
- System follows `prefers-color-scheme`; Light and Dark override it before
  first paint, including browser chrome/theme colour and every existing light
  palette exception. The manual choice wins over later system changes until
  the rider selects System.
- The existing dark and light palettes remain the binding visual language.
  This feature selects a palette; it does not redesign either one.

### Location

- `Use location` is an app-level preference, default on. With it off, the app
  neither requests permission nor reads a fix, even if the browser has already
  granted permission. Location-derived prediction and travel inference fall
  back to the existing no-fix rules; saved station coordinates remain local.
- Turning it on invokes the existing explicit permission flow when permission
  is `prompt`, or silently resumes fixes when it is already `granted`.
- A browser-level denial cannot be undone by a website. The row states
  `Blocked in browser` and gives plain instructions to enable location in the
  browser or installed-app settings. It must never claim that the toggle has
  changed browser permission.
- The contextual home/setup permission prompts remain the first opportunity to
  ask. Settings is the deliberate later correction and must not create a new
  prompt on page load.

### Home

- The Home row always names the current automatic home, when one is available:
  `Automatic — Rhodes`, for example. It uses `homeOf()`'s existing seven-day
  vote rule and fallback first-trip origin, not a second inference.
- `Set home station` opens the existing station search, writes a local
  `homeOverride` stop, and immediately makes that stop the home used by
  location-first selection.
- While overridden, the row reads `Home — <station>` and exposes `Use
  automatic home`. That action removes only `homeOverride`; it retains the
  daily votes and immediately returns selection to the current automatic home.
  The phone keeps collecting eligible daily votes while overridden, so
  automatic mode is current when restored.
- The override is local, optional and malformed values are dropped. It does
  not alter saved trips, history, rides or the location fix.

### Services

- The current app serves train, metro and ferry. Round 2 approves separate
  labelled icon buttons for `Trains`, `Metro`, `Ferries`, and `Buses` per the
  owner's steer. Served modes start enabled and can be enabled/disabled
  independently; Buses is off and disabled until supported. The earlier
  always-on rail restriction is superseded. The API already supplies each
  service leg's mode; excluding a train+metro connection when one of its
  modes is disabled is the deliberate effect of this filter, not a technical
  impossibility. An all-served-modes-off state needs explicit empty-state
  treatment in the second round.
- Disabling `Ferries` excludes journeys containing a ferry leg from live
  results and prediction;
  it does not delete existing saved trips, caches, history or rides. A saved
  ferry trip is shown as unavailable with a one-tap `Turn on ferries` action,
  rather than silently disappearing.
- A journey already being followed stays intact if one of its service modes
  is disabled. Do not clear its focus or stop its directions; apply the mode
  preference to future suggestions. This exception applies to train, metro
  and ferry, including when every served mode is switched off. Owner ruling,
  2026-09-05: “yes agreed”, confirming the recommendation to preserve the
  followed journey.
- Mode changes must produce eligible replacements, not merely remove results
  from the current six. Retrieve alternatives through the web's TfNSW Trip
  Planner path. Keep eligible existing results visible while the new request
  completes; never restore excluded journeys as a fallback. Request failure is not proof
  that no route exists. All-off suppresses new suggestions, but does not
  suspend updates to an already-followed journey.
- `Buses` uses the same selectable-control shape as the served modes, off
  and disabled, with `Not available yet` where needed to explain its state
  (owner ruling, 2026-09-05). Bus routing is unscheduled; it needs its own upstream,
  reliability and mixed-journey design before this setting can control it.
- The mode contract is an allow-list of journey service modes. A
  mixed-mode journey is eligible only when every service leg's mode is enabled;
  walking legs do not count. This rule lets a later bus setting use the same
  seam.
- Service buttons are independently selected (`aria-pressed`), with visible
  labels and an on/off marker beyond colour alone. Buses is unselected and
  disabled, never merely an enabled button whose click has no effect. The
  stored list accepts only supported modes; an injected `bus` entry cannot
  enable unavailable routing.
- Appearance is a single choice, with radio semantics and exactly one of
  System, Light or Dark selected. Its geometry and icon treatment may share
  the service-button family without pretending both groups select the same
  way. Keyboard and focus states are part of the build contract.

### Feedback and analytics

- `Send feedback` opens a short form with a required fixed category (`Problem`,
  `Suggestion`, `Other`) and a required message. Copy says: “Don’t include
  personal details.” It does not ask for name, email, trip, station or
  location.
- Submission is an explicit `POST /feedback` to the shared analytics service,
  project `ilovetrains`; it is not an anonymous analytics event and never
  shares its message with `/e`, the train API, localStorage or the service
  worker cache. The only post-success counter may be the content-free
  `feedback_submitted` event, and it obeys the existing DNT analytics
  policy.
- Clear the message only after `201 Created`. A failure preserves it and offers
  `Try again`; validation, rate-limit and offline copy describe the next action
  in plain language. The client sends no feedback key unless the deployment is
  configured with a browser-shipped per-project bot-hurdle.
- Before release the analytics deployment must enable feedback with Postgres
  and protected operator access, through its existing trusted Authelia proxy
  or an operator-held read key. A read key is optional with that proxy.
  Operators, not clients, receive listing, export and deletion capability.

### Version

- Settings shows the deployed release identifier as `Version <git-short-sha>`.
  The Docker build receives the git revision as an explicit build argument and
  writes a shell-cached, static `version.js`; local development reports
  `Version dev`. The value contains no build host, time, user or secret.

## Storage and controller seam

The single `trains.v1` document gains an optional field:

```json
"preferences": {
  "appearance": "system",
  "useLocation": true,
  "homeOverride": {"id": "213820", "name": "Rhodes", "location": {"lat": -33.8308, "lon": 151.0879}},
  "enabledModes": ["train", "metro", "ferry"]
}
```

- Omitted fields read as the current behaviour: system appearance, location
  enabled, no home override, and every currently served mode enabled.
- The parser accepts only the closed appearance values and known mode values;
  it normalises the enabled-mode list, permits an empty list, and drops a
  malformed `homeOverride`. This is an additive schema change: keep
  `schemaVersion: 1`.
- Missing or non-array `enabledModes` reads as all three served modes;
  an explicitly empty array stays empty. Valid arrays deduplicate and retain
  only `train`, `metro`, `ferry` in stable order. Do not use a truthiness or
  length fallback that turns an intentional all-off choice back on.
- `homeOf(doc)` first returns `preferences.homeOverride` when valid, otherwise
  its present vote/fallback result. Vote recording is deliberately unchanged.
- `validFix`, contextual asking and location-triggered routing consult
  `preferences.useLocation` before reading browser APIs. Toggling it off clears
  only in-memory fixes; it never writes a coordinate.
- Live/cached result selection uses the enabled-mode allow-list. Preferences
  remain stored on-device. Design mode-aware replacement requests through the
  stateless web planner, including canonical query values, cache separation
  and upstream exclusions; no server-side preference profile. The six-result-only
  filter remains rejected. Native timetable routing is not required.
- Mixed-mode eligibility is conjunctive: a train+metro journey needs both
  modes selected, and a train+ferry journey needs both of those selected.
  The previous rail-only special case must not survive in parsing, cached
  selection or automatic inference after independent controls are added.

## Rejected alternatives

- **Appearance-only sheet:** rejected because location, home, feedback,
  services and release identity now form a coherent durable set.
- **A generic Settings category sheet:** rejected for the first screen; a
  category heading around a single appearance choice was empty chrome. The
  full page earns sections because it holds several real controls.
- **Browser permission as the setting:** rejected because the app cannot
  revoke a browser grant or restore a denial. The setting controls whether the
  app uses location and accurately reports the browser state.
- **Deleting home votes when automatic mode returns:** rejected because it
  makes “Use automatic home” forget what the phone learned. The override is a
  temporary precedence rule, not data destruction.
- **Plain noninteractive Buses text:** superseded by the owner's 2026-09-05
  ruling: show the same control shape, off and disabled until available.
- **Putting feedback text in anonymous analytics:** rejected because feedback
  is user-authored durable content with its own retention, operator access and
  deletion path.

## Required design round

Use the `design-comps` workflow before implementation. The comp brief must
use real settings copy and the current home visual grammar, and show:

- 390×844 and 412×732 in dark and light;
- home with the two footer actions, the transient location prompt, the full
  settings page, each chooser, home override search/result, ferry-disabled
  saved trip, feedback validation/offline retry and About;
- a longest station name and all controls at the 44px floor;
- a fresh manual appearance choice applied before first paint and System
  following a media change.

The calibration outcome replaces/adds only built-client frames in
`assets/comps/latest/`; no workshop frame becomes durable evidence.

## Build seams and verification

The future `build_plan.md` must phase the work so each seam is independently
testable:

1. Preferences parse/serialise plus prediction/location/mode pure logic and
   unit tests.
2. Appearance bootstrap, theme-colour update and service-worker versioning.
3. Settings route, home footer, station search, permission-state UI and
   accessible controls.
4. Feedback form against the `/feedback` contract, with deployment enablement
   and synthetic end-to-end verification.
5. Shooter states, updated calibration frames, contracts and deployment.

The mode integration gate is a verified web request/cache contract against
TfNSW Trip Planner: eligible replacements, mode-specific cache keys, all-off
behavior and independent followed-journey updates. Add its implementation and
verification phases once designed. Native timetable routing is not a gate;
a six-only filter still does not meet the replacement behavior.

The browser drive must prove both schemes, persisted choice after reload,
System media changes, granted/prompt/denied location states, automatic-home
restore with retained votes, mode-filtered mixed journeys, feedback success and
retry, 44px targets, no horizontal overflow and reachable last content. Run
`go test ./...` and `(cd web && npm test)` after the implementation. Any shell
file change bumps `web/sw.js` `VERSION` in the same change.

## Remaining design decisions

1. The main-page composition is approved: round-2 C1 Grouped buttons. Keep
   round 1's unchanged search and feedback subflows; no category navigation.
2. Confirm a synthetic feedback submission commits and an authenticated
   operator can retrieve it before release. Infra documentation reports
   feedback enabled with Postgres and Authelia; read-only checks below prove
   routing, not a successful write.
3. Feedback-draft lifetime needs owner alignment. The web mode-aware
   request/cache contract needs design and live verification in this item.
   Release identity wiring has been inspected and is proposed below.

## Design audit — 2026-09-05

Checked implementation facts and proposed seam clarifications follow. These
are not an owner comp verdict; no product implementation has started.

- `predict.js:homeOf()` returns `{station, confidence}`, not a bare stop.
  Extract its vote/fallback calculation as `automaticHomeOf(doc)` and let
  `homeOf(doc)` apply override precedence with a distinct source. Settings
  can show the automatic result while overridden. Seven votes means seven
  recorded daily first opens, not necessarily seven consecutive days.
- Home receipt copy currently follows `confidence`. A manual override must
  not masquerade as three votes. Proposed receipt: `You set <station> as
  home.` It states the evidence the app actually has.
- `setup.js` owns a two-field trip form and emits setup analytics. Reuse
  `search.js` ranking, normalization, hints and API semantics for a
  single-station home picker; choosing home must not save a trip or emit
  setup events.
- Turning location off must increment `geoGeneration` to invalidate pending
  requests as well as clear the fix and gate future calls. Guard setup's
  permission, nearest-station and location-row paths too. A late granted
  callback must not restore a fix after the preference is off.
- Because `useLocation` defaults on, a browser still awaiting permission
  needs a deliberate `Use my location` action in settings without requiring
  an off/on detour. Permission lookup may report status while the app
  preference is off, but must not request permission or obtain a fix.
- Store raw API bodies unchanged. Apply one journey-eligibility predicate
  to live/cached home, board/past rows, redirects, `noteLastOpen` and new
  travel inference. Check every `legDetail` mode: the top-level line misses
  a ferry after a train. Walking is already folded into transfer gaps.
- Prediction ranks station pairs, not journeys; saved trips have no fixed
  service mode. A cached ferry journey is evidence about that result, not
  proof that the pair has no rail alternative. Unknown/uncached pairs need
  an explicit eligibility outcome rather than a ferry-only label inferred
  from a line badge.
- Home falls back to the first cached journey when the current body has no
  journeys. That fallback must also be filtered or it restores an excluded
  ferry.
- Appearance has two light-media blocks in `app.css`, including filled-chip
  ink, and two media-qualified `theme-color` tags in `index.html`. All must
  follow manual selection. Update `theme.test.js`'s media-only assumptions
  while retaining palette assertions.
- Returning from settings must retain selection provenance:
  `chooseSelection()` currently treats any saved in-memory selection as
  explicit. Separate preference recomputation from exposure/history writes.

### Feedback facts and release seam

Checked against `../analytics/README.md`,
`../analytics/server/internal/feedback/feedback.go`,
`../analytics/server/internal/api/feedback.go` and
`../projects/stacks/analytics/{README.md,docker-compose.yml}`.
The analytics README's `docs/FEEDBACK_SPEC.md` link is stale; the file does
not exist in this checkout.

- Endpoint: `https://analytics.jeremyvun.com/feedback`. Body:
  `{project: "ilovetrains", category, feedback}`; omit rating and metadata.
  Category/message are required after trimming. Message limit: 8,192 UTF-8
  bytes. Entire JSON request limit: 10,240 bytes. Reject NUL. Validate both
  encoded sizes; JSON escaping can exceed the body limit independently.
- `201` follows commit. `400` is invalid input, `413` too large,
  `401`/`403` submission-key failure, `404` disabled, `429` rate limiting,
  and `503` storage unavailable. Never display raw response text. Defaults
  allow five attempts per ten minutes, including failed attempts. A lost
  response can leave a committed record; retry may duplicate it, so retries
  must be deliberate.
- Proposed transport: omit credentials and referrer; no logging or
  persistent draft; a form-scoped in-flight guard prevents duplicate taps.
  Draft lifetime and navigation behavior still need a design ruling.
- `Retry-After` is not exposed through the service's CORS headers. A browser
  cannot rely on reading it. Use generic wait/retry copy unless a separate
  analytics change exposes it.
- Infra Compose supplies Postgres and explicitly enables trusted operator
  proxy authentication. Authelia gates feedback GET/DELETE and UI; POST and
  OPTIONS remain public routes. No environment files were read.
- Read-only production checks on 2026-09-05: feedback OPTIONS returned
  `204`, allowed POST and Content-Type, and `Cache-Control: no-store`;
  unauthenticated feedback GET returned `302` to Authelia. These prove CORS
  and the operator gate, not enabled submission, key policy or DB health.
  Synthetic submit/retrieve verification remains a release gate.

### Release identity seam

`Dockerfile` copies `web/` into the runtime image; `docker-bake.hcl` has no
revision input. Infra only runs that image. Proposed implementation: add
`ARG GIT_REVISION=dev` to the runtime stage, passing a short git SHA through
`docker buildx bake --set ilovetrains.args.GIT_REVISION="$(git rev-parse --short=12 HEAD)" --push`.
Validate the value as `dev` or a hexadecimal revision before generation.
Generate `version.js` inside the image after copying web assets; keep the
checked-in module at `dev`. Add it to `SHELL`. A returning browser must show
the revision of its installed shell, including offline.

### Pending owner calls

1. Keep a feedback draft in memory while navigating within this app visit
   (recommended), or discard it on leaving the form. Neither option writes
   the draft to device storage; closing/reloading the app loses it. Asked
   during this round.

### Live replacement retrieval — web Trip Planner

Owner ruling, 2026-09-05: “nah, should definitely feel live. replacements
shoudl come in appropriately.” The six-only/no-refill proposal is rejected.

The September 6 platform ruling supersedes the local-planner dependency.
Web keeps TfNSW Trip Planner; `../timetable-realtime/design.md` is deferred
to native offline work. Design and verify mode-aware web requests against
upstream. This is the selected web architecture, not a temporary bridge with
a planned removal date.

Integration invariants survive the architecture change:

- Invalidate outstanding suggestion work immediately on a preference change.
  Guard asynchronous success AND failure against rapid off/on changes,
  including returning to the same mode set. A station-pair-only guard is
  insufficient; reroute without waiting for a periodic realtime refresh.
- Results must record the mode set and source freshness they were retrieved
  for. Enabling a mode requires a new eligible search; a narrow-mode result cache
  is not a complete answer for the wider set. Preserve source freshness and
  never mark old data live just because preferences changed.
- The followed journey keeps receiving matching realtime updates regardless
  of suggestion mode preferences. Keep its selected identity separate from
  candidate filtering so preservation cannot reintroduce excluded suggestions.
- Offline/stale responses and upstream failures must remain distinct from a
  completed search finding no eligible journey.

The mode-aware request/cache interface must be verified before this Settings
integration is build-ready. API/cache/storage contracts change alongside
their implementation; this document does not claim mode queries already exist.

## Visual round 1 — Ledger selected, refinement required

Workshop: `/tmp/trains-comps-settings-01`; sheet:
`/tmp/trains-comps-settings-01/index.html` (opened on the owner's desktop).
`OPTIONS.md` and full-resolution frames stay in that workshop. No
workshop image has replaced a built-client calibration frame.

Three compositions cover the same feature set:

- **C1 Ledger:** direct location/ferry controls and appearance chooser on
  the main page. Recommended: all measured rows fit at 412×732 without
  scrolling, in both schemes.
- **C2 Chapters:** four category rows lead to separate pages. Everything
  fits, but common changes take an extra category tap.
- **C3 Register:** current values occupy the board-style figure column.
  At 412×732 the main page has 111px of reachable scrolling.

The current report contains 192 captures at 2× across 390×844 and 412×732,
dark and light, including deep-scroll variants. The comp agent inspected all
16 scenario matrices and repeated the visual review after fixes. Its overflow, small-target,
text-spill and clipping checks report no failures. These are mock-layout
measurements; they do not prove persistence, real browser permission flow,
feedback transport or service-worker behavior in the built client.

Iteration corrected the textarea's browser-default font, restored a direct
change-station action beside automatic-home reset, removed the unsupported
bus timing claim `Soon`, and separated System appearance from Automatic
home.

Owner verdict, 2026-09-05: “yea use ledger, but tidy it up so it looks
nicer.” Carry forward C1's direct page and existing product typography,
palettes and navigation. Reject its alternating control types, ungrouped
service settings, inconsistent disabled-bus presentation, appearance
treatment and section spacing. Restore the settings cog. The numbered
owner comments at the top of this document are the round-2 brief.

The build plan remains pending the refined composition verdict and the
behavior calls above. Selecting Ledger did not answer the earlier active
journey, extra-fetch or feedback-draft questions.

## Visual round 2 — C1 Grouped buttons approved

Workshop: `/tmp/trains-comps-settings-02`, inheriting round 1's stylesheet,
real data and unchanged subflows. The round compares three refinements of
Ledger, with the prior C1 frames pinned beside them. It focuses on changed
surfaces: cog entry, main-page grouping, service on/off/unavailable states,
appearance choices, long home names and permission states. All changed
compositions are measured at 390×844 and 412×732 in dark and light.

Round 1's passing geometry was not a composition verdict. Round 2 must
establish a shared control family and section rhythm, make service groups
read as a set, and give Appearance an intentional visual treatment. A
green probe report alone cannot close the owner's cohesion complaint.

Sheet: `/tmp/trains-comps-settings-02/index.html`. The three refinements are
**C1 Grouped buttons**, **C2 Icon rows**, and **C3 Compact grid**. Approved:
C1: one four-button Services group and one three-choice Appearance group,
aligned Location/Home rows above, and quieter feedback/version rows below.
The home entry restores an outlined cog beside `Settings`.

C1's default page fits both phone sizes without scrolling. At 412×732,
C2 needs 157px of scrolling and C3 needs 99px. All three retain explicit
on/off markers and a disabled, slashed Bus icon; appearance previews use the
existing light/dark palettes with a separate selected marker. System's
preview and label align with Light and Dark despite its `Follow device`
subtitle. Redundant palette labels and repeated bus explanations were
removed during review.

The round contains 120 captures at 2×: three refinements, ten changed-surface
states, two sizes and both schemes. The measured tap floor is 44px, with
no horizontal overflow, undersized active targets, text spill or clipping.
These remain mock-layout checks, not proof of working preferences or other
built-client behavior. The home body is inherited verbatim from the first
round's mock; only its footer is under review. Unchanged search and feedback
subflows remain in round 1, not newly verified here.

Owner verdict, 2026-09-05: “yep, c1 is definitely the winner.” Carry forward
C1 in full: cog before Settings, paired Personal rows, four equal service
buttons, three equal appearance choices including System's Follow device
subtitle, section spacing and quiet feedback/version rows. Reject C2's
full-width choice rows and C3's two-column services/asymmetric appearance.
The visual composition is settled. The followed-journey behavior is also
approved in the Services ruling above. Live replacements are required by the
later owner ruling; their retrieval mechanism needs verification.
Feedback-draft behavior remains unanswered.

Build invariants from comp review: preserve the existing home body while
adding the footer entry; retain visible labels and non-colour state markers;
align all appearance preview/label baselines despite System's subtitle;
avoid redundant palette/bus copy; keep Location's pressed action distinct
from browser permission status. Browser tests must cover these in both
schemes/sizes, long Home names, permission states, all-off services and
reachable final content. The default C1 page fits at 412×732; permission
guidance may add 5px of reachable scrolling. Product code is unchanged.
