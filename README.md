# ilovetrains

Your next Sydney train, before you ask. Live at
[ilovetrains.jeremyvun.com](https://ilovetrains.jeremyvun.com).

Open the app and the departure board for the trip you almost certainly want
is already there: minutes until departure, platform, realtime delay, arrival
time. No search, no ads, no account. Save your trips once; the app learns
which one you need from when you use it, entirely on your device.

## How it works

```
Browser (localStorage: saved trips, history, prediction)
  ├─ static PWA shell ─────── cached by the service worker
  └─ fetch /api/v1/... ────── JSON keyed only by station pair, s-maxage=30
                └─ Go proxy (stateless in-memory cache, single-flight)
                      └─ Transport for NSW Open Data (Trip Planner API)
```

The server is a pure stateless cache: it never sees who you are, and every
response is shared by every user asking about the same station pair. All
personalization — saved trips, history, the trip-prediction heuristic — lives
in `localStorage` and never leaves your device.

- **Frontend**: vanilla ES modules, no framework, no build step, installable
  PWA with offline last-known departures. Dark and light modes.
- **Backend**: Go, zero third-party dependencies.
- Honest states throughout: delays show both times, cancellations are never
  hidden, data too old to trust drops its countdowns and says so.

## Run it

```
export TFNSW_API_KEY=...   # free key from https://opendata.transport.nsw.gov.au
go run ./cmd/server         # serves web/ and the API on :8080
```

Tests: `go test ./...` and `cd web && npm test` (no network, no npm deps).
The docs are the real map: start at `CLAUDE.md`, then `docs/PROJECT.md`,
`docs/contracts/` (binding API, state and UI behavior).

## Data

Realtime transport data © Transport for NSW, used under
[Creative Commons Attribution](https://opendata.transport.nsw.gov.au/) via the
TfNSW Open Data Trip Planner API. This is an unofficial personal project, not
affiliated with Transport for NSW.

## License

MIT — see [LICENSE](LICENSE).
