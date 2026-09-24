# Offline router speed on closed-line days

Stage: design not started. Opened 2026-09-23 from the offline-search check.

## Owner rulings

- 2026-09-23: "I dont think the slow offline search is still and issue. verify
  if it is and fix it if so."
- 2026-09-23, after the evidence below: open this as its own item (share work
  across departures instead of searching each one through the night, as a
  contract change on both phones, aiming for seconds with the same answers).
  Ship the refresh fix and the iOS router parity first.

## Evidence (2026-09-23, bundled package `b17e6a59…d8fadd`)

The captured Sunday 6 September has no metro, so Mascot → Kellyville (train
and metro) cannot arrive before Monday's first metro. Every Sunday origin
service is searched separately until Monday morning.

| Request | Android emulator (API 35) | iOS simulator (iOS 26.4) |
| --- | --- | --- |
| `plan(limit: 4)`, the existing core test | 9.2 s | 57.4 s before parity, 32.8 s after |
| The app's board request: limit 24, recommendation, `at − 15 min` | 154.7 s | did not finish in 2 h 40 min (after parity) |

The in-app iOS offline drive on that Sunday still showed "Opening timetable"
after 240 s. Before the fix shipped with this item's opening, both phones'
30-second refresh cancelled an unfinished local plan and restarted it, so a
plan longer than 30 s never finished at all.

Where the time goes (read from the code, not yet profiled): the board pass
and the weighted recommendation pass each run one label scan per origin
service (up to 72). With the destination unreachable for about 19 hours, each
scan runs to Monday morning, and station labels are kept per incoming trip,
so busy interchanges accumulate hundreds of waiting labels that every later
departure re-examines. Both passes run again after the six-hour horizon
comes back empty.

## Already done (not part of this item)

- Refresh ticks no longer restart a board request that is still running
  (Android and iOS `TrainViewModel`).
- iOS `OfflineRouter` uses Android's integer trip and station codes, bitset
  visited stations and direct onboard lookups: same results, 1.75× faster on
  the core test.

## Goal and constraints

A closed-line day answers offline in seconds on both phones, with the same
board and recommendation the current contract defines
(`docs/contracts/native-data.md`, "Local planning" and "Weighted
recommendation pass"), or with a contract change the owner approves.
Candidate mechanisms to evaluate in design: sharing dominance across origin
services in the recommendation pass, a backward profile scan, and reusing
the six-hour pass inside the 30-hour one.

Acceptance to write into the plan: the app-size request above as a timed
instrumented/XCTest case on each platform, and the iOS UI drive
(`AppFlowTests`, offline, Sunday 2026-09-06 10:00, Mascot → Kellyville)
reaching a service row within a bound the owner sets.
