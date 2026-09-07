---
name: visual-regression
description: Prove the web, Android and iOS screens still look right after a change, by running tools/visual-regression.js and judging every reported difference from its composite. Use after any change that reaches a screen on any client, when a change is ported across clients, and before closing a backlog item that touched UI.
---

# Visual regression

One command shoots the three clients, compares each frame with the committed
baseline in `tools/baselines/`, and writes a report. Your job is the judging:
the tool finds pixels, you decide whether they are the change you meant.
`tools/README.md`, "visual-regression.js", holds the flags and traps.

## Run

1. `coord note "visual regression: <what changed>"`. The tool waits for a
   peer's emulator or simulator drive rather than colliding with it; if it
   says it is waiting, keep waiting.
2. Scope to what the change could touch, then widen before accepting:

   ```sh
   node tools/visual-regression.js --platform web --screens home,board,detail   # ~20 s
   node tools/visual-regression.js --platform android                          # one client
   node tools/visual-regression.js                                             # everything, ~1 min
   ```

   A shared change (a colour token, a fixture, a contract, copy that every
   client renders) gets the full run. `--list` prints the screen table.
3. Read only the console summary. Never cat `report.html` or a band dump into
   the conversation; the composites are the evidence.

## Judge

Every line that is not `same` needs a verdict before the run means anything.

- **DIFF**: Read `diff/<platform>/<screen>.png`. Left is the baseline, middle
  is now, right paints every moved pixel in orange over a dimmed frame. Ask
  three questions in order: is this the change I made; is anything else on
  the screen moved that I did not mean; is the change on the other clients'
  frames of the same screen the same change. A count with a worst channel of
  two or three on a hairline is anti-aliasing, and one sentence says so; a
  worst channel over ten is a real move and needs a reason that names the
  element.
- **DIFF on a screen you did not touch** is a regression until shown
  otherwise. Find the shared cause before touching the baseline.
- **NEW**: a frame without a baseline. A new screen also needs a row in the
  tool's `SCREENS` table and a capture in each client's shooter.
- **MISSING**: the frame was not captured; the line carries the shooter's
  error. Never accept a run with a `MISSING` frame on a client you changed.
  A `MISSING` from a peer's in-progress work on another client is theirs to
  fix; say so and move on.
- Never widen `--fuzz` or `--threshold` to make a run green. They exist for
  one argued invocation, named in the report to the owner.

## Accept

Only after every DIFF has a verdict, and only for the capture you judged:

```sh
node tools/visual-regression.js --compare <out dir> --accept
```

Commit `tools/baselines/` in the same change as the code, as with a
contract. Re-shooting to accept photographs a tree that may have moved.

## Report to the owner

One table: platform, screen, pixel count, one-line verdict. A frame worth a
verdict from the owner gets its composite path. No counts in prose, no band
coordinates, no restating what the tool printed.
