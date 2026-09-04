# Trackwork weekend

**Persona.** Priya, Saturday, planning to meet friends at Bondi Junction.

**Situation.** 10:15 at home. The T4 is closed for trackwork this weekend,
buses replace trains between Town Hall and Bondi Junction. She does not
know this yet.

**Goal.** Fuzzy: "what's the trip look like today?"

## What happens

1. She opens the app. The header shows a Rhodes departure with an arrival
   that is much later than usual, or no arrival at all.
2. Journeys with bus legs are dropped by the server. What remains is the
   train-only subset: possibly a long change, possibly nothing.
3. Nothing on screen says "trackwork". She assumes the app is broken.

## Success looks like

- The app says why the board looks strange: a disruption line, or at least
  an honest "no train-only journeys today".
- She can still see what upstream offers, even if it is a bus.

## Pressure points

- Trackwork awareness is a roadmap item with no interim state. The client
  cannot distinguish "no trains" from "trains exist but ride a bus". Both
  are `No services in the next few hours`.
- A bus-replaced journey is *removed*, not shown as untakeable. The rider
  who would happily take the bus gets no information at all.
- The empty state's copy blames the schedule. On a trackwork weekend it
  should blame the trackwork and say so.
- If a train-only journey survives with a 90-minute change, the header shows
  it as the answer. Story 14's trap, in daylight.
