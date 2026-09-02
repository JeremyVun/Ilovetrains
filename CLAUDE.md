# trains_app — ilovetrains

Sydney train and metro clients that answer “What train should I take right
now?” with no account, ads or server-side personal state. The web app is live
at https://ilovetrains.jeremyvun.com.

The installable web PWA (and, later, native Android and iOS clients) use the
same stateless Go JSON API, which caches Transport for NSW Open Data. Saved trips, history, prediction,
location and focused journeys stay on the device.

## Read first

- `AGENTS.md` — execution, verification and repository rules for agent work.
- `docs/PROJECT.md` — product purpose, principles and design process.
- `docs/contracts/api.md` — binding backend API and caching behavior.
- `docs/contracts/client-storage.md` — binding persisted client state,
  prediction, focus and home inference.
- `docs/contracts/ui.md` — binding client behavior, visual language and
  calibration exemplars.
- `docs/ROADMAP.md` — work queue and candidate product directions.
- `docs/references/tfnsw-open-data.md` — upstream observations. Resolve any
  **[verify]** item with a correctly invoked live probe before relying on it.
- `docs/operations/deploy.md` — production topology, deployment and checks.
- `docs/backlog/` — disposable workspaces for active design and build work.
  Completed items are closed out into contracts and deleted.
- `tools/README.md` — verification instruments, invocation and known traps.

Contracts change in the same commit as the behavior they describe. Backlog
folders are never durable documentation: when an item ships, migrate only its
current contracts, seams and decisions into `docs/contracts/`, update surviving
references, and delete the entire folder. Git retains any history.

## Structure

- `cmd/server/` — Go entrypoint. It serves the API and `web/` at `/`.
- `internal/api/` — handlers, validation, cache headers and error envelope.
- `internal/cache/` — TTL cache, single-flight and stale-on-error behavior.
- `internal/tfnsw/` — TfNSW client, upstream types and response mapping.
- `web/` — dependency-free vanilla ES-module PWA, service worker and tests.
- `tools/` — TfNSW probes, captured fixtures and browser verification tools.
- `Dockerfile` and `docker-bake.hcl` — the production image build.
- `../projects/stacks/ilovetrains/` — production compose/config in the infra
  repository; it is not owned by this repository.

## Local development

Never read or source `.env` without explicit user permission. This includes
commands that load it indirectly. Never print or commit `TFNSW_API_KEY`.

With `TFNSW_API_KEY` already present in the process environment:

```sh
go run ./cmd/server
```

Open http://localhost:8080. Runtime variables are `TFNSW_API_KEY` (required),
`PORT` (default `8080`), `WEB_DIR` (default `./web`) and
`MIN_CONNECTION_TIME` (default `3m`).

Primary test gates:

```sh
go test ./...
(cd web && npm test)
```

The web client has no dependency installation or build step. There is no
native client in this repository yet; the web app is the reference
implementation every later port is measured against (see `docs/PROJECT.md`,
"Native clients").

## Verification and tools

Read `tools/README.md` before trusting or modifying an instrument. In
particular:

- `tools/screenshot.js` captures a real Chromium viewport and checks for
  viewport lies and horizontal overflow.
- `tools/shoot-states.js` seeds and drives the real web client while checking
  geometry, scrolling, tap targets and content reachability.
- `tools/measure-open.js` measures cached paint and live-data timing.
- `tools/probe-tfnsw.sh` makes live upstream requests and requires an API key;
  use captured fixtures for normal tests.

Visual behavior needs a real-client drive at the affected phone sizes and
schemes. Unit tests alone do not prove layout, service-worker or offline
behavior. Follow the exact invocation documented by each instrument before
believing a failure.

## Non-negotiable rules

- The server remains stateless. Do not send location, saved trips, history,
  rides or identity to it without an owner ruling and contract change.
- The API key exists only in the server process.
- Any change to a file listed in `web/sw.js`'s `SHELL` array must bump
  `VERSION` in the same change. Returning browsers otherwise keep old code.
- Develop service-worker changes with “Update on reload” or a throwaway
  browser profile; the browser tools use a throwaway profile by default.
- Push landed source changes to GitHub. A source push does not deploy the app;
  production is built and deployed from this machine using the operations
  runbook.
