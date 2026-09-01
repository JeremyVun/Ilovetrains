# trains_app — "ilovetrains"

Sydney next-train PWA: zero-tap departure board for saved trips, no ads.
Thin-client PWA + stateless Go caching proxy over TfNSW Open Data.
Live at https://ilovetrains.jeremyvun.com. Source on GitHub:
git@github.com:JeremyVun/Ilovetrains.git (push after landing work; deploys do
NOT go through GitHub — the image is built and pushed from this machine).

## Status

The v1 backend, web client and installable/offline PWA shipped 2026-08-31/09-01.
Board v2 was built, deployed and verified against the locked comps8 on 2026-09-02:
home is the open state, board is a now-anchored timeline, and focused journeys
become smart-header directions. Evidence and exact geometry are in
`docs/backlog/board-v2/VERIFICATION.md`; the earlier v1 report is
`docs/backlog/v1-core-loop/VERIFICATION.md`. `TFNSW_API_KEY` lives in `.env`
(gitignored) — never commit or print it.

Run the whole app: `set -a; source .env; set +a; go run ./cmd/server`, then
open http://localhost:8080 — the server serves `web/` at `/` (env:
`TFNSW_API_KEY` required, `PORT` default 8080, `WEB_DIR` default `./web`,
`MIN_CONNECTION_TIME` default `3m`).
Test: `go test ./...` and `cd web && npm test` — no test makes a network call,
and the client has no build step and no npm deps.

Editing the client: `web/sw.js` serves the shell cache-first, so a browser that
has already visited will keep serving the old CSS and modules until `VERSION`
is bumped. Develop with DevTools' "Update on reload", or in a throwaway profile
— `tools/screenshot.js` and `tools/shoot-states.js` use one by default.

## Structure

- `docs/PROJECT.md` — what/why, principles, key decisions, core flows
- `docs/ROADMAP.md` — milestones
- `docs/STYLES.md` — BINDING design verdict (B·Editorial exemplar) + intent
- `docs/contracts/api.md` — backend JSON API (binding)
- `docs/contracts/client-storage.md` — localStorage schema + prediction
  heuristic (binding)
- `docs/references/tfnsw-open-data.md` — upstream API notes; **[verify]**
  items must be resolved by live probes before being relied on
- `docs/backlog/v1-core-loop/` — v1 design + phased build plan
- `docs/backlog/journey-focus/` — journey detail + focus: design, comps and
  verdict, and the built screens' shots in `shots/`
- `docs/backlog/board-v2/` — locked home/board design, comps8 sources and the
  implementation verification report
- `tools/` — verification instruments (`screenshot.js`, `shoot-states.js`,
  `measure-open.js`, `make-icons.sh`) + the TfNSW probe and fixtures; read
  `tools/README.md` before trusting or changing any of them
- `web/` — the client: `index.html`, `app.css`, ES modules in `web/js`
  (`rowmodel`, `journey`, `focus`, `storage`, `predict` are pure and unit
  tested in `web/test`), plus the PWA shell: `manifest.webmanifest`, `sw.js`,
  `icons/`. Screens: home/directions (`home.js`, route `#/`), the timeline
  board (`board.js`, route `#/board`), journey detail (`detail.js`, route
  `#/journey`), and setup.
- `cmd/server` — backend entrypoint; `internal/tfnsw` — upstream client and
  response mapping; `internal/cache` — TTL + single-flight + stale-on-error;
  `internal/api` — handlers, cache headers, error contract

## Deploy (syd1 VM, via the infra repo at ../projects)

The app ships as ONE image (Go binary + `web/` baked in), built here and RUN
by the infra repo's `stacks/ilovetrains/` compose stack behind the shared
Caddy edge-proxy at ilovetrains.jeremyvun.com.

1. Build + push the image (multi-arch, to the self-hosted registry):
   `docker buildx bake --push` (see `docker-bake.hcl`; registry
   registry.jeremyvun.com). Remember the sw.js `VERSION` bump rule below.
2. If the stack/config changed: edit `../projects/stacks/ilovetrains/`
   (compose + `config.env`; the secret `TFNSW_API_KEY` lives in that stack's
   gitignored `secrets.env` — the infra repo's pre-commit hook seals it to
   the committed `secrets.env.age`, and the VM decrypts it at reconcile).
   Commit AND PUSH the infra repo — the VM pulls it from origin.
3. Deploy: `cd ../projects && cli/deploy.sh ilovetrains`
   (deployctl client → syd1 webhook; binary: `make build` in that repo or
   `DEPLOYCTL_BIN=agent/deployctl/deployctl`).
4. Verify: https://ilovetrains.jeremyvun.com/healthz then the board itself;
   re-run `node tools/measure-open.js --url https://ilovetrains.jeremyvun.com/#/board`
   for real-origin numbers.

## Rules

- Server is stateless; personal data never leaves the device. Don't add
  server-side user state without an owner ruling.
- Contract docs update in the same change as the interface they describe.
- Any deploy that changes a file in `web/sw.js`'s `SHELL` list must bump
  `VERSION` in that file, or returning users keep the old shell.
