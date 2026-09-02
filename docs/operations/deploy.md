# Production deployment

The app ships as one multi-architecture image containing the Go server and
`web/`. The infra repository at `../projects` runs that image from
`stacks/ilovetrains/` behind the shared Caddy edge proxy on `syd1`.

Source pushes do not deploy production. Build, push and deployment originate
from this machine.

## Before deploying

- Run the relevant test and real-client verification gates.
- If any file in `web/sw.js`'s `SHELL` array changed, bump its `VERSION`.
- Never read or source `.env` or the infra stack's `secrets.env` without
  explicit user permission. Never print or commit `TFNSW_API_KEY`.

## Deploy

1. Build and push the multi-architecture image to the self-hosted registry:

   ```sh
   docker buildx bake --push
   ```

   `docker-bake.hcl` publishes `registry.jeremyvun.com/ilovetrains`.

2. If deployment configuration changed, edit
   `../projects/stacks/ilovetrains/`, then commit and push the infra repository.
   The stack uses `docker-compose.yml` and `config.env`. Its pre-commit hook
   seals the gitignored `secrets.env` into the committed `secrets.env.age`;
   the VM decrypts it during reconciliation.

3. Deploy through the infra repository:

   ```sh
   (cd ../projects && cli/deploy.sh ilovetrains)
   ```

   Build the deploy client with `make build` in that repository if required,
   or set `DEPLOYCTL_BIN=agent/deployctl/deployctl`.

## Verify

Check https://ilovetrains.jeremyvun.com/healthz and drive the affected flow on
the production origin. For real-origin open measurements:

```sh
node tools/measure-open.js --url https://ilovetrains.jeremyvun.com/#/board
```

Confirm service-worker-controlled changes in a returning profile as well as a
cold profile; a healthy origin does not prove that existing clients received
the new shell.
