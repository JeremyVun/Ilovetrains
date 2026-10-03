# Commute feedback — C1

Owner ruling, 2026-09-09: “use C1, and make sure the platform number carries
the same lower contrast after the transfer.”

The transfer before/during/after and checking-arrival frames are verified web
client captures for 1.9.0 (service worker v73), replacing their illustrative
targets. They carry the started trip's `■ STOP TRIP` line and no `PINNED`.
Reproduce them with `tools/check-commute-feedback.js` against a local server;
see [tools instructions](../../../../tools/README.md).
Both phone sizes (390×844 and 412×732) and schemes are captured at 2× resolution.
`verification.json` records current frame hashes and distinguishes built
captures from the remaining direct/overdue illustrative targets. The latter
retain their [self-contained reproduction source](source/README.md).

- Keep the travelled route at its original width. Blend it toward the page
  background with a 62% overlay.
- Apply that same overlay over completed transfer chip fills and numerals.
  Keep both chips at normal contrast during the change; fade them together
  once the next leg begins. The opaque chip still covers the route beneath it.
- Preserve normal contrast for the moving marker and upcoming platforms.
- Retain the destination and label the last estimate when arrival is uncertain.
  Phone motion alone does not establish that the service is officially delayed.
- There is no missing-evidence state: without movement a trip ends three
  minutes after its estimate. Until then, and through the evidence wait, Home
  reads `Checking arrival` with a dash and `Checking arrival at <destination>.`

The before/during/after transfer frames move a synthetic clock through the same
journey. The checking-arrival captures drive the real controller's guarded
arrival state three minutes past the estimate, inside the evidence wait; the
overdue target's marker remains illustrative, and as a comp target it predates
the trip-control line. The direct target predates it too and still reads
`Running · Pinned`; it calibrates the progress line, not the status words.
Arrival thresholds live in the [storage contract](../../../../docs/contracts/client-storage.md#final-arrival-decision).

Lost connections and their recovery are time-only and live in the
[storage contract](../../../../docs/contracts/client-storage.md#recovery); the
exemplars are `home-390x844-lost-riding.png`, `-lost-dwell.png` and
`-lost-none.png` beside this folder.

The separate [eight-car cab reference](cab/README.md) incorporates the owner's
later door/count correction. It supersedes the six-car cab shown in the
original workshop; it does not change the 24 C1 progress reference frames.
