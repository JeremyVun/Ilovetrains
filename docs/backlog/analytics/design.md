# Analytics and A/B testing

Design session 2026-09-05. Rulings are dated and binding; the mechanism is
what satisfies them. The item is ready to build only when "Open questions"
is empty and `build_plan.md` exists.

## The owner's words

- "we probably need to build a/b testing and analytics into this app from
  the get go. create backlog item for instrumenting this. The first use
  case will be a/b testing how to show this strip feature." (during the
  `smart-header-v2` comps verdict)
- "all twelve, but see if you can simplify it. My understanding is that
  analytics is extensible, but it'd be good to have an optimised payload to
  begin with. There will likely be alot of users, and those users will have
  spotty network connections"
- "I'm actually starting to think we shouldn't track users by random uuid -
  that allows anyone to reconstruct a user profile based on their travel
  patterns (bad). The only reason I wanted to track users individually was
  to be able to identify behaviour groups, but maybe i shouldn't do that.
  Probably best we just record if they are a returning user or a new user.
  i.e. on their client we just store how many times they've opened it as a
  counter. So a returning user that takes no actions is more likely a
  positive hit for the smart header."

## What it is

The web client starts sending a small set of anonymous counters to the
shared analytics service (`analytics-stack` skill; deployed at
`https://analytics.jeremyvun.com`, project key `ilovetrains`). Each count
says what the smart header showed and what the user did next, so the
roadmap's M4 hit rate exists as a number instead of a feeling. Each device
also draws a random bucket once, kept in its local document, and that
bucket decides which of two treatments it sees while an experiment runs.
The first experiment is the inferred travel-mode strip: A3 (one line below
the heavy rule, shipped by `smart-header-v2`) against A2 (the question in
the header's receipt slot with CHANGE inline). The result is read on the
service's `/ui` dashboard as shown-versus-acted counts per variant.

The server does not change. Events go from the browser to the analytics
origin directly; the Go API stays stateless and cacheable per station pair.

## Rulings (all 2026-09-05)

1. **No device id.** The owner first chose a persistent random id for
   distinct-device counts, then withdrew it: an id lets anyone holding the
   data reconstruct a person's travel pattern. Nothing in an event can
   link it to another event. The behaviour group the id was for is
   carried instead as `new` or `returning`, from a count of opens the
   device keeps for itself.
2. **Disclosure is in the docs only, and Global Privacy Control is
   honoured.** No in-app copy. `PROJECT.md` and the contracts state exactly
   what is sent and what never is. A browser that sends GPC, or Do Not
   Track, gets no analytics at all: nothing is queued or sent, and
   experiments resolve to their control variant.
3. **A hit is opening the header's own trip or taking a train on it; a
   miss is opening another row.** An open with no action is a hit for a
   returning user (the answer stood) and nothing for a new one. The
   dashboard read that gives this is in section 4.
4. **The payload is optimised for many users on spotty networks.** One
   small request per open in the common case, none while offline, and a
   backlog compacts to counts rather than growing.

## Constraints honoured

- `PROJECT.md` principle 5 ("no ads, no accounts, no tracking; the server
  never sees who you are") is reworded at closeout to say precisely what
  leaves the phone. Draft, for the owner's verdict at closeout:

  > **No ads, no accounts, no tracking.** Saved trips, history, rides and
  > location fixes live on the device and are never sent anywhere. The
  > app reports a handful of anonymous counters to a self-hosted analytics
  > service (which kind of answer the header gave, whether it was taken)
  > with nothing that identifies a phone or links one count to another.
  > No station, trip, coordinate or clock time is in them, and a browser
  > that sends Global Privacy Control sends none of it.

- `client-storage.md` "Nothing here is ever sent to the server" stays true
  of everything it lists today. The new `telemetry` field never leaves the
  device either; only the `new`/`returning` word derived from it does.
- Variant assignment lives on the device, so the API stays cacheable.
- Offline first: events queue on the device and flush when the network
  answers. The service worker ignores cross-origin requests
  (`web/sw.js`, fetch handler), so its `/api/` rules are untouched.
- Zero-tap answer: nothing analytics does may sit between open and paint.
  Recording is a synchronous array push; sending is deferred to idle.

## Mechanism

### 1. What an event may carry

Every event on the wire is `{p: "ilovetrains", t: <name>, d: {…}, n: <count>}`.
Nothing else: no unit id, no session id, no timestamp (the service
aggregates by arrival anyway), no presence beats.

`d` holds at most three keys, all from closed vocabularies in this
document: `u` (`new` or `ret`), `x.<experiment>` (a variant name, only
while that experiment runs) and, on two setup events, `f` (a source
word). **Never**: a station id or name, a coordinate or distance, a trip
pair, a line, a clock time or hour-of-day bucket, a journey key, user
agent or viewport, anything typed into a field. A new name or value is a
contract change, not a build decision.

### 2. The device's own record: `telemetry` in the document

```json
"telemetry": {"opens": 12, "bucket": 37}
```

- `opens`: how many page loads have reached a first answer (a `shown_`
  event on home or setup), counted once per page load, before that
  event's `u` is computed. `u` is `new` while `opens ≤ 3` and `ret` from the
  fourth open. The threshold is the owner's to edit; three is chosen
  because a device with fewer opens has almost no view history, so the
  header is still answering from defaults.
- `bucket`: an integer 0–99 from `crypto.getRandomValues`, drawn with
  the first `opens` increment.
- Both are written only while analytics is enabled (section 6). A
  malformed field is dropped and starts again. `parseDoc` keeps the
  field, `serializeDoc` writes it, and only `web/js/analytics.js` reads
  or updates it, through `ctx.update` like every other write.
- The shooter and the unit tests seed documents without `telemetry` and
  run on non-production hosts, so they never write one.

### 3. Experiments

A table in `web/js/analytics.js`:

```js
export const EXPERIMENTS = {
  'strip-placement': { variants: ['a3', 'a2'], offset: 0 }
};
```

`variant(doc, 'strip-placement')` is
`variants[(bucket + offset) % variants.length]`, or the first variant
(the control, always the shipped design) when analytics is disabled or
no bucket exists. `offset` is a hand-set integer so two experiments never
split the population on the same parity.

While an experiment is in the table, **every** event carries the dimension
`x.<experiment>: <variant>`, so any counter can be split by variant on the
dashboard, not only the strip's own.

An experiment ends by deleting its row and hard-coding the winner. The
bucket stays for the next experiment. There is no remote configuration:
the table ships with the shell, so an experiment change is a deploy with
a `VERSION` bump like any other shell change.

### 4. Event vocabulary

The service keys its histograms by event name first, then dimension, so
any split of one event by `u` or by variant is free at read time while a
split of one dimension by another is not. The vocabulary therefore puts
the header kind **in the event name** and keeps `u` and `x` as
dimensions: every question below is one counter divided by another with
the same dimension filter, and no composite values exist.

Event names are `<result>_<kind>`. The kinds:

| kind | meaning |
|---|---|
| `predicted` | today's predictor: history, time, the location floor, `lastViewed`, first trip |
| `focus` | hand-focused directions (`Take this train`) |
| `usual` | `smart-header-v2`: from here to the usual place |
| `home` | `smart-header-v2`: from here to the inferred home |
| `pair` | `smart-header-v2`: an unsaved pair auto-saved on show |
| `inferred` | `smart-header-v2`: inferred travel mode |
| `setup` | the setup sheet, when it is the answer or is opened by hand |

`usual`, `home`, `pair` and `inferred` do not exist until `smart-header-v2`
phase 3 lands; until then the client emits `predicted`, `focus` and
`setup`. Home showing the explicit selection (the user tapped a row and
came back) is not an answer the header made, so it emits nothing.

| event | fires | extra dim |
|---|---|---|
| `shown_<kind>` | each time home settles on an answer within one page load: the first paint with a selection, and again if a later fix changes a predicted selection | |
| `hit_<kind>` | the first trip-row tap of the page load on home is the header's own trip; or `Take this train` on detail and the focused trip and direction equal what home last showed this page load | |
| `miss_<kind>` | the first trip-row tap of the page load on home is another trip | |
| `change_inferred` | the strip's CHANGE tapped | |
| `entered_inferred` | inferred entry sets a focus | |
| `back_<kind>` | the way-back offer accepted (`focus` or `inferred`) | |
| `asked_panel`, `granted_panel`, `denied_panel`, `later_panel` | the home location panel appears; the ask resolves granted, denied, or `Not now` | |
| `asked_setup`, `granted_setup`, `denied_setup` | the setup sheet's location row appears; the ask resolves | |
| `shown_setup` | the setup sheet opens | `f`: `location` (From prefilled) or `empty` |
| `saved_setup` | the setup sheet saves | `f`: `location`, `nearby`, `search`, `redirect` (Change destination, journey re-found), `redirect_lost` (not re-found) |

That is 18 header counters (six kinds by shown, hit, miss) plus twelve
others, well under the service's 256-key cap, each with `u` and, during
an experiment, one `x` dimension.

Reads, per kind `k`, from the `/ui` dashboard or `/stats`:

- hit rate, new users: `hit_k[u=new] / shown_k[u=new]`;
- hit rate, returning users (ruling 3):
  `(shown_k[u=ret] − miss_k[u=ret]) / shown_k[u=ret]`;
- strip experiment: `change_inferred[x=a2] / shown_inferred[x=a2]`
  against the same for `a3`; and every other counter split by `x` for
  side effects.

`shown_k` counts answers, not opens: a fix that flips the prediction
after the cached paint counts twice, which is honest (the user saw two
answers) and slightly deflates the rate. Only the first row tap of a page
load is a hit or a miss; later taps are browsing. `Take this train` is
not guarded by that tap, so a tap and then a focus on the same trip count
two hits against one shown; the accepted cost of a simple rule. Once-per-load events are
guarded in client state, not by the service's dedup.

### 5. Transport: `web/js/analytics.js`

A dependency-free module, listed in `SHELL` (bump `VERSION`), with two
halves:

- **record**, always on: `track(name, dims)` adds `u` and the experiment
  dims, appends to an in-memory ledger exposed as
  `window.__trains.analytics.events`, and, when enabled, merges into the
  persisted queue. Synchronous, never throws, never touches the DOM.
- **send**, only when enabled. The queue lives under its own localStorage
  key `trains.analytics.v1` as `{queue: [{t, d, n}]}`, separate from the
  document because it is transport state, not the user's. **Compaction**
  (ruling 4): an event whose `t` and `d` match a queued entry increments
  that entry's `n` instead of appending, so a week offline is a few dozen
  entries whatever the number of opens. The queue is capped at 200
  entries, oldest dropped. A flush POSTs the whole queue as one JSON
  array to `https://analytics.jeremyvun.com/e` with
  `Content-Type: text/plain` (no preflight) and `keepalive`, and clears
  the sent entries only on a 2xx. A rejected fetch, a 429 (many users
  share one carrier address) or any other status keeps them for the
  next flush.

  Flush runs when the page goes to the background (`visibilitychange` to
  hidden, `pagehide`) via `sendBeacon`, which clears the queue on a
  `true` return and falls through to the keepalive fetch on `false`; and
  on the `online` event; and once, idle-deferred, 10 s after the first
  record of a page load. The common open therefore costs one request,
  and an open that ends within 10 s costs the beacon alone.

No ingest key: the deployment runs open ingest and mortgage-calc already
posts the same way. If the operator later sets `ANALYTICS_INGEST_KEYS`,
the key is a constant in the module (a bot hurdle, not a secret) and the
beacon path gives way to the keepalive fetch, which can carry the header.

### 6. Enabled

Analytics is enabled only when all of:

- `location.hostname === 'ilovetrains.jeremyvun.com'` (so localhost, the
  shooter on `:8092`, `file://` and Node are silent);
- `navigator.globalPrivacyControl !== true` and
  `navigator.doNotTrack !== '1'`;
- `localStorage` is usable.

Disabled means: no `telemetry` written, no queue, no requests, the
control variant for every experiment, and the in-memory ledger still
fills so tests and the shooter can assert what would have been sent.

### 7. Reading the result

The dashboard at `https://analytics.jeremyvun.com/ui` (behind Authelia)
shows every counter and its dimension histograms for `ilovetrains`. The
reads in section 4 are the whole analysis; the service keeps no raw
archive for this deployment, so no per-session funnel exists and none is
designed for. `tools/README.md` gains the curl smoke from the
`analytics-stack` skill and the ratios.

### 8. The A2 variant

A2 is the receipt-slot treatment from the smart-header-v2 comps round:
no strip below the rule; the header's receipt line reads the question with
CHANGE inline in the offer button idiom; the heavy rule moves from 214 px
to 258 px. The round's shots and comp source are kept in `comps/` beside
this file (`a2-receipt-390x844-change.png`, `-change-light.png`,
`-longdest.png`, `-board.png`, `a2-receipt.js`) because the workshop is
disposable. The shot's words are the round's candidate; the ruled copy is
the same as A3's, `Going somewhere else?` with the action `CHANGE`.

Under variant `a2` the strip model from `smart-header-v2` renders in the
receipt slot instead of below the rule; under `a3` as shipped. The
`ui.md` "header is read-only" rule gains the exception that the receipt
slot may carry the strip's one action while the experiment runs.

### 9. Contracts touched at closeout

- `client-storage.md`: the `telemetry` field, its write rule, the queue
  key, and the sentence that only `new`/`ret` derived from it is sent.
- `ui.md`: the events each screen emits (the section 4 table), the A2
  exception while the experiment runs.
- `PROJECT.md`: principle 5 reworded (draft above); the decision log.
- `api.md`: one line: the API is not the analytics path.
- `tools/README.md`: smoke and ratios; `tools/shoot-states.js`: ledger
  assertions per state.
- `docs/ROADMAP.md`: M4 "measure before tuning" done.

## Rejected alternatives

- A persistent random device id: chosen, then withdrawn (ruling 1); it
  allows a travel profile to be reconstructed from the event stream.
- A per-open session id: links shown to acted within one open, but only
  the raw archive could use it and none is enabled.
- Presence heartbeats: "online now" answers no question here and would
  send a request every 30 s for nothing.
- Composite dimension values (`usual.ret.hit`): the service's histograms
  are keyed by event name, so a kind in the name gives every split for
  free and the dashboard stays readable.
- An hour-of-day or distance dimension: it would make the hit rate
  tunable by time, but the promise that no clock time or distance leaves
  the phone is worth more; tune from the header kinds first.
- Server-side variant assignment or a remote experiment config: the API
  is cacheable per station pair and stateless; a shipped table is enough.
- The service's raw archive for session funnels: not enabled in the
  deployment; the counters answer the questions asked.
- Copying `analytics.ts` from the service repo: the app has no build step
  and the reference client keeps its queue in memory only and flushes
  every 5 s; a small module with a compacted, persisted queue is the
  right size for spotty networks.
- Keeping the queue inside `trains.v1`: every event would rewrite the
  user's document.
- A page-leave "no action" event: unreliable at unload and unnecessary,
  since no-action is `shown − hit − miss` at read time.
- An in-app disclosure line: ruling 2; the owner has ruled against extra
  copy before.

## Open questions

None standing. One number is the owner's to confirm or edit: `u` turns
from `new` to `ret` at the fourth open (section 2).

## Depends on

`smart-header-v2` phase 3 for the header kinds `usual`, `home`, `pair`,
`inferred`, the strip and its model. Everything else builds today.
