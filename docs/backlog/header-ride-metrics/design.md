# Header and ride metrics on every client

Stage: ready for build. Execution: [build_plan.md](build_plan.md).

## Owner rulings

- 2026-09-23: "design some good simple metrics for 1 and implement them", where
  1 was: measure the smart header on the phones, not just the web, and count
  whether riders took the trip the header showed.
- 2026-09-23: chose all three metrics below (trip hit rate on every client,
  train match at pin time, completed rides).
- 2026-09-23: phones get no opt-out control. The privacy page discloses the
  counts, as it does for the web; debug and test builds never send.
- 2026-09-24: the privacy paragraph ships as written (Astra's draft, now in
  `site/privacy/index.html`).

## What changes and why

The smart header's accuracy is the product's number one metric
(`docs/PROJECT.md`), but only the web sends header counters. Android and iOS
deliberately left analytics off in native v1 (`android-deviations.md`,
`ios-deviations.md`), so the clients built for daily use are invisible to it.
The web measure is also weak: it treats "tapped nothing" as acceptance.

After this change every client answers three questions, split by platform:

1. **Trip hit rate.** Did the first trip the rider tapped match the header?
   This is the existing `shown_*` / `hit_*` / `miss_*` / `opened` set, now also
   sent by Android and iOS.
2. **Train match.** When a rider pins a service, was it the header's exact
   train, another train on the same trip and direction, or another trip? The
   middle answer is the accepted "right trip, wrong service" gap
   (`docs/ROADMAP.md`), measured instead of guessed.
3. **Completed rides.** One count per ride the arrival reducer records, split
   by how travel mode started (pinned, or entered automatically from location)
   and how arrival was decided (location or estimate). An automatic ride means
   the rider opened the app at the platform, touched nothing, and rode the
   header's answer: the zero-tap promise, observed.

Nothing new identifies anyone. New values are closed vocabularies; no station,
trip, line, time, coordinate or identifier is added to any event.

## Vocabulary

All client events keep the exact `{p, t, d, n}` shape from `analytics.md`.

| Addition | Where | Values |
| --- | --- | --- |
| dimension `pl` | every client event | `web`, `android`, `ios` |
| dimension `pl.u` | every client event | `<pl>.<u>`, for example `ios.6-10` |
| event `pinned_<kind>` | explicit pin, all clients | kinds as today: `predicted`, `focus`, `usual`, `home`, `pair`, `inferred` |
| dimension `r`, composite `pl.r` | `pinned_<kind>` only | `same`, `service`, `trip` |
| events `rode_pin`, `rode_auto` | newly recorded ride, all clients | — |
| dimension `b`, composite `pl.b` | `rode_*` only | `location`, `estimate` |

The web keeps `x.strip-placement` on all its events, including the new ones.
Native events never carry an `x.*` dimension: the strip experiment is web-only,
and an absent variant keeps native counts out of both arms.

The native clients send `opened`, `shown_<kind>`, `hit_<kind>`, `miss_<kind>`,
`pinned_<kind>`, `rode_pin` and `rode_auto`. Setup, location-panel,
`entered_inferred`, `back_*` and `change_inferred` events stay web-only: native
setup and permission flows differ, and porting them is not needed for these
three questions. Both phones save a trip home automatically from an
unsaved station, as the web does, so native sends `pair` too (corrected
2026-09-23 after the Android build found the auto-save).

## Mechanism

### Header kind on native

Native `predict` (Android `Prediction.kt`, iOS `Prediction.swift`) returns a
`Selection`; add the answer kind to it, derived exactly as the web does
(`web/js/predict.js` `locate`, `web/js/main.js` `homeAnswerKind`):

- a visible focus: `inferred` when `by` is inferred, otherwise `focus`;
- the trip saved automatically from here to home during this open, while it
  is the answer: `pair`;
- no station here: `predicted`;
- a station here, with the homeward candidate selected and no habit or
  location winner: `home`;
- a station here otherwise: `usual`.

An explicit user choice (`selectionPredicted == false` without focus) is
browsing: it emits no `shown_*`, as on the web.

### Opens on native

The web counts one open per page load. A phone app stays alive in the
background for hours, so native counts **each user-visible foreground entry
that displays a home or setup answer** (Android and iOS `resume()` from a
backgrounded or cold state) as one open. Each open increments `opens`, emits
`opened` with a milestone when due, and resets the per-open guards: the
first-row-tap classification and the repeated-`shown_*` suppression.
Returning from board or detail to home within one foreground session is not a
new open. This is a recorded deviation: native bands count foreground entries,
not page loads, so compare hit rates across platforms and not band-for-band
open counts.

### Trip hit rate

Identical to the web rules in `analytics.md`, "Event vocabulary and ordering":
`shown_<kind>` when home displays its own answer (suppress an immediate repeat
of kind, trip and direction within one open), the first home trip-row tap per
open classified `hit_<kind>` or `miss_<kind>`, and a pin of the header's trip
and direction also counted as `hit_<kind>`.

### Train match at pin

Trigger: the explicit pin action (web detail `focus`; native `pinJourney`),
only when home displayed its own answer during this open (the same attribution
guard as the pin-time `hit_` rule; setup is excluded). The kind is that
answer's kind. Compare the pinned journey with the header's answer as of the
last home render before the pin, meaning its trip, its direction and the lead
journey it displayed (the recommendation, or the followed journey for
`focus` and `inferred`):

- `trip`: a different trip or direction;
- `same`: same trip and direction, and the pinned journey's identity key
  equals the lead's (web `journeyKey`, Android `Journey.key`, iOS
  `Journey.key`: every service leg's line and scheduled departure);
- `service`: same trip and direction, different identity key.

If the header displayed no lead journey (empty or unavailable board) and the
pin is on the same trip and direction, emit nothing. Each pin action emits at
most once; pinning again later is a new explicit act and emits again. Unpin
emits nothing.

### Completed rides

Emit when the client's arrival settlement appends a ride whose identity (trip,
direction, scheduled departure) was absent from `rides` immediately before
that write. A correction that updates an existing ride's times emits nothing,
and so does a legacy ride restored by migration. `rode_pin` when the focus's
`by` is `focus`, `rode_auto` when it is `inferred` (including after `Change
destination`). `b` is the arrival basis of that completion. An estimate ride
that is withdrawn and later recorded again emits twice; this is accepted
best-effort counting, and `b` shows how much of the total is estimate-based.

### Native storage and enablement

Each native client keeps `{opens, queue}` in its own app-private
`analytics-v1` store (iOS: a JSON file in Application Support, excluded from
backup; Android: a private file or preferences named `analytics-v1`). It is
not part of the personal document and never enters an API request. A
malformed store is dropped whole. `opens` leaves the device only as a band or
milestone.

Sending requires a release build. Debug builds, including unit, UI and seeded
screenshot runs, record the same events into an in-memory ledger and never
persist or send, except when a debug-only override points transport at a local
capture endpoint for verification (iOS launch environment and Android intent
extra, named `ILOVETRAINS_ANALYTICS_URL`, compiled out of release).

### Native transport

POST one JSON array of `{p, t, d, n}` to `https://analytics.jeremyvun.com/e`
with `Content-Type: application/json`, no cookies or credentials, and a short
timeout. Behaviour matches the web queue: compaction by equal name and
dimensions, at most 200 entries with the oldest dropped, counts saturating at
1,000,000, one request in flight, a 2xx response settling only the snapshot
sent (subtract, never clear), and any other outcome retaining the queue. Flush
10 seconds after the first recorded event of a foreground session, when the
app goes to the background (best effort within the platform's background
allowance), and on the next foreground entry while anything is queued. The
queue is validated against the closed vocabulary on read, exactly as the web
validates `trains.analytics.v1`.

### Web changes

`web/js/analytics.js` adds `pl: 'web'` and `pl.u` to every event, the new
event names, and `r` / `pl.r` and `b` / `pl.b` for their events. Queue entries
written by the previous shell lack `pl` and `pl.u`; on read, an entry that is
otherwise valid and lacks both is upgraded in place with `pl: 'web'` and the
matching `pl.u`, so upgrading loses no counts. `web/js/main.js` emits
`pinned_<kind>` in the detail pin action and `rode_*` where the arrival
settlement writes a new ride. The shell change bumps `web/sw.js` `VERSION`.

### Privacy page

`site/privacy/index.html` currently says only the web app sends anonymous
usage counts. It must say all three apps do, that the phone apps send them
only from release builds, and that Do Not Track applies to the web app. Copy is
drafted by Astra and needs the owner's verdict before the site deploys
(`docs/contracts/app-website.md` requires the policy to change with the
analytics contract).

## Reading the counters (added to `analytics.md`)

For kind `k` and platform `P`:

- Trip hit rate: `hit_k[pl=P] / (hit_k[pl=P] + miss_k[pl=P])`. Returning
  acceptance per platform uses `pl.u` in place of `u`.
- Train match: `pinned_k[pl.r=P.same] / Σ_r pinned_k[pl.r=P.r]`. The share
  with `r=service` is the right-trip, wrong-train rate; `r=trip` is a wrong
  trip corrected by pinning.
- Zero-tap rides: `rode_auto[pl=P]`, and its location-confirmed share
  `rode_auto[pl.b=P.location] / rode_auto[pl=P]`. Automatic entry needs a
  platform sighting, so these come from location answers (`usual`, `home`);
  compare against `shown_usual + shown_home` for a lower-bound rate.
- Pin follow-through: `rode_pin[pl=P] / Σ_k pinned_k[pl=P]`.

All are counts of answers, pins and recorded rides, not of people. Location
permission, foreground-only sampling on the web and best-effort delivery all
shape them.

## Rejected alternatives

- **Arrival lag as a wrong-train detector.** A rider who caught the next train
  confirms arrival later than the shown service's estimate. Rejected: the
  confirmation time depends on when the phone samples (foreground-only on the
  web, a reopen hours later), so the lag measures app use, not the train.
- **Header kind on ride events.** Would need the kind persisted on `focus` and
  `lastOpen` in every client. Automatic rides already come from location
  answers, and pinned rides are classified at pin time.
- **A Settings opt-out.** Declined by the owner on 2026-09-23.
- **Porting every web event to native.** Setup and permission flows differ on
  native; the strip experiment is web-only.
- **Any per-open, per-device or per-ride identifier** to join events. Never:
  it would break the no-identifier rule. Joint questions use composite
  dimensions composed at emit time.
