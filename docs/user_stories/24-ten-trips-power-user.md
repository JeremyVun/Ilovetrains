# Ten trips and counting

**Persona.** Ana, freelancer, works at five different clients across the
network and has saved a trip for each, both from home and between clients.

**Situation.** She adds an eleventh trip. She does not know there is a cap.

**Goal.** Fuzzy: "keep all my trips, and let the header pick well."

## What happens

1. The eleventh save silently evicts the least recently viewed trip.
2. The evicted trip's history and cache go with it. Its rides survive.
3. The trip list scrolls inside the frame under a header that takes a third
   of the screen.

## Success looks like

- She is told something was removed, and which.
- The list is scannable: ten rows with line badges, distances and last-ride
  facts.

## Pressure points

- Eviction is silent and permanent. A trip she views twice a year is
  exactly the kind that gets evicted and exactly the kind she cannot
  remember the details of.
- Ten rows at 72px is 720px of list under a 284px header block. On a
  390×844 frame the list is a scroll region with about five rows visible;
  every re-render restores `scrollTop`, which fights a drag in progress.
- Prediction with ten trips and two directions each is twenty candidates
  scored by hour and day type. Ties are frequent; the fallback is the last
  viewed board. Is the header right often enough to be trusted, or does the
  list become the interface?
- `NEVER RIDDEN` on nine rows, because she never focuses, is nine small
  reproaches.
