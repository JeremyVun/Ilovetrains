# Native offline timetables with a realtime overlay

Current implementation audit: [September 7 reliability investigation](investigation-2026-09-07.md).
Native routing and shared ingestion now exist; the historical deferred-design
text below is not an accurate inventory of the shipped implementation. The
audit records confirmed compatibility failures and the remaining evidence gates.

Deferred to native Android/iOS design by owner ruling, 2026-09-06. The web
PWA keeps the existing TfNSW Trip Planner architecture, including cached
last-known journeys offline. It will not build a local routing engine under
this item. New offline journey planning is a native-app direction to design
when those apps are built; no executable build plan exists.

This is a scope choice, not a claim that browsers cannot store timetables or
route locally. The September 5 architecture and the research below are inputs
to future native design. They no longer block web work or Settings.

## Owner rulings — 2026-09-07 (on the reliability investigation)

- Finding 6, the in-progress arrival freeze from the settled `at` cache, is
  to be fixed. It affects the web, Android and iOS online focus paths.
- Recording a ride from a stale expected arrival (investigation section 6,
  `settleFocus`, `recordCompletedFocus`) is fixed in the same change.
- Finding 2, replacement stop patterns, platform changes and added trips, is
  split into its own item: `../realtime-replacements/design.md`.
- Findings 1 and 3, the Sydney Trains service-date gate and the 90-second
  trip-timestamp gate, and the empty-snapshot logging gap remain here.

## Current owner ruling — 2026-09-06

“yea, so the web experience will have to use the tfnsw planner, that's fine.
i dont see any other choice.

However, when we go to build the mobile apps, that is when we willl need to
support offline use i thin.”

Keep web route construction on TfNSW Trip Planner through the stateless Go
proxy. Defer timetable packages, shared realtime ingestion and local route
construction to the native offline design. The exact native engine, coverage,
download policy and online fallback remain undecided. Existing web cache,
freshness and personal-state contracts remain binding.

## Earlier architecture ruling — 2026-09-05

1. “I think eventually I want to move to client side caching + delta updates
   no? It's too expensive to make full requests each time”
2. “If you had to design this system from scratch, how would you do it? one
   upfront request + deltas? Or the way tripview does it - just one upfront
   download each time you open up the app and your version is out of date?”
3. Final ruling: “yea i agree. deltas will be annoying to get right. Ok lets
   go with this. static timetables + dynamic realtime stuff overlaid on top”

The owner previously accepted the proposed split: versioned timetable packages and
routing on-device, with shared backend realtime ingestion and small,
replaceable realtime snapshots. No delta chains in the initial architecture.
The expense concern is a design motivation, not measured evidence of which
current cost dominates.

## Intended native capability

The native app would answer from a local timetable, then improve the answer with
fresh realtime information. It can find new scheduled journeys offline,
rather than only show a previously cached board. Mode changes reroute locally
over the available network instead of filtering six server-selected results.

For this native proposal, the backend would publish shared transit data;
native offline searches would run on-device. The web retains pair-specific
Trip Planner requests. Neither path holds personal profiles. Location, saved
trips, prediction, preferences and followed journeys remain on-device. The
API key stays on the server. Shared public timetable/realtime state is not
personal state.

## Architecture to revisit for native

Carried forward from the earlier design, subject to the native evidence gates
and owner decisions below. References to client migration describe future
native design concerns, not an authorized web migration.

### Versioned timetable packages

- Ingest source schedules server-side and compile compact routing-ready
  packages: stops, services, calendars/exceptions, stop times and interchange
  connections. Begin with the currently supported train/metro/ferry network;
  bus and light rail remain separate scope.
- A small manifest identifies compatible package versions, validity and
  immutable content hashes. Download missing/changed packages, not the whole
  network on every open. Keep the last complete generation usable while its
  replacement downloads; validate before switching atomically.
- Prefer independent replacement packages over binary patches or ordered
  update chains. Package boundaries, size, time horizon and storage backend
  need measurements before they are fixed.
- Timetable validity is distinct from package integrity and app version.
  Never represent expired coverage as a current schedule. First install,
  insufficient storage, eviction, interrupted updates and schema upgrades
  require explicit recovery behavior.

### On-device planning

- Plan and rank eligible journeys locally, applying mode preferences before
  choosing results. A train+metro connection requires both modes enabled.
  Keep enough network coverage to discover alternate routes, not only the
  legs of the last selected journey.
- Apply existing journey semantics: service legs versus walking transfers,
  valid endpoints, connection safety, cancellations and honest freshness.
  Realtime changes can invalidate a connection and require rerouting, not
  just changing the printed time.
- Preserve the home predictor and user state. Adapters should supply the
  existing UI/view-model consumers during migration; any semantic mismatch
  must be resolved explicitly, not hidden behind API-shaped JSON.
- A followed journey remains selected when its mode is disabled and continues
  receiving realtime updates. New suggestions obey the changed preferences.
  An all-off selection stops new suggestions, not the followed journey.

### Shared realtime snapshots

- Ingest upstream realtime data on a shared cadence, independent of per-rider
  route searches. Publish compressed snapshots for stable public network
  partitions so responses can be shared and cached without user identity.
- Clients fetch relevant snapshots on opening/resuming and refresh while
  visible. Choose partition coverage and refresh intervals from measured
  payloads, upstream freshness and alternative-route needs. Do not assume a
  fixed refresh interval or a persistent connection is required.
- A snapshot is a complete replacement for its declared scope, not a patch
  against the last response. Conditional requests avoid unchanged bodies.
  Version checks must not disguise stale upstream data as freshly observed.
- Retain source timestamps, coverage and expiry independently of client
  receipt time. Apply delays, changed platforms, cancellations, skipped stops,
  added services and relevant disruptions only with verified source semantics.
  Expired realtime falls back to scheduled information with honest provenance.
- Match realtime to schedules through verified feed/trip/stop/service-date
  identifiers. Package rollover, missing matches and added trips absent from
  the static package need explicit handling. Do not silently attach updates
  to similarly named services or treat missing data as proof of cancellation.

## Why not the alternatives

- Repeated per-pair Trip Planner searches couple upstream work to the number
  of distinct route queries. Shared feed ingestion is the chosen long-term
  boundary; smaller client responses alone would not remove that coupling.
- A timetable download alone cannot provide new delays or cancellations.
  Realtime remains a separate refreshable layer.
- Delta chains introduce base-version, missed-update and resynchronization
  complexity. Replace small snapshots first; revisit deltas only if measured
  payload costs justify them and the owner reopens the decision.
- The earlier rejection of a web `modes` query as a temporary bridge is
  superseded by the September 6 platform ruling. Web Settings must design
  eligible replacement retrieval using TfNSW Trip Planner. Its request and
  cache semantics still need verification; filtering six results alone remains
  rejected. Native online fallback is a separate future design question.

### TripView comparison: evidence boundary

Checked 2026-09-06: TripView's
[publisher description](https://apps.apple.com/au/app/tripview/id294730339)
states that timetables live on the phone for offline use, realtime falls back
to scheduled times, and its trip editor allows selected change locations and
lines. Its [editing help](https://tripview.com.au/support/app/edit-trip)
also describes route/line customization. This supports local timetable
processing; it does not disclose the routing algorithm or establish general
automatic route discovery across all modes. Do not cite TripView as proof
that our proposed routing scope is simple or that it uses a particular engine.
The current app delegates candidate route construction to TfNSW Trip Planner;
its own server filters/maps candidates and its client predicts the station
pair, ranks personal intent and presents/follows the returned journeys.

## Evidence and design gates

Source reading in the preceding design discussion confirmed that TfNSW
publishes static schedules and realtime trip-update/alert feeds separately:
[TfNSW documentation](https://opendata.transport.nsw.gov.au/developers/documentation).
This does not establish feed compatibility, package size, routing quality or
cost for our network. Existing observations and fixtures are indexed in
`docs/references/tfnsw-open-data.md` and `tools/README.md`.

When native work resumes, before writing its phased build plan:

1. Verify feed coverage and identifier joins across train, metro and ferry,
   including the existing Trip Planner hub IDs and persisted station IDs.
   Follow the instrument instructions; never read/source `.env` without
   permission. Record source versions and representative fixtures.
2. Measure compiled download size, memory, cold/warm load, storage eviction
   recovery and routing latency on target phones. Include calendar exceptions,
   service-day times beyond midnight, Sydney DST, long names and transfers.
3. Prove route quality against representative current journeys and independent
   schedule facts: direct, mixed-mode, ferry, late-night, trackwork and broken
   connections. Current Trip Planner output is comparison evidence, not an
   unquestionable routing oracle.
4. Define snapshot scope, replacement semantics, identity, freshness and
   static/realtime version compatibility. Test cancellation, added/skipped
   stops, missing matches, upstream outages and out-of-order responses.
5. Specify migration of persisted trips, caches and focused journeys, plus
   package bootstrap and rollback. Preserve stable station identities where
   possible. Storage/library/router choices remain open, not owner-approved
   implementation details.
6. Measure upstream request load and compressed egress before/after. Choose
   refresh cadence and partition boundaries from those numbers; no promised
   cost reduction factor without evidence.

No new UI composition is selected here. Any novel download, recovery or
coverage screen follows design-comps before implementation. Once the data
and routing design is stable, offer debate; then write independently
verifiable implementation and browser-verification phases. Build starts in
a fresh context under backlog-item.

## Web Settings is independent

Web Settings uses the existing Trip Planner API and does not depend on this
item. Its UI is defined in `../../contracts/ui.md`; local preferences,
mode-aware caches and followed-journey behavior are in
`../../contracts/client-storage.md`, with the mode query in
`../../contracts/api.md`. Native routing work must preserve those rider-facing
semantics without reopening the Settings composition.

## Research retained for native design — 2026-09-06

This audit preceded the platform scope ruling; no implementation was started. Read the
current API, storage and UI contracts against `web/js/{api,main,journey,
focus,rowmodel,storage}.js`, `web/sw.js`, `internal/tfnsw/map.go`, the station
generator and captured ferry observations. The approved architecture survives
this audit as a native candidate, but an API-shaped adapter alone cannot
preserve its semantics.

### Cached source measurements

Inspected the four local `.gtfs/*.zip` files from the September 5 capture
using Python's `zipfile` and streaming `csv.DictReader`. Counts cover each
whole upstream bundle, before mode filtering, date filtering, deduplication
or compilation. These are neither new live observations nor client package
sizes. No `.env` was read and no authenticated request was made.

| Bundle | ZIP bytes | Uncompressed bytes | Trips | Stop-time rows | Calendar date envelope |
| --- | ---: | ---: | ---: | ---: | --- |
| Sydney Trains | 12,515,627 | 197,911,231 | 83,990 | 1,519,423 | 2026-09-05–2026-10-04 |
| NSW TrainLink | 39,890,343 | 208,958,056 | 58,630 | 666,249 | 2026-08-29–2027-09-08 |
| Metro | 1,064,707 | 8,876,052 | 3,123 | 65,495 | 2026-08-26–2026-12-31 |
| Sydney Ferries | 893,137 | 9,507,254 | 8,467 | 47,160 | 2026-08-28–2026-12-07 |

The envelope is the minimum `calendar.start_date` and maximum
`calendar.end_date`, not proof that every route runs throughout that period.
NSW TrainLink includes coach route types 204/205, which must be excluded.
All four contain stop times beyond 24:00; their maximum departure times are
31:35:06, 34:30:00, 26:22:27 and 25:12:00 respectively. No bundle has
`transfers.txt` or `pathways.txt`; none has any calendar-exception rows.
Exceptions therefore need separate fixtures rather than claiming these
captures exercise them. Missing transfer tables do not mean zero walking time.

Cached Sydney Trains and Metro contain no `feed_info.txt`. NSW TrainLink's
`feed_version` is `05092026-011236`; Sydney Ferries' is `05092026-010132`.
Do not require source `feed_version` as the sole version identifier.
SHA-256 hashes pin the inspected bytes:

```text
sydneytrains cc91b4554a336babaf258076db12e01818b612581436865f6261f75f897cbe28
nswtrains    413a28a62d8b57a5a886e00f6e651569f526e238201fcad93086f6abca14f7ca
metro        b5e986064f4b5ed495e611e9ef2158b4b5bb2870bffa6fd65ddeed2e89d0abd3
ferries      5a710c6244374b2759d27647c177497fd7e4748ae5fe1f02b8892de7988dc2ad
```

### Migration seams that need an explicit design

- **Walking connections:** the raw bundles do not supply a transfer graph.
  Verify a source for platform changes and cross-hub walks, including
  Wynyard–Barangaroo Wharf and Circular Quay rail–wharf connections. Current
  Trip Planner fixtures contain walking information that cannot be recovered
  just from service stop times. A distance heuristic alone does not verify a
  walkable connection. The current three-minute floor is slack *after* walking,
  not a universal walking duration. The 60-minute ceiling is conditional on a
  later acceptable journey arriving before the long wait ends, not a hard cap.
- **Operator coverage:** `trip_circularquay_manly.json` and its reverse include
  Manly Fast Ferry as well as F1. The four bundles above establish no MFF
  coverage. Investigate its separate feeds before claiming parity; removing
  currently offered services would require an owner scope ruling. Preserve
  the existing searchable hub boundary independently of operator coverage.
- **Station identity:** reuse verified rail hub IDs and the captured ferry
  boarding-stop mapping. Namespace raw identifiers by source; retain boarding
  stop/wharf/side separately from the saved-trip hub. In particular Circular
  Quay's shared hub does not make every platform-to-wharf change instantaneous.
- **Followed journeys:** `journeyKey()` currently uses every leg's line and
  scheduled departure. `refreshFocus()` only searches the selected pair's
  returned candidates. Neither is a GTFS trip-instance join. Define stable
  trip/service-date/boarding identities, independent followed-service updates,
  and safe treatment of legacy snapshots that cannot be uniquely matched.
  Never guess an attachment from a matching line name and clock time alone.
- **Freshness:** `boardModel()` treats the whole response as stale after
  90 seconds or a live failure. Stamping a local result with computation time
  would falsely renew its evidence; stamping it with package download time
  would immediately suppress useful schedules. Define schedule coverage,
  realtime source age and per-leg provenance separately, including the offline
  countdown treatment, before adapting home, board and detail.
- **Past register:** replacement realtime snapshots do not establish past
  actuals for a phone that was closed. Define retained observations versus
  scheduled history, preserving the current 24-hour board reach and the owner's
  scheduled-past fallback. An old prediction is not automatically a verified
  actual. Do not introduce a backend history archive implicitly.
- **Storage and shell updates:** `sw.js` activation deletes every cache except
  its current shell/data caches; a timetable Cache Storage store would be
  deleted unless that lifecycle changes. Keep package activation independent
  of shell activation, and specify old-tab readers, interrupted downloads,
  quota failures and rollback. Preserve the current synchronous saved-board
  paint while a worker/storage layer opens; the existing warm-paint bar is
  under 500ms, with a working-network answer under 2s.
- **Ordering:** `fetchLive()` guards success by station pair and relies on
  abort, while its non-abort failure path sets offline without that guard.
  The replacement needs a monotonic request generation covering preference,
  package and realtime changes for both success and failure. Recomputing an
  answer must not create another app-open, history view or prediction exposure.

These are design requirements to resolve, not changes to today's contracts.

### Public source check and next evidence gate

Read on 2026-09-06: the official
[Sydney Trains migration notice](https://opendataforum.transport.nsw.gov.au/t/sydney-trains-gtfs-r-version-2/2551)
identifies v2 realtime feeds and records v1 retirement on 2025-05-27. The
[Metro migration notice](https://opendataforum.transport.nsw.gov.au/t/ptms-sydney-metro-v2-gtfs-feed/4075)
identifies v2 schedule and realtime endpoints; its final transition date was
2024-03-25. Endpoint versions must be selected per source, not copied from
the static URL. These notices do not prove today's payload compatibility.
The documentation page and train technical PDF returned HTTP 403 to the web
reader. A subsequent direct HTTPS fetch succeeded; the technical-document
findings below use those retrieved files, not search excerpts.

Owner permission, 2026-09-06: “And yes, you may source the .env file without
printing the key.” The key was absent from the inherited process environment;
this permission authorizes loading it for authenticated read-only probes.
Next work: fetch current schedules and a bounded set of trip-update/alert
captures, record hashes/source timestamps, measure exact joins and unmatched
cases per source, and investigate MFF and transfer coverage. Keep credentials
out of command arguments, logs and fixtures. Probe scripts themselves never
read or source `.env`; this session loaded it under the owner's permission.

When native work resumes, after that gate, prototype package compilation and local routing in an
isolated experiment, measure routing/size on the target devices, and bring
the resulting coverage, transfer, history and offline-behavior decisions to
the owner. Package format, router, storage backend, horizon, partitioning and
cadence remain unselected. Offer debate when those decisions are settled;
only then write the build plan and start build in a fresh context.

### Authenticated feed observations — 2026-09-06

Ran `tools/probe-gtfs.py --out /tmp/trains-gtfs-20260906-design`: five static
downloads, two rounds of five trip-update feeds, four alert feeds; all 19
requests returned 200. Captured at 01:33–01:34 Australia/Sydney (September 5
15:33–15:34 UTC). The four existing schedule ZIP hashes exactly match the
cached audit above. MFF adds 11,324 compressed bytes. This is a nighttime
sample, not peak volume, availability statistics or a selected polling cadence.

`tools/inspect-gtfs.py` decoded standard fields with
`gtfs-realtime-bindings==2.2.0` and protobuf 7.36.1. Reproducible invocations
and limitations are in `tools/README.md`; hashes, source times, HTTP metadata,
counts and sizes are preserved in
`tools/fixtures/gtfs_realtime_summary.json`. Raw captures remain in `/tmp`.
The inspector rejects a deliberately corrupted capture before parsing.
No TfNSW extensions or normalized identities have been validated yet.

First-round results (gzip means local recompression, not measured egress):

| Trip-update source | Raw bytes | Gzip bytes | Exact static trip-ID matches | Feed timestamp age |
| --- | ---: | ---: | ---: | --- |
| Sydney Trains v2 | 79,085 | 19,273 | 254 / 308 | 13 seconds |
| NSW TrainLink v1 | 74,482 | 23,149 | 169 / 177 | 46 seconds |
| Metro v2 | 19,575 | 5,509 | 13 / 24 | 6 seconds |
| Sydney Ferries v1 | 4,312 | 1,739 | 3 / 19 | 15 seconds |
| Manly Fast Ferry v1 | 9,114 | 1,724 | 84 / 84 | 66 days |

All parsed headers declare `FULL_DATASET`. That does not imply equal coverage,
freshness, or field semantics. The five bodies total 186,568 raw bytes or
51,394 locally gzipped bytes. These are complete upstream feed bodies,
including irrelevant services and stale updates, not proposed client snapshots.

- MFF's two realtime bodies are identical, timestamped `2026-07-01T07:55:17Z`,
  with `start_date=20260701`. Its static calendar contains date ranges covering
  September, but current schedule accuracy still needs comparison. Exact ID
  matches would attach obsolete July predictions to September trips without
  service-date and freshness guards. The separate endpoints are documented in
  [TfNSW's MFF announcement](https://opendataforum.transport.nsw.gov.au/t/manly-fast-ferry-realtime-is-here/5397).
- Sydney Trains has no `start_date` or stop sequences in these trip updates.
  Its fresh feed header coexists with individual trip timestamps over a day
  old. Of 150 `SCHEDULED` updates, 52 lack an exact static ID; all 88
  `REPLACEMENT` and 68 `CANCELED` updates match exactly, while two `ADDED`
  updates do not. Service-day derivation and unmatched scheduled services
  therefore need investigation, not an assumption that every miss is added.
- Metro's 11 unmatched updates are all `ADDED`. NSW TrainLink's eight
  unmatched IDs end in `.ADDED`, but a suffix is not an approved relationship
  classifier. It supplies trip timestamps on only 12 of 177 updates.
- Sydney Ferries has only one exact match among eight `SCHEDULED` updates.
  Example: realtime `CI2245-SAT-IN.050926.32.2319` versus static
  `CI2245-SAT-IN.290826.32.2319`. A matching prefix is a diagnostic lead,
  not permission to discard date components. Two of its 58 updated stop IDs
  are absent from its static stops file. No trip timestamps are supplied.
- Cancellations, replacement services and skipped stops are observed in the
  train/metro/ferry captures; they need real fixture coverage in the eventual
  normalizer. Preserve original payloads before reducing them into fixtures.

The current application's mapped-response captures provide a useful scale
comparison: the three `departures_*.json` ferry boards each have four journeys
and serialize to 2,746–4,522 compact JSON bytes (382–500 locally gzipped).
Today's device does not download the raw GTFS bundles; it caches one small
pair-specific answer. No cost reduction is established by comparing those
responses to an unfiltered whole-network realtime body.

### Source specifications and unresolved joins

Retrieved the documents linked from TfNSW's documentation page to
`/tmp/trains-gtfs-docs`. The
[Sydney Trains v3.7 specification](https://opendata.transport.nsw.gov.au/sites/default/files/2026-04/Real%20Time%20Train%20Technical%20Document%20v3_7_Open_Data.pdf)
states that its bundle includes NSW Trains services, whose times outside the
intercity boundary are not accurate. It also includes non-revenue/charter
trips; pickup/drop-off permissions and route eligibility must be respected.
Do not union the two train sources or admit every rail-type trip indiscriminately.
Its replacement updates can represent changed stops, platforms or route, not
only changed times. Exact matching still needs trip-specific stop alignment.

The linked ferry technical document is version 0.7 from 2016, and its sample
IDs differ from today's captures. The linked Metro document also predates
the current PTMS feed. These are insufficient authority for inventing current
identifier normalization. The 2025 generic implementation specification
describes transfer/pathway files as conditional, but those files remain absent
from the captured source ZIPs. Current operator guidance, reference tables and
live comparisons must resolve these gaps.

### Web rollout question withdrawn

The earlier question about temporarily retaining the web planner during a
local-routing rollout is superseded by the September 6 ruling: the web
planner is retained as the selected architecture. No web cutover or fallback
removal is planned. Decide native bootstrap and online fallback when native
offline design resumes; do not infer approval of either strategy here.
