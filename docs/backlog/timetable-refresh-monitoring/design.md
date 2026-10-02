# Timetable refresh monitoring

Stage: not designed. Written on 2026-10-03, after production's daily native
timetable refresh had failed silently for four weeks.

## What happened

Every refresh from 7 September to 3 October 2026 failed with
`[Errno 18] Cross-device link`. The compiler staged files in the container's
`/tmp` and renamed them into the `/data` volume. Production kept serving the
2026-09-05 bootstrap package, which expired on 2026-10-04. Infra `efbd09b`
(`TMPDIR=/data`) fixed it the same day, and the server now passes the compiler
a temp directory on `/data` (`internal/native/timetable.go`, with a regression
test). `docs/operations/deploy.md` gained a post-deploy manifest check.

Nothing would have noticed:
- a successful refresh logs nothing;
- a failure logs one line a day;
- `/healthz` always answers `{"ok":true}`;
- no analytics event records a refresh.

## Candidate signals, none chosen yet

- A daily external check of `/api/v1/timetable/manifest` that alerts when
  `generatedAt` is older than 48 h or `expiresAt` is under 7 days away.
- A success log line, plus an analytics event with each refresh's outcome.
- A server warning when the active package is near expiry.
- A release-image smoke test that runs the server on a named volume against
  the stub serving captured schedules. That is how the failure was reproduced.

## Open

- Where alerts go (the shared analytics service, a dashboard, or something
  else).
- Whether native clients should report their active package's age.
