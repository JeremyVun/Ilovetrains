# Leaving work early

**Persona.** Priya, focused on this morning's train, which is long over.

**Situation.** 14:15, unwell, going home now. Not at the station yet.
Location permission granted, fix will say she is near Bondi Junction.

**Goal.** Hard: "next train home, and I don't feel like fiddling."

## What happens

1. She opens the app. The morning focus expired at about 10:40 (arrival plus
   thirty minutes), so the `Show the way back` offer is gone.
2. Prediction runs on history. Afternoon reverse history is thin: she
   usually goes home at 17:40, and hour proximity is zero at 14:15.
3. The header shows whichever direction scored, or falls back to the last
   viewed board, which was this morning's.

## Success looks like

- The way home appears because she rode out this morning, regardless of
  what hour it is now.
- The receipt says why: `You rode out at 09:24. Here's the way back.`

## Pressure points

- The way-back offer is tied to the focus lifetime (thirty minutes after
  arrival), not to the day. A ride out at 09:24 should make "the way back"
  the likely intent until she has done it, whenever that is.
- The completed ride is recorded, but `predict` does not read rides at all;
  only `homeModel` reads them, and only to write the receipt.
- Hour proximity of one to two hours is brittle for a person whose day
  varies. A shape like "after the outbound ride, prefer the reverse until it
  is ridden" is a stronger signal than any hour bucket.
- If the header guesses wrong here, the correction is the same dead end as
  story 08.
