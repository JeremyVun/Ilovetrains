# The way home, on a day she never focused anything

**Persona.** Priya. Saved trip Rhodes → Bondi Junction. She checks the app
most mornings but rarely taps `Take this train`.

**Situation.** 17:40, walking out of the office toward Bondi Junction
station. Location permission granted. Tired. She wants the next train home.

**Goal.** Hard: "next train from Bondi Junction to Rhodes."

## What happens

1. She opens the app. The header shows the next train from **Rhodes to Bondi
   Junction**: the morning direction.
2. The top line reads `AT BONDI JUNCTION`, right above a header that tells
   her to board at Rhodes.
3. The trip row below says `Rhodes → Bondi Junction · SHOWN ABOVE`. Tapping
   it opens the same direction's board.
4. There is no reverse control. She tries `+ New trip` and enters Bondi
   Junction → Rhodes. The save is silently ignored as a duplicate of the
   existing pair.
5. She gives up and uses another app.

## Success looks like

- Opening the app at 17:40 at Bondi Junction shows Bondi Junction → Rhodes,
  with a receipt if the leap deserves one.
- Failing that, the way home is one obvious tap away.

## Pressure points

- The prediction score for the reverse direction is a sum over reverse
  *history*, and reverse history is only written when the reverse board is
  viewed. The reverse board is only reachable through the way-back offer
  after a focused trip is over. With no focus, the score is zero forever and
  the location term multiplies zero.
- `AT BONDI JUNCTION` above a Rhodes departure is the app contradicting
  itself on one screen.
- The duplicate check in `addTrip` rejects the reversed pair, so the user
  cannot even brute-force a way home.
- PROJECT.md promises "the user only ever has to teach the app A→B; the app
  suggests B→A itself, every time." This story is the cheapest way to test
  that promise, and today it fails.
