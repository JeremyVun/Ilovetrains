# Transfer completion and recovery

Status: deferred design, owner request 2026-09-09. Separate from the
[final-arrival guards](../../contracts/client-storage.md#final-arrival-decision).

## Owner request

“We need to apply the same ‘trip finished’ guards and semantics to transfers,
but maybe with a tighter buffer. Or something to help users with trips where
the transfer no longer works because the trains are annoyingly late. But that
can be for a separate backlog item.”

## Problem

A timetable boundary can advance directions to the next leg while the rider
is still on a delayed incoming train. It can also leave instructions pointing
at a connection that is no longer catchable. Final-destination arrival guards
alone do not resolve either case.

## Design scope

- Apply consistent evidence-based completion semantics to an incoming leg,
  transfer and boarding the onward service. Distinguish train motion, waiting
  at a change station, and travelling on the next service.
- Explore a tighter transfer buffer than the final-arrival uncertainty buffer.
  No duration is selected yet; the owner suggested the possibility, not a value.
- Detect when current estimates invalidate a connection, retain honest current
  instructions, and offer a viable alternative without claiming the rider
  boarded it. Preserve explicit user choices and offline last-known evidence.
- Keep recovery in the smart header and coordinate any native tracker
  presentation with it. Do not add a parallel routing/settings surface.

## Existing seams to review

- [Client storage](../../contracts/client-storage.md): focus, ride settlement,
  travel inference, local location evidence and tracker ownership.
- [UI](../../contracts/ui.md): directions, tight changes and disruption recovery.
- [Native data](../../contracts/native-data.md): missed connections, retained
  observations and per-leg realtime identity.
- [Realtime replacements](../realtime-replacements/design.md): replacement
  service identities and stop patterns; coordinate rather than duplicate it.
- Commute feedback's C1 platform fading is visual progress only. It must not
  silently introduce new evidence-based transfer-completion semantics.

## Questions for a future design session

- Which evidence confirms alighting and boarding, and what happens when GPS
  disappears in an interchange or tunnel?
- How does a short buffer interact with revised arrival/departure estimates,
  walking time, platform changes and the planned connection floor?
- When should the app warn, recommend an alternative or replace directions?
  How can the rider correct a wrong inference?
- How should an unavailable onward service look while offline?

## Verification cases

Delayed incoming train; onward train still catchable; missed onward departure;
onward train also delayed; change cancelled; rider stationary before the
interchange; noisy or stale location; platform change; missed and replacement
services; resume during a transfer; incorrect automatic boarding inference.

No build plan until behavior, timing and visual recovery have been selected.
