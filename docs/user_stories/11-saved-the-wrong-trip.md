# Saved the wrong station

**Persona.** Dev, five minutes after story 10.

**Situation.** Dev realises the trip is saved from Parramatta but the actual
station is Harris Park. Mildly annoyed, expects to fix it in a few seconds.

**Goal.** Hard: "replace this trip."

## What happens

1. Dev looks for an edit or delete control on the row. There is none: the
   row opens the board, and the only management affordance is `+ New trip`.
2. Dev adds Harris Park → Central. Two rows now.
3. The wrong trip stays. Prediction can pick it. Its board is one tap away
   forever, or until ten more trips push it out.

## Success looks like

- A wrong trip is gone within ten seconds of noticing it.
- The list only ever contains trips Dev means.

## Pressure points

- Deletion is deferred to the native clients' swipe-to-delete. The web app
  is the reference implementation and has none, and the old trips screen
  with its two-tap delete is dead code.
- A trip the user never views still competes in prediction: score zero, but
  it is the fallback when nothing else scores, and it is `trips[0]`.
- With two trips saved the location ask appears, which is the wrong moment:
  Dev is trying to remove something, and the app asks for something.
- "Subtraction is the default" cuts both ways. The user needs to subtract
  too.
