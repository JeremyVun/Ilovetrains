# Contract: Anonymous analytics and experiments

Every client (web, Android and iOS) posts anonymous counters directly to
`https://analytics.jeremyvun.com/e`, project `ilovetrains`. The train API
does not receive analytics. Saved trips, history, rides, location fixes and
experiment assignment stay on the device. The server posts its own accuracy
counters to the same project; they describe trains, never riders, and are
listed under "Server accuracy events" below.

## Privacy and enablement

On the web, sending requires the production hostname
`ilovetrains.jeremyvun.com`, usable localStorage, and no Do Not Track (`'1'`). Global Privacy Control is not an
opt-out here: it objects to selling or sharing personal data, and these
counters contain none. Otherwise
the client neither writes telemetry nor queues or sends events, and every
experiment uses its control. The in-memory event ledger still records the
approved events for local verification. On Android and iOS, sending requires
a release build; debug builds, including every test and seeded run, record the
same events in an in-memory ledger and never persist or send them, unless a
debug-only `ILOVETRAINS_ANALYTICS_URL` override (iOS launch environment,
Android intent extra, compiled out of release) points transport at a local
capture endpoint for verification. Native clients have no opt-out control
(owner ruling, 2026-09-23). Disclosure is in the privacy policy; there is no
in-app prompt or disclosure copy.

An event is exactly `{p, t, d, n}`: project, event name, categorical dimensions
and repeat count. No device or session ID, timestamp, presence heartbeat,
station, trip, line, coordinate, distance, viewport, user agent or typed text
is an event field. Names, dimension keys and values are closed vocabularies
enforced by the analytics module; extending them requires a contract change.

`d` contains the usage band `u`, the platform `pl` (`web`, `android` or
`ios`), the composite `pl.u` (`<pl>.<u>`, for example `ios.6-10`), on the web
the active experiment dimension `x.strip-placement` (`a3` or `a2`), and the
event's own keys: setup source `f`, open milestone `m`, pin result `r` with
its composite `pl.r`, or ride basis `b` with its composite `pl.b`. Native
events never carry `x.*`, which keeps them out of both experiment arms.
Callers cannot override the derived usage band, platform or variant.

## Device state and assignment

The optional document field `telemetry: {opens, bucket}` is specified in
[client-storage.md](client-storage.md). The web controller increments `opens`
once per page load before the first displayed home or setup answer. Native
clients keep `opens` in their own `analytics-v1` store and increment it once
per user-visible foreground entry that displays a home or setup answer,
because a phone app stays alive in the background for hours; each such open
also resets the first-row-tap classification and repeated-`shown_*`
suppression. Native bands therefore count foreground entries, not page loads.
Native clients draw no bucket: they run no experiment. The first
increment draws a bucket 0–99 using `crypto.getRandomValues`; later opens
retain it. No answer means no increment. Analytics never waits for a network
request before painting the answer.

Usage bands are `1`, `2-5`, `6-10`, `11-15`, `16-20`, `21-25`, `26-30`,
`31-35`, `36-40`, `41-45`, `46-50`, and `51+`. Absent telemetry and zero opens
read as `1`. Returning-user analysis starts at `6-10`; `2-5` uses the new-user
rule. These are open counts, not calendar weeks or observed rides.

`opened` carries milestone `m` when the incremented count is exactly one of
`1`, `5`, `10`, `15`, `20`, `25`, `30`, `40`, `50`, `75`, `100`, `150`, `200`,
`250`. It precedes the first `shown_*` event. Each milestone occurs once per
uninterrupted local record; clearing storage starts a new record.

`EXPERIMENTS` in `web/js/analytics.js` currently contains:

```js
'strip-placement': { variants: ['a3', 'a2'], offset: 0 }
```

Assignment is `variants[(bucket + offset) % variants.length]`. Without an
enabled client and bucket, the first variant is control. All events carry
the assigned variant while the experiment runs. A3 places the inferred
correction below the heavy rule; A2 places it in the receipt slot. Removing
the experiment row and hard-coding the winner ends the experiment; retain
the bucket for later experiments. This is a shell deploy with a worker
version bump, never remote configuration or server-side assignment.

## Event vocabulary and ordering

Header kinds are `predicted` (the no-location predictor), `focus` (hand-chosen
journey), `usual` (location plus view history), `home` (location plus inferred
home), `pair` (an automatically saved pair), and `inferred` (inferred travel).
Setup is a separate answer kind with setup-specific events.

| Event | Trigger | Extra dimension |
| --- | --- | --- |
| `shown_<kind>` | Home displays its own answer; suppress repeats of the immediately previous kind, trip and direction | — |
| `hit_<kind>` | First home trip-row tap matches the displayed answer; also focusing a journey matching home's last shown trip and direction | — |
| `miss_<kind>` | First home trip-row tap chooses a different trip or direction | — |
| `change_inferred` | Inferred strip's CHANGE action, before navigation | — |
| `entered_inferred` | Travel inference writes a focus, once per entry | — |
| `back_focus`, `back_inferred` | Accepting the corresponding way-back offer | — |
| `asked_panel` | Home location panel first appears in this page load | — |
| `granted_panel`, `denied_panel` | Outcome of an explicit home location request | — |
| `later_panel` | Home location panel's Not now action | — |
| `shown_setup` | Setup sheet displays | `f`: `location` if From is prefilled, otherwise `empty` |
| `asked_setup` | Setup's Use my location row first appears in this sheet | — |
| `granted_setup`, `denied_setup` | Outcome of an explicit setup location request | — |
| `saved_setup` | Setup saves a valid pair, after resolving a redirect if present | `f`: `location`, `nearby`, `search`, `redirect`, `redirect_lost` |
| `opened` | First answer reaches an open milestone | `m`: one of the milestone strings above |
| `pinned_<kind>` | Explicit pin while home's own answer is attributed this open, after any `hit_<kind>` for the same pin | `r`: `same`, `service`, `trip`; composite `pl.r` |
| `rode_pin`, `rode_auto` | Arrival settlement appends a ride absent from `rides` before that write; `pin` for `by: "focus"`, `auto` for `by: "inferred"` | `b`: `location`, `estimate`; composite `pl.b` |

Android and iOS send `opened`, `shown_<kind>`, `hit_<kind>`, `miss_<kind>`,
`pinned_<kind>`, `rode_pin` and `rode_auto` under the same rules. Setup,
location-panel, `entered_inferred`, `back_*` and `change_inferred` events are
web-only. Native derives the kind as the web does: a visible focus is
`inferred` or `focus` by its `by`; a trip home saved automatically from here
during this open is `pair` while it is the answer; with no station here the
answer is `predicted`; with a station here, the homeward candidate chosen
without a habit or location winner is `home`, and any other answer is
`usual`. The web reads `pair` only for the render that saved it; native keeps
it for the rest of that open.

`pinned_<kind>` compares the pinned journey with home's last rendered answer
before the pin: its trip, direction and displayed lead journey (the
recommendation, or the followed journey for `focus` and `inferred`). `trip`
means another trip or direction; `same` means the same trip and direction with
an equal identity key (every service leg's line and scheduled departure:
`journeyKey` on web, `Journey.key` on native); `service` means the same trip
and direction with another key. A same-trip pin when home displayed no lead
journey emits nothing. Each pin action emits at most once; unpinning emits
nothing. `rode_*` never fires for a correction of an existing ride or a legacy
ride restored by migration; a withdrawn estimate ride recorded again counts
again.

Explicit selection is browsing and emits no new home `shown_*`. Returning
from the board to the same answer adds no exposure. A location fix changing
the header's answer adds a new exposure; A → B → A is three exposures.
Only the first home row tap is classified, and setup is excluded from
hit/miss attribution. Detail focus
on another trip emits nothing. Silent location fixes emit no ask outcome.
The next-service rail opens detail without a hit/miss event. Pinning that
service uses the existing detail-focus rule for the last shown pair/direction.

The setup save source follows how From was chosen: location row or prefill,
nearest-station row, or search/recent choice. Editing and replacing From
updates that source. A redirect which finds the original departure uses
`redirect`; an unsuccessful match uses `redirect_lost` and opens the board.

An answer tap followed by focusing its journey counts two hits against one
shown; this is the accepted measurement rule. A changed prediction can add
two exposures in one open. Counts measure displayed answers and actions,
not distinct devices, confirmed rides or per-session funnels.

## Transport

`track` records synchronously and never throws. Enabled counters compact in
`trains.analytics.v1` by equal event name and dimensions, capped at 200
entries, oldest dropped. Malformed or obsolete queue data cannot send an
unapproved event. Queue format and settlement are in
[client-storage.md](client-storage.md).

One compacted entry saturates at 1,000,000 repeats, matching the collector's
per-event count ceiling. A full queue remains below the 64 KiB ingest limit.

The first recorded event schedules one idle-deferred flush after 10 seconds.
Going hidden or leaving the page tries `sendBeacon` with a `text/plain` Blob;
if refused, it falls back to `fetch` with `keepalive`. An `online` event
also flushes. Known-offline calls keep the queue without sending. Fetches
POST one JSON array with `Content-Type: text/plain`, avoiding preflight.
The service worker ignores the cross-origin request.

Queue entries written before `pl` existed lack both `pl` and `pl.u`; an
otherwise valid entry missing both is upgraded on read with `pl: "web"` and
its `pl.u`, so a shell update loses no counts.

Native clients hold the same compacted queue (200 entries, 1,000,000 repeat
saturation, closed-vocabulary validation on read, snapshot settlement on 2xx,
one request in flight) in their `analytics-v1` store and POST it as one JSON
array with `Content-Type: application/json`, without cookies or credentials.
They flush 10 seconds after the first event of a foreground session, when the
app goes to the background (best effort within the platform's background
allowance), and at the next foreground entry while anything is queued.

No client sends an ingest key; the analytics deployment runs open ingest for this project.
Configuring ingest keys on the service silently drops these events until the
client carries one.

A 2xx fetch response settles only the snapshot sent; new counts survive.
An accepted beacon settles immediately, meaning browser acceptance rather
than confirmed delivery. Other responses and network failures retain the
queue for the next flush. Overlapping triggers in one page share one fetch.
This is best-effort counting: offline loss, browser storage resets, multiple
tabs, and accepted beacons can affect totals. There are no dedup identifiers.

## Server accuracy events

The Go server emits the accuracy figures it logs (see `api.md`, "Accuracy
log") as counters with `n` set to the window's count, every 15 minutes, when
`ANALYTICS_URL` is configured. Every dimension is a closed vocabulary. No
station, trip, request, client or clock value is a field. The delta buckets
are `early5+`, `early2-5`, `early1-2`, `within1`, `late1-2`, `late2-5` and
`late5+`, in minutes.

| Event | Meaning | Dimensions |
| --- | --- | --- |
| `feed_prediction_scored` | One realtime prediction scored against the same feed's final estimate for that stop | `source` (feed), `lead` (`0-2m`, `2-5m`, `5-10m`, `10-20m`, `20-40m`, `40-90m`), `error` (`late` means the stop passed later than predicted), composites `lead.error`, `source.error` |
| `feed_stop_unresolved` | A tracked stop whose feed coverage ended more than three minutes before it passed | `source` |
| `feed_trip_cancelled` | A tracked trip the feed cancelled | `source` |
| `tripplanner_leg_reconciled` | One served live leg joined to the feed | `mode`, `outcome` (`agree`, `disagree`, `tripplanner_only`, `feed_only`, `scheduled_only`, `unmatched`, `stale`), composite `mode.outcome` |
| `tripplanner_leg_compared` | One leg where both sources had an estimate | `mode`, `diff` (`late` means Trip Planner's time is later than the feed's), composite `mode.diff` |
| `tripplanner_cancel_mismatched` | One source reports a cancellation the other does not | `mode` |

Read `feed_prediction_scored[lead.error]` for how a countdown at a given lead
held up, and `tripplanner_leg_reconciled[mode.outcome]` for how often the
board's source agreed with the feed. Both are counts of scored predictions and
served legs, weighted by how often busy pairs are fetched, not by riders.
The clients' 40 minute live horizon
([ui.md](ui.md#past-stale-and-exceptional-data)) sits on this counter's
`20-40m` / `40-90m` bucket edge (`leadBounds` in `internal/native/accuracy.go`)
so the two sides of that rule stay separately measurable; move the edge and
the rule loses its evidence.

## Reading the counters

The service aggregates by arrival window; offline events contribute when
delivered. Histograms split one event by one dimension, without joining
usage and variant dimensions. For header kind `k`:

- New-user hit rate: `hit_k[u=b] / shown_k[u=b]` for `b=1` and `b=2-5`.
- Returning answer acceptance: `(shown_k[u=b] - miss_k[u=b]) / shown_k[u=b]`
  for each band from `6-10` onward. No action is treated as acceptance.
- Milestone reach: `opened[m=N] / opened[m=1]` over the same accumulated
  observation period. This is an approximate device-cohort read, subject to
  resets, delivery loss and devices which started before the period.
- Strip correction: `change_inferred[x.strip-placement=v] /
  shown_inferred[x.strip-placement=v]`, comparing `a2` and `a3`. Other
  counters split by variant show effects on the rest of the flow.

Per platform `P`, with the composites composed at emit time:

- Trip hit rate: `hit_k[pl=P] / (hit_k[pl=P] + miss_k[pl=P])`. Returning
  acceptance per platform reads `pl.u` where the ratios above read `u`.
- Train match: `pinned_k[pl.r=P.same] / Σ_r pinned_k[pl.r=P.r]`. The
  `service` share is the right-trip, wrong-train rate; `trip` is a wrong trip
  corrected by pinning.
- Zero-tap rides: `rode_auto[pl=P]`, with its location-confirmed share
  `rode_auto[pl.b=P.location] / rode_auto[pl=P]`. Automatic entry needs a
  platform sighting, so these rides follow location answers; compare with
  `shown_usual + shown_home` for a lower-bound rate.
- Pin follow-through: `rode_pin[pl=P] / Σ_k pinned_k[pl=P]`.

These count answers, pins and recorded rides, not people. Location
permission, the web's foreground-only sampling and best-effort delivery shape
every ride figure. Native open bands count foreground entries, so compare
rates across platforms, never band-for-band open counts.

Zero denominators mean no observation. No-action acceptance is a product
assumption, not proof that the rider took that service. Browser and production
verification commands live in [tools/README.md](../../tools/README.md).

## Explicit feedback

Settings sends user-authored feedback directly to
`https://analytics.jeremyvun.com/feedback` using POST JSON with exactly
`{project: "ilovetrains", category, feedback, platform, clientVersion}`. The
labels Problem, Suggestion and Other send `problem`, `suggestion` and `other`;
category and message are required after trimming. `platform` is the fixed
string `web`, `android` or `ios` naming the client that sent the message.
`clientVersion` is that client's released version string: `VERSION` from
`web/js/version.js` on web, `BuildConfig.VERSION_NAME` on Android and
`CFBundleShortVersionString` on iOS, all kept equal by the release process.
NUL is rejected;
message is limited to 8,192 UTF-8 bytes and encoded JSON to 10,240 bytes.
Requests omit credentials and referrer. Unknown fields are ignored by the
service, so a submission is sent successfully on 201 whether or not it stores
them. No message, platform or version enters `/e`, the train API,
localStorage, logs or the service-worker cache. This deliberate submission is
independent of anonymous-counter enablement and sends no analytics event.

One form draft and in-flight guard live in page memory across route navigation.
Only 201 clears the draft. Errors preserve it with an explicit retry action;
there is no automatic retry because a lost response may follow a committed
record. Submission errors never display upstream response text. Operator
listing, export and deletion stay behind the analytics service's existing
Authelia gate; no operator credential is shipped to the browser.

Unpinning a service emits no prediction hit or miss and no new event.
