# Contract: Anonymous analytics and experiments

The browser posts anonymous counters directly to
`https://analytics.jeremyvun.com/e`, project `ilovetrains`. The train API
does not receive analytics. Saved trips, history, rides, location fixes and
experiment assignment stay on the device.

## Privacy and enablement

Sending requires the production hostname `ilovetrains.jeremyvun.com`, usable
localStorage, and no Do Not Track (`'1'`). Global Privacy Control is not an
opt-out here: it objects to selling or sharing personal data, and these
counters contain none. Otherwise
the client neither writes telemetry nor queues or sends events, and every
experiment uses its control. The in-memory event ledger still records the
approved events for local verification. Disclosure is in the documentation;
there is no in-app prompt or disclosure copy.

An event is exactly `{p, t, d, n}`: project, event name, categorical dimensions
and repeat count. No device or session ID, timestamp, presence heartbeat,
station, trip, line, coordinate, distance, viewport, user agent or typed text
is an event field. Names, dimension keys and values are closed vocabularies
enforced by the analytics module; extending them requires a contract change.

`d` contains the usage band `u`, the active experiment dimension
`x.strip-placement` (`a3` or `a2`), and at most one of setup source `f` or
open milestone `m`. Callers cannot override the derived usage band or variant.

## Device state and assignment

The optional document field `telemetry: {opens, bucket}` is specified in
[client-storage.md](client-storage.md). The controller increments `opens`
once per page load before the first displayed home or setup answer. The first
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

Explicit selection is browsing and emits no new home `shown_*`. Returning
from the board to the same answer adds no exposure. A location fix changing
the header's answer adds a new exposure; A → B → A is three exposures.
Only the first home row tap is classified, and setup is excluded from
hit/miss attribution. Detail focus
on another trip emits nothing. Silent location fixes emit no ask outcome.

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
The service worker ignores the cross-origin request. The client sends no
ingest key; the analytics deployment runs open ingest for this project.
Configuring ingest keys on the service silently drops these events until the
client carries one.

A 2xx fetch response settles only the snapshot sent; new counts survive.
An accepted beacon settles immediately, meaning browser acceptance rather
than confirmed delivery. Other responses and network failures retain the
queue for the next flush. Overlapping triggers in one page share one fetch.
This is best-effort counting: offline loss, browser storage resets, multiple
tabs, and accepted beacons can affect totals. There are no dedup identifiers.

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

Zero denominators mean no observation. No-action acceptance is a product
assumption, not proof that the rider took that service. Browser and production
verification commands live in [tools/README.md](../../tools/README.md).

## Explicit feedback

Settings sends user-authored feedback directly to
`https://analytics.jeremyvun.com/feedback` using POST JSON with exactly
`{project: "ilovetrains", category, feedback}`. Category is Problem, Suggestion
or Other; category and message are required after trimming. NUL is rejected;
message is limited to 8,192 UTF-8 bytes and encoded JSON to 10,240 bytes.
Requests omit credentials and referrer. No message enters `/e`, the train API,
localStorage, logs or the service-worker cache. This deliberate submission is
independent of anonymous-counter enablement and sends no analytics event.

One form draft and in-flight guard live in page memory across route navigation.
Only 201 clears the draft. Errors preserve it with an explicit retry action;
there is no automatic retry because a lost response may follow a committed
record. Submission errors never display upstream response text. Operator
listing, export and deletion stay behind the analytics service's existing
Authelia gate; no operator credential is shipped to the browser.
