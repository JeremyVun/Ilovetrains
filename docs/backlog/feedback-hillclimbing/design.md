# Feedback hillclimbing

Status: design settled 2026-09-09 for this repo's phases; see
`build_plan.md`. Owner rulings are dated in the Decisions table. The other
repositories' rows in "Work across repositories" need their own backlog
items before the daemon can run end to end.

## What and why

Today the owner reads the day's ilovetrains feedback by hand: open
`analytics.jeremyvun.com/ui`, download the CSV, read every row, decide what
is a bug, fix it. This item automates the read-and-triage half and lets an
agent produce a verified, regression-tested fix branch for real bugs, with
the owner still deciding what ships.

The loop, end to end:

1. **Intake.** A daemon on the mac mini polls the analytics feedback API and
   picks up every new row.
2. **Triage.** A cheap model, in a sealed sandbox, reads the row and emits a
   structured verdict: bug, feature request, praise or noise; plus a
   reproduction story if it is a bug, and a "duplicate of" pointer if it
   matches an open finding.
3. **Investigate.** For a bug, the daemon commits the reproduction story as a
   playtest discovery case and launches a run. Playtest's grader turns what
   the actor observed into bug candidates, and its existing intake files them
   as findings, deduplicated by its consolidation pass.
4. **Fix.** The daemon watches playtest's event feed. A new finding is handed
   to a strong model in a fresh worktree of this repo. It reproduces the bug
   with the repo's own instruments, fixes it, adds a cheap deterministic
   regression test, runs the gates, and pushes a `fix/<finding>` branch with
   an entry in the pending changelog.
5. **Release.** The owner reads a digest, reviews the branch, and cuts a
   release by merging and running the deploy runbook. Nothing reaches
   production without that step.

Feature requests never enter steps 3 to 5. They are parked in a list the
owner reads. The line between bug and feature is mechanical: a bug is
behaviour that contradicts `docs/contracts/`; anything the contracts do not
promise is a feature and needs the owner.

## What exists already (verified 2026-09-09)

**Analytics feedback** (`../analytics`). Rows are immutable:
`id, project, category, feedback, rating, received_at`. There is no status
column, no webhook and no `since` parameter; `GET /feedback?project=&days=`
pages descending by keyset cursor and needs the global `ANALYTICS_READ_KEY`
or an Authelia session. The submission from this app is exactly
`{project, category, feedback}` (`docs/contracts/analytics.md`), so a row
carries no app version and no platform.

**Playtest** (`../playtest`). Runs locally at `127.0.0.1:4177`. The
`ilovetrains` project already exists there with a `user-stories` suite,
six personas, eight storage-state seeds and a `production` ring pointed at
the live site. Its findings ledger is the deduplicated defect store:
states `new/accepted/rejected/resolved/reopened`, fingerprints, evidence
rows, an LLM consolidation pass, project-scoped API tokens and a
cursor long-poll event feed at `GET /projects/:p/events/feed`
(`wait` clamps to 25 s, types include `finding.created`). Two constraints
shape the design:

- A finding must cite at least one run. There is no manual or external
  finding ingest. Feedback therefore becomes a finding only by driving a
  discovery run.
- The web driver does not confine navigation to the suite's `base_url`
  origin; only the API driver has an allowed-origins guard. Off-origin
  requests are recorded in the HAR, not blocked.

Its LLM client speaks OpenAI chat completions to whatever
`PLAYTEST_LLM_BASE_URL` names. The ilovetrains project's models are
`actor gpt5_6_terra`, `grader gpt5_6_sol`, `consolidation gpt5_6_terra`.

**Codex gateway** (`../codex-gateway`). Loopback only on the mac mini,
`127.0.0.1:8900`. Serves Anthropic `/v1/messages` and OpenAI
`/v1/chat/completions`; GPT models go through CLIProxyAPI, which owns the
Codex subscription OAuth. `gpt-6-astra` is not in its model allowlist today
(`GATEWAY_GPT_MODELS` overrides it). The `codex` CLI itself (0.153.4) uses
the subscription directly, which is how this repo already drafts copy.

**Codex sandboxing.** `codex exec` offers `-s read-only`,
`--ephemeral`, `--ignore-user-config` (drops the user's MCP servers,
including `node_repl`), `--ignore-rules`, `--output-schema <file>` for a
JSON-schema-constrained final answer, and `-c
sandbox_workspace_write.network_access=false`. `codex sandbox
--sandbox-state-disable-network <cmd>` is an outer seatbelt wrapper.

**This repo.** The Go server has no fixture mode; `TFNSW_BASE_URL` and
`TFNSW_FEED_BASE_URL` can point at any host, and `tools/fixtures/` holds 27
captured upstream responses used by Go tests through `httptest`. The server
calls exactly one Trip Planner path upstream, `/trip`
(`internal/tfnsw/client.go:146`); `/api/v1/stops` searches the bundled
station list locally, and the `departure_mon` and `stop_finder` fixtures
are probe captures used only by tests. The native feed client calls the
GTFS schedule and realtime paths listed in `internal/native/feed.go`
(verified 2026-09-09, build session). The web
client has an offline test lane (`web/test/`) and `tools/shoot-states.js`
freezes the network, seeds state and pins the clock. `AGENTS.md` is already
a complete brief for an agent verifying a change.

## Mechanism

### Trust boundaries

User feedback is hostile text. It crosses three boundaries and each one
narrows what it can do:

| Stage | Sees the raw text | Can write | Network | Output |
| --- | --- | --- | --- | --- |
| Triage | yes | nothing | none | JSON matching a fixed schema |
| Investigate | no, only the triage story | playtest run artifacts | the target ring only | run grade |
| Fix | no, only the finding and its evidence | a fresh worktree, no secrets | localhost and git push | a branch |

Two rules make this hold:

- The triage schema has no free-text field that later stages treat as an
  instruction. The reproduction story is a list of app actions in the app's
  own vocabulary. The daemon rejects any story containing a URL, hostname or
  IP before committing it, which closes the unconfined-navigation gap in the
  web driver for production-ring runs.
- The fix worktree is created by the daemon with no `.env`, no
  `TFNSW_API_KEY` and no analytics keys; the local server runs against the
  fixture stub. A fixer that needs a live upstream capture stops and asks.

### Intake

The daemon keeps a high-water mark `(receivedAt, id)` and walks
`GET /feedback?project=ilovetrains&days=all` with the read key, following
`nextCursor` in descending order until it reaches the mark, so no length
of downtime loses a row. Rows are persisted to the daemon ledger before
the mark advances. Because `received_at` is database `now()` in
independent transactions, a slow insert can commit below a mark already
advanced past it; every poll therefore rescans back to the mark minus
fifteen minutes and dedupes by `id`, and once a day it walks all retained
rows against the ledger's ids. Poll interval and daily budget are daemon config. Every row gets a
daemon-side record keyed by analytics `id` with its lifecycle
(`new → triaged → investigating → finding:<id> | parked | closed:<reason>`).
The analytics rows are never modified.

### Triage

One `codex exec -m gpt-5.6-terra -s read-only --ephemeral
--ignore-user-config --ignore-rules --output-schema triage.json`
per row, working directory a snapshot containing only `docs/contracts/`, the
open-finding titles from playtest and the row. Verdict fields:

- `kind`: `bug | feature | praise | noise`
- `contract`: the contract file and section the observed behaviour
  contradicts, required for `bug`
- `platform`: `web | android | ios | unknown`
- `native_only`: true when the story depends on behaviour the deviation
  contracts reserve to a native client
- `duplicate_of`: playtest finding id or null
- `story`: ordered app actions and the expected versus observed outcome
- `needs_owner`: true when the row mentions safety, money, data loss, or the
  contract itself looks wrong

The triage snapshot lists open and accepted findings by title, and
resolved findings from the last five releases with the version that fixed
them per platform, which the daemon ledger records at deploy time.
`duplicate_of` an open or accepted finding attaches the row as a mention and
stops. `duplicate_of` a resolved finding compares the row's
`clientVersion` with the fixed version for its platform: older attaches
as a stale mention and appears in the digest, equal or newer reopens the
finding through playtest so it re-enters the repair queue. A row with no
version (a client from before D4) attaches as a stale mention and is
flagged in the digest for the owner; it never reopens on its own. This is
why decision D4 matters.

### Investigate

Version one investigates on the web only. A story whose behaviour is shared
by every client (the contract applies to all three) runs on the web even
when the row's platform is Android or iOS. A story that only exists on a
native client, per `docs/contracts/android-deviations.md` and
`ios-deviations.md` (permissions, gestures, offline routing, the background
tracker), cannot be reproduced by driving the website: triage marks it
`native_only` and it is parked for the owner rather than closed as
not-reproduced. Playtest drives Android and iOS through Appium, so a later
item can add native rings on a self-hosted runner.

The daemon writes `stories/risk/<row-id>.yaml` (playtest enumerates cases
only under `stories/` or a directory holding its own `playtest.yaml`;
mode `discovery`, persona
`adversarial`, the triage story, two fixed report questions) into a
dedicated `feedback` suite in the ilovetrains playtest project, commits it,
and launches one run group against the `production` ring. Investigation
uses the live site because it needs no build, no secrets and no device.
The row closes as `not-reproduced` only when the run concluded, its grade
parsed, intake completed, and no finding of any kind (bug candidate or a
minor or major grader finding) cites the run. A run that failed, timed
out, or produced no valid grade is retried once and then flagged
`needs_owner`; it is never mistaken for a clean result. Not-reproduced rows
appear in the digest, and the owner can still promote one by hand from
the run.

### Findings and dedupe

Playtest owns dedupe: fingerprints at intake and the consolidation pass. The
daemon adds the cheap layer in front so most duplicates never cost a run:
the triage prompt sees open finding titles, and identical normalised text
within the window is collapsed before triage. Cost caps are hard: at most N
investigations per day and one per finding fingerprint per release.

### Fix

The daemon long-polls the events feed for `finding.created` (and reopened)
in state `new`, and for each one that is not `needs_owner`:

1. Allocate an attempt id `<finding-id>-<n>` in the ledger. `git fetch
   origin` then `git worktree add -b fix/<attempt-id>
   /private/tmp/hillclimb-<attempt-id> origin/main` in this repo, verified
   with a landmark file. The owner's checkout holds `main`, so the
   worktree is always on its own branch and never on `main`. A restarted
   daemon reads its ledger: an attempt with a pushed branch is resumed on
   its Codex thread under a fresh claim; anything earlier is abandoned,
   its worktree removed, and a new attempt allocated. Earlier attempts'
   branches and PRs stay as history and are closed by the daemon with a
   comment naming the superseding attempt.
2. `codex exec -m gpt-6-astra -s workspace-write -C <worktree>` with a
   brief that is the finding, its evidence, `AGENTS.md`, and three rules:
   restore contract conformance, never edit a contract, add a regression
   test that fails before and passes after.
3. The fixer runs the affected platform's gates from `AGENTS.md`. Web bugs
   get a `web/test/` case or a `shoot-states.js` state; API bugs get a Go
   test on a captured fixture; native bugs get the platform unit test.
4. The daemon pushes `fix/<attempt-id>` and opens the PR with a one-line
   changelog entry in a fixed position of the description, which the
   release PR collates.
5. The daemon releases the lease with outcome `suggested` and the PR URL
   as `external_ref`, and marks the row `fixed:branch`.

A fixer that wants to change a contract, edit `web/sw.js` beyond the
mechanical `VERSION` bump, or cannot make the gates pass stops and the
finding is flagged `needs_owner`. The bump itself is required, not
forbidden: `AGENTS.md` demands it in the same change as any `SHELL` file
edit, and most web fixes touch a `SHELL` file.

### Release

The owner merges fix PRs as they see fit. Merged fixes accumulate in the
standing release PR until the owner merges that too. On that merge the
daemon's release worker, in a private worktree at the merged commit:

1. Builds and pushes the image with `ILOVETRAINS_VERSION` set to the
   released version, then commits that version into the infra stack's
   `config.env` so the stack pulls the numbered tag, never `latest`
   (the app website stack already pins this way). It deploys through the
   runbook and confirms with the runbook's verify step that production
   reports the released version and image digest before recording
   success. One release slot per project serialises deploys.
2. Records the deploy job id and digest on the release PR and, for every
   fix it contains, the fixed version per platform in the ledger.
3. Re-launches each fixed finding's `feedback` discovery case against the
   production ring. Playtest's automatic resolution resolves the finding
   from that newer disproving run, which is the only resolution path a
   `developer` token has. A finding still open after two such runs is
   flagged `needs_owner` in the digest, since the fix did not disprove the
   claim as filed.

The daemon never merges anything itself and never touches the owner's
shared checkout.

### Owner surface: GitHub pull requests

Every repo involved is hosted on GitHub, so the owner surface already
exists and already has a phone app with push notifications. Nothing is
built and nothing is tunnelled:

- A fix is a pull request from `fix/<finding-id>` to `main`, opened by the
  daemon with the finding link, the evidence, the gate results and the
  regression case. Review requests notify the owner's phone.
- Approving is merging the PR. Rejecting is closing it; the daemon marks
  the finding not-fixed with the close comment.
- The pending changelog is one standing **release PR** the daemon keeps
  open and rebuilds after every merged fix: it bumps `web/js/version.js`
  and `web/sw.js` `VERSION`, always, and collates one line per merged fix. Merging the release PR is the cut. The daemon sees
  the merge, builds and pushes the image, runs `deploy.sh`, and comments
  the deploy job id and digest on the PR.
- Parked feature requests and not-reproduced rows go to a daily digest
  issue in the repo, one issue per day, closed by the owner or superseded.

The mac mini therefore makes outbound HTTPS only: to analytics, to
playtest (local today, the VM if hosted playtest moves there), and to
GitHub with a fine-grained token scoped to these repositories. Nothing
connects inbound to the mac mini, and the VM never needs to reach it.

Push and email services are not needed. FCM would have required building
a client app to register for it; ntfy was only attractive because it ships
one. The GitHub app makes both moot.

## Who does what

Three parties, one job each. Nothing in this design asks any of them to
take on another's job.

- **Analytics is the inbox.** It stores rows and answers a list query. It
  never calls out. No message protocol is needed: the daemon polls the
  existing JSON list with a high-water mark, and the only "contract" is the
  wire shape: an envelope `{project, days, generatedAt, nextCursor,
  feedback: [...]}` whose rows are `{id, receivedAt, project, category,
  feedback, rating?}` today, plus `platform` and `clientVersion` once the
  analytics item lands. The client sends the same two JSON names.
- **Playtest is the judge and the ledger.** It reproduces claims, grades
  them, files and deduplicates findings, and records fix suggestions. It
  never calls out either; its doctrine forbids webhooks and exporters, and
  that is what keeps its ledger trustworthy. Consumers pull from its event
  feed.
- **The daemon is the hands.** It moves items between the other two and
  runs the builder. It is the only party that holds credentials for all of
  them and the only one that touches a repo. Its whole state is the row
  ledger and the per-project manifest.

Playtest is therefore not the orchestrator, and the builder does not live
inside playtest hosted. The reasons, recorded so they are not relitigated:

- A judge that writes the code it grades is no longer independent. The
  value of a playtest finding is that nobody with an interest in the fix
  produced it.
- The builder needs a full dev environment: worktrees, emulators,
  simulators, git push rights, subscription-backed CLIs. That is a machine
  with the owner's credentials, not a hosted control plane. Putting it in
  playtest turns playtest into a CI/CD system with a different trust
  posture.
- Playtest's own `docs/guidance/finding-repair-policy.md` already draws
  this line: "Add and run regression coverage: Builder". The design follows
  it rather than crossing it.
- The connector each way already exists. Daemon to playtest: the files API,
  commit, run groups. Playtest to daemon: the events feed and the
  `fix_suggested` transition. No new hook on hosted playtest is needed for
  version one.

If the experiment works, the intake and triage half is generic across
projects and could later move into playtest as a "feedback source" feature.
The builder half should stay outside regardless.

### Claiming a finding

Playtest is the control plane for findings. The daemon is the control plane
for repairs and releases. They meet at the finding id and nowhere else.

The events feed is a wake-up, not a queue. Events are never "put back"
because they are never taken: a daemon that reads ten `finding.created`
events has learned that the queue changed, nothing more. The queue is the
findings list filtered by one eligibility rule that lives in playtest so
every daemon computes the same answer: state `new` or `reopened`, no live
repair claim, and repair outcome `none`. The outcome is a field the lease
release writes on the finding row (`none | suggested | not_fixed |
needs_owner`); a finding leaves the queue the moment a repair concludes and
returns only when the owner resets the outcome (retry) or playtest reopens
it on a confirmed recurrence, which clears the outcome. The lock is a claim
on one finding:

- `POST /findings/:f/repair-claim` with the daemon's identity and a lease
  TTL. Playtest answers 200 with the lease and a monotonically increasing
  generation, or 409 if another live claim exists. This is a
  compare-and-set on the finding row, the same shape as the runner pool's
  claim board.
- Heartbeat and release carry the generation; playtest rejects either
  with a stale generation. The daemon kills its fixer subprocess the
  moment a heartbeat is rejected or cannot be delivered before the TTL,
  so a partitioned daemon stops rather than continues.
- Release writes the outcome (`suggested`, `not_fixed`, `needs_owner`) on
  the row. `suggested` carries `external_ref` (the PR URL) and emits a
  `finding.repair_suggested` event with source `repair`, distinct from the
  run-backed `finding.fix_suggested` that automatic resolution emits.
  Playtest has no route to submit a suggestion today; this release is
  that route. An expired lease is reclaimable, so a crashed daemon does
  not strand a finding.
- Only the daemon holding the current generation pushes a branch or opens
  a PR. The fixer subprocess has no GitHub credential and no push access;
  it commits locally and the daemon publishes after a final heartbeat
  succeeds.
- The daemon takes one claim per configured slot. With one slot it claims
  the oldest eligible finding, works it to completion, then looks again.
  Two daemons on two machines cannot both hold the same finding, and one
  daemon cannot accidentally hold two.

This is the one hook hosted playtest needs. It does not make playtest a
build orchestrator: a lease arbitrates who may work; it never dispatches
work or knows what the work is. It belongs in playtest because the claim
state must live with the finding row, or two ledgers would disagree about
whether a finding is taken.

The daemon keeps its own ledger for what playtest should not know: analytics
row, triage verdict, worktree, branch, gate results, owner approval, deploy
job id. Playtest sees only the finding transitions and an `external_ref`
naming the branch.

### Two suites, not one

- **Hosted `feedback` suite** in the ilovetrains playtest project: discovery
  cases written by the daemon from triage stories, run against the
  production ring. The suite of record is the playtest database, which is
  right for exploration.
- **Checked-in regression suite** in this repo (`playtest/regressions/`):
  journey cases with a `success:` gate, one per fixed finding, written by
  the fixer in the same branch as the fix. The gate runs them with
  `--no-grade` and no model configured, which is playtest's only keyless
  path: committed baselines replay step for step, drift or an action
  failure fails the run instead of healing, and a case with no baseline
  cannot silently record. Gates use only the deterministic checks the
  web driver accepts (`element_exists`, `url_matches`, `api_called`,
  `console_errors`, `accessibility_violations`, `invariant`);
  `screen_shows` is mobile-only and `response_*` are API-only, and the
  natural language `assert` calls the grader, so none of those appear in
  this suite.
  They run against a local server on the fixture stub, as part of the
  repo's gates.

  Replay compares accessibility snapshots for exact text, and Home prints
  absolute times, so a baseline only replays if the browser clock is the
  same instant every run. Playtest has no clock setting today and the app
  pins its clock only through the `window.__trains.now` hook the shooter
  calls after load. Each regression case therefore names a fixed instant
  equal to its fixtures' capture anchor, and the stub serves fixtures
  verbatim rather than shifting them. The instant reaches the browser
  through playtest's `app.clock` (D14), a playtest item that Phase 3
  waits on. A regression lives with the
  code it guards, so it ships and reverts with it.

### What the daemon is made of

The daemon is generic. Project knowledge lives in the project: `AGENTS.md`
is the verification brief, the gates are scripts in `tools/`, and the
fixer runs *inside* the project checkout, so it has the same context a
human agent session has. What the daemon needs per project fits in a
manifest: repo path, main branch, playtest project and ring, models, budget,
slot count. This is the same split as a CI runner and a project's CI file,
and the same split playtest itself makes between its runner and a suite.

It is one program with four workers sharing a ledger:

1. **Intake and triage**: analytics poll, sealed triage call, case writer.
2. **Repair**: claim, worktree, fixer, gates, branch, fix suggestion.
3. **Release**: when the owner merges the release PR, check out its exact
   merge commit in a private worktree, build and push the image, run the
   deploy runbook, record the job id. It never merges, never pushes
   `main`, and never touches the owner's shared checkout.
4. **Owner surface**: PRs, the standing release PR and the daily digest
   issue on GitHub.

It is a separate repository because it is multi-project, holds credentials
for three services, and runs as a LaunchAgent on the mac mini the way
`codex-gateway` does. It cannot live inside one project checkout. If the
repair worker proves generic it can later move into the playtest monorepo
as a sibling of the test runner; the trust posture is the same, a runner
the owner installs on their own machine.

**Driving the model.** Three options, one recommendation:

- `codex exec`: the CLI in non-interactive mode. One process per task,
  seatbelt sandbox, approval policy, `--output-schema`, `--json` events,
  subscription auth. Zero code to adopt.
- `@openai/codex-sdk`: a typed wrapper that spawns the same `codex` binary
  and exposes threads, events and resume. Same sandbox, same subscription.
  `codex-gateway`'s playtest adapter already uses it, so it is proven on
  this machine.
- OpenAI Agents SDK: a framework for writing your own agent on the
  Responses API with your own tools, handoffs and guardrails. It is billed
  as API usage and carries none of Codex's coding harness or sandbox. It
  answers a different question and would cost money per token.

Recommendation: the Codex SDK. It is `codex exec` with a typed event stream
and thread resume, which matters when a fixer hits a usage limit
mid-task and must continue rather than restart. Triage stays a one-shot
read-only thread with an output schema.

### MCP or skills

An MCP server is a tool surface an interactive agent calls during a
session. The daemon's loop does not need one; it is a program calling an
HTTP API. Where an MCP helps is the fixer: launching the regression case
and reading its grade without shelling out. Two cautions decide the shape:

- The fixer processes text derived from untrusted feedback. An MCP that can
  accept, resolve or merge findings, or edit suites, lets injected text do
  those things. The fixer's token is `developer` at most: read findings,
  launch runs on named suites, post a fix suggestion. Never `reviewer` or
  `admin`.
- One MCP per privilege, never one god MCP. The cleanest form is one
  server binary whose tool list is derived from the role of the token it
  was started with, with playtest enforcing the role server-side either
  way. The triage agent gets no MCP at all.
- For version one the fixer uses the `playtest` CLI on the checked-in
  suite, which needs no hosted token at all. The MCP is a later, small
  item in the playtest repo.

## Work across repositories

| Repo | Change | Needed by |
| --- | --- | --- |
| `../playtest` | Deterministic origin guard in the web driver: abort every request and refuse every navigation whose origin is not `base_url` or `app.allowed_origins`, enforced in the driver, not the prompt. | Investigation against the production ring. |
| `../playtest` | `app.clock` for the web driver: a fixed instant and timezone applied with Playwright's clock API at context creation, honoured in record and act alike. Built in this run as `../playtest/docs/backlog/web-clock/` (owner 2026-09-09). | Stable regression baselines (Phase 3). |
| `../playtest` | Repair claim on findings: lease with TTL, heartbeat, release with outcome, compare-and-set, `external_ref` set on release. | Repair worker. |
| GitHub | Fine-grained token for the daemon: contents, pull requests and issues on the target repos. | Owner surface. |
| infra `../projects` | `stacks/ilovetrains` pins `ILOVETRAINS_VERSION` in `config.env` and the compose image tag reads it, replacing `latest`. | Release worker. |
| `../analytics` | Optional `platform` and `client_version` columns on `user_feedback`, accepted on POST, returned on list and download. | Triage, reopen logic. |
| `../codex-gateway` | Add `gpt-6-astra` to `GATEWAY_GPT_MODELS`. | Only if playtest's grader or consolidation should use it; the fixer uses the CLI. |
| this repo | Feedback submission sends platform and version on web, Android and iOS; `tools/tfnsw-stub`; `playtest/regressions/` suite wired into the gates; pending changelog surface; `docs/contracts/hillclimbing.md`. | Fix stage. |
| new `~/projects/hillclimb` | The daemon: intake, triage, case writer, feed watcher, fixer runner, digest. | Everything. |

This backlog item owns only the "this repo" row. Each other row is its own
item in its own repo, and the daemon's build plan cites them as
prerequisites.

## Decisions

| # | Question | Recommendation | Ruling |
| --- | --- | --- | --- |
| D1 | New platform product, or a thin daemon that composes analytics, playtest and codex? | Thin daemon. Playtest's findings ledger already is the tracker; building a second one is the expensive part. | open; owner asked 2026-09-09 whether playtest should orchestrate end to end or host the builder. Answer in "Who does what": no to both. |
| D2 | Where does the daemon live? | New repo `~/projects/hillclimb`. It is multi-project, holds three services' credentials and runs as a LaunchAgent, so it cannot live in a project checkout; the project supplies context through `AGENTS.md` and a manifest. | **Separate repo**, owner 2026-09-09. |
| D3 | Autonomy boundary for the fixer | Branch plus pending changelog line. Merge and deploy happen only through the daemon's release worker on the owner's explicit approve and cut. Bugs only, where bug means contract violation. | **Yes**, owner 2026-09-09; owner noted someone must babysit merge and deploy, answered by the release worker. |
| D4 | Add `client_version` and `platform` to feedback submission? | Yes, as its own phase across analytics and all three clients. | **Yes**, owner 2026-09-09. |
| D5 | Investigate against production or a local fixture ring? | Production for v1; fixtures at fix time for the regression test. | open |
| D6 | Notification and approval surface | GitHub PRs, a standing release PR and a daily digest issue; the GitHub phone app notifies. No console, no tunnel, no push service, no admin APK. | **Yes, reuse GitHub**, owner 2026-09-09. |
| D7 | Regression coverage form | One checked-in playtest journey case per fixed finding, replayed deterministically in the gates. | **Yes**, owner 2026-09-09: "regression is just another playtest story". |
| D8 | Web-driver origin confinement | Fix in playtest deterministically, in the driver, with no agent-side bypass. The daemon's URL-in-story rejection stays as a second layer. | **Yes**, owner 2026-09-09. |
| D9 | `gpt-6-astra` in the codex gateway | Owner will add it. Fixer still runs through the CLI. | **Yes**, owner 2026-09-09. |
| D10 | Playtest MCP | Later, one MCP per privilege, tool list bound to token role. Not required for version one. | **Agreed in principle**, owner 2026-09-09. |
| D11 | Who arbitrates a finding between daemons? | A repair claim (lease) on the finding row in playtest; the daemon renews it while its fixer runs; queue is the findings list, events only wake the daemon. | **Agreed as unavoidable**, owner 2026-09-09. |
| D12 | How the daemon drives Codex | `@openai/codex-sdk` (same binary and sandbox as `codex exec`, plus typed events and thread resume). Not the OpenAI Agents SDK, which bills API usage. | open, no objection raised 2026-09-09 |
| D13 | Connectivity of the mac mini | Outbound HTTPS only, to analytics, playtest and GitHub. No inbound path, no tunnel. | Owner 2026-09-09: no tunnel; satisfied by D6. |
| D14 | How a regression case pins the browser clock | Add `app.clock` (fixed instant and timezone, applied with Playwright's clock API at context creation) to playtest's web driver. It is generic, every project replaying time-dependent screens needs it, and it keeps test hooks out of the app. The alternative is an app-side override read from storage state on non-production hosts, which ships without a playtest change but puts a test seam in the product. | **Playtest `app.clock`**, owner 2026-09-09. Same day, at build start, the owner ruled it is built in `../playtest` as part of this run (its own item, `docs/backlog/web-clock/` there) so Phase 3 records its baseline now rather than waiting. |
| D15 | Does the release PR bump the service worker? | Always, because version.js is a SHELL file | Orchestrator 2026-09-09 after Fable review; follows the AGENTS.md non-negotiable rule |
| D16 | May a fixer change `site/`? | No in version one: the release worker deploys only the app image | Orchestrator 2026-09-09 |

## Relationship to `commute-feedback`

The commute-feedback feature covers product changes from the owner's commute
notes: rear cab, lowest-cost header choice, direct-only, tracker honesty.
Its rules live in the [storage](../../contracts/client-storage.md) and
[UI](../../contracts/ui.md) contracts. It is a calibration sample for this
loop: when the daemon runs, its triage of those
same notes should classify the cab as a bug and the other three as
features needing the owner.

## Rejected alternatives

- **A general issue-tracking platform first.** Every piece it would need
  (dedupe, states, evidence, review UI, tokens, event feed) exists in
  playtest. Earn the abstraction with a second project, not up front.
- **Manual finding ingest into playtest.** Playtest forbids findings without
  run evidence, and that rule is what makes its ledger trustworthy. Driving
  a run is the honest path and doubles as reproduction.
- **Running the loop on the Digital Ocean VM.** Fixing needs the full dev
  environment, emulators and simulators, and the subscription-backed CLIs.
  The mac mini has all of it and costs nothing per token.
- **Encoding version and platform inside the feedback text.** Works without
  a server change but pollutes the message the owner reads and is fragile
  to parse.

## Verify before build

- [verify] analytics `POST /feedback` keeps ignoring unknown JSON fields
  (`json.Unmarshal` into a struct at `server/internal/api/feedback.go:63`,
  no `DisallowUnknownFields`) so clients may send `platform` and
  `clientVersion` before the columns exist.
- [verify] `gpt-6-astra` is accepted by `codex exec -m` under the
  subscription in non-interactive mode with `--output-schema`.
- [verify] `codex exec -s read-only` with `--ignore-user-config` really
  starts no MCP server and `-c sandbox_workspace_write.network_access=false`
  blocks egress on macOS seatbelt for the triage call.
- [verify] playtest's grade on a discovery run with an `adversarial` persona
  files `bug_candidates` as findings automatically for a suite created
  through the files API, with no console click.
- [verify] Codex SDK exposes sandbox mode, approval policy, working
  directory and output schema equivalently to `codex exec`, and resumes a
  thread after a usage-limit error.
- [verify] what `finding.acknowledged` means in playtest today, so the
  repair claim does not duplicate an existing transition.
- [verify] automatic resolution treats a discovery run with no candidate
  for the case as a disproving run for that `(suite, ring, case)` triple;
  if it only counts journey passes, the post-deploy step needs a journey
  case instead.
- [verify] GitHub fine-grained token scopes needed to open PRs, comment,
  and read merge state on a private repository without `gh` installed.
