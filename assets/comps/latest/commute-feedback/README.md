# Commute feedback — C1

Owner ruling, 2026-09-09: “use C1, and make sure the platform number carries
the same lower contrast after the transfer.”

The transfer before/during/after and missing-telemetry frames are verified web
client captures for 1.6.0 (service worker v58), replacing their illustrative
targets. Reproduce them with `tools/check-commute-feedback.js` against a local
server; see [tools instructions](../../../../tools/README.md).
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

The before/during/after transfer frames move a synthetic clock through the same
journey. The missing-location captures drive the real controller's guarded
arrival state; the overdue target's marker remains illustrative. Arrival
thresholds live in the [storage contract](../../../../docs/contracts/client-storage.md#final-arrival-decision).

Evidence-based transfer completion and missed-connection recovery are deferred
to their [own item](../../../../docs/backlog/transfer-completion-recovery/design.md).

The separate [eight-car cab reference](cab/README.md) incorporates the owner's
later door/count correction. It supersedes the six-car cab shown in the
original workshop; it does not change the 24 C1 progress reference frames.
