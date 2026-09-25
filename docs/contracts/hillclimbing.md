# Contract: Automated fixes

This binds any automated fixer working in this repository: an agent handed
either a filed finding, told to restore the behaviour a contract promises, or a
feature the owner approved, told to build exactly that, and expected to leave a
branch and a pull request behind. The owner still decides what merges and what
ships. How findings are gathered, triaged and handed out, and how a feature is
requested and approved, live outside this repository and are not described
here.

Everything in [AGENTS.md](../../AGENTS.md) applies to a fixer as it does to any
other agent. This contract adds the limits that exist because no human read the
brief.

## What a bug is

A bug is behaviour that contradicts a file in `docs/contracts/`. The fixer
names the file and the section it read in its pull request, and the fix is
whatever restores that promised behaviour.

Anything the contracts do not promise is a feature. A fixer working a finding
never builds a feature, never improves something the contracts are silent
about, and never resolves an ambiguity in its own favour. If no contract
sentence is contradicted, the finding is out of bounds and the fixer stops with
`needs_owner`.

## What a feature is

A feature is a change the owner approved in writing before the fixer started.
The approval is a spec: the behaviour the product will have, the checks that
prove it, the surfaces it touches, and the contract sentences that will
describe it once built. The fixer builds what the spec says and nothing more.
Where the spec is silent, the fixer does the least, and where the least is not
obvious, it stops with `needs_owner` rather than deciding for the owner.

A feature ships with the contract sentences the spec names, added under
`docs/contracts/` in the same pull request, so that from then on a bug in it is
a bug. The fixer adds sentences and removes none. The sentences describe the
behaviour the pull request delivers, in the voice of the contract they join.

## What a fixer may change

`docs/contracts/`, `assets/comps/latest/` and `tools/baselines/` are never
edited by a fixer working a finding. They are the statements a fix is measured
against, so a change to any of them turns a failing check into a passing one
without changing the product. A fixer building an approved feature may add
sentences under `docs/contracts/`, never remove any, and never touches this
file. The only edit permitted in `web/sw.js` is the `VERSION` constant.

That bump is mandatory, not merely allowed. Any change to a file listed in the
`SHELL` array of `web/sw.js` bumps `VERSION` in the same change, exactly as
[AGENTS.md](../../AGENTS.md) requires; most web fixes touch a `SHELL` file.
Adding or removing a `SHELL` entry is an edit beyond the constant and stops
with `needs_owner`.

| Path | May a fixer change it? | Why |
| --- | --- | --- |
| `cmd/` | Yes | Server entrypoint; a fix here restores [api.md](api.md). |
| `internal/` | Yes | Handlers, cache, TfNSW mapping and native publication are the API's behaviour. |
| `web/` | Yes | The reference client, its modules and `web/test/`. |
| `web/sw.js` | Only `VERSION` | The shell strategy is the owner's; the bump is mandatory with any `SHELL` file edit. |
| `web/js/version.js` | No | Only the release pull request bumps the canonical version. |
| `web/downloads/` | No | Built signed release artefacts, not source. |
| `site/` | No | The release worker deploys only the app image, so a merged website fix would sit undeployed. |
| `android/` | Yes | Kotlin sources and its JVM and device tests. |
| `ios/` | Yes | SwiftUI sources and its XCTest and UI tests. |
| `native-data/` | No | A verified public timetable, replaced by capture rather than by editing. |
| `web/stations.json`, `android/app/src/main/assets/stations.json`, `ios/ILoveTrains/Resources/stations.json` | No | Byte-identical copies of `internal/stations/stations.json`, written by `tools/build-stations.js` and never hand-edited. |
| `assets/` | No | Durable media, and `assets/comps/latest/` is the calibration exemplar a screen is judged against. |
| `tools/` | Only to add the regression | A new `shoot-states.js` state, or a `playtest/regressions/` case. An instrument's own behaviour is not a fix surface, and capturing a fixture needs the owner's key. |
| `tools/baselines/` | No | The frames a visual check compares against. |
| `playtest/regressions/` | Yes | The checked-in journey suite is where a user-visible regression case goes. |
| `docs/contracts/hillclimbing.md` | No | The fixer's own permission. |
| `docs/contracts/` elsewhere | Only to add sentences, only for an approved feature | The promise a fix is measured against; a feature's pull request is where its promise is written down. |
| `docs/` elsewhere | No | Runbooks, references, roadmap and backlog workspaces belong to the owner and to other sessions. |
| `Dockerfile`, `docker-bake.hcl` | No | The production image and release build shape. |
| `go.mod`, `go.sum` | No | A fix does not add a dependency. |
| `third_party/` | No | Vendored upstream sources. |
| `AGENTS.md` and `CLAUDE.md` (one file, symlinked), `README.md`, `LICENSE` | No | Repository rules and project statements. |
| Repository dotfiles and directories, such as `.gitignore`, `.dockerignore` and `.claude/` | No | Repository, build and session configuration. |

The most specific row that matches a path wins. Anything the table does not
reach is not a fix surface, and a fixer that believes it needs a file the table
refuses stops with `needs_owner` rather than working around the limit.

## Stopping

`needs_owner` is the outcome for anything this contract does not allow: no
contract is contradicted, the fix would need a never-edit file, the gates
cannot be made to pass, or the reproduction needs data the fixer cannot
capture. The fixer stops, leaves no partial fix behind, and reports what it
found and which rule stopped it. A stopped attempt is a complete answer, not a
failure.

## Environment

A fixer runs against the fixture-backed TfNSW stub in `tools/tfnsw-stub/` with
no `TFNSW_API_KEY` in its environment. It never makes a live upstream request
and never reads `.env`. A bug that can only be reproduced from a capture the
stub does not hold stops with `needs_owner`, because capturing it needs the
owner's key.

## The regression

Every fix carries a regression that fails on `main` and passes on the branch,
and every feature carries the acceptance checks its spec names, which fail on
`main` and pass on the branch. The pull request shows both runs.

- API behaviour: a Go test against a captured fixture.
- Client logic: a `web/test/` case, or a `shoot-states.js` state where the
  behaviour is only visible in a real client.
- Anything a user sees: a journey case in `playtest/regressions/`.

A fix that reaches more than one of these carries the regression for each. A
regression that cannot be written to fail on `main` has not reproduced the bug,
so the attempt stops with `needs_owner`. An acceptance check that already
passes on `main` means the feature, or that part of it, already exists, and the
attempt stops with `needs_owner` saying so.

## The pull request

A fix branch is `fix/<attempt-id>`, where the attempt id is the finding id
followed by the attempt number, and its pull request title is the finding
title. A feature branch is `feature/<group-id>-<n>`, where the group id names
the approved request and `n` the attempt, and its title is the request's label.

The first line of the description is the changelog entry: one sentence, under
sixty words, in the voice the `user-facing-copy` skill defines, written for the
rider who hit the bug rather than for the reviewer. The release pull request
collates these lines verbatim, so the first line carries no prefix, issue
number or gate result.

The rest of a fix's description carries the finding link, the contract file
and section cited, the results of the gates listed in
[AGENTS.md](../../AGENTS.md) for the platforms the fix touched, and the two
regression runs. A feature's description carries the approved spec, the
contract sentences it adds, shown before anything else because they are what
the reviewer is agreeing to, the gate results and the two runs of each
acceptance check.

## The release pull request

The release branch is `release/<version>`. It bumps `web/js/version.js` and
`web/sw.js`'s `VERSION`, and lists the first line of each merged fix and
feature under that version. Both bumps happen mechanically on every release, because
`web/js/version.js` is in the `SHELL` array and [AGENTS.md](../../AGENTS.md)
requires the service worker bump in the same change as any `SHELL` file edit.

Merging the release pull request is the deploy trigger. The deploy runs against
that exact merge commit and its job id is recorded on the pull request. The
manual runbook in [../operations/deploy.md](../operations/deploy.md) stays
valid and describes what the release merge causes.
