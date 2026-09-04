# Smart header v2: location first (design not started)

Opened 2026-09-05 from the owner's words during the playtest-fixes round.
This file holds the intent and the pieces identified so far. The design
session has not happened; nothing here is a ruling except the quotes.

## The owner's words

- "as a user I would want the app to know that I'm at Bondi Junction, and if
  my home station tends to be Rhodes, it should suggest it to me in the
  smart header. There's probably two different states - in the 'travel
  mode' state, and outside of the travel mode state."
- "why do we need to do it based on what they have in their saved trips?
  What if I have nothing in my trips? new user experience should work out
  of the box too for smart header."
- "why is there a hardcoded time of 14:00? I could go somewhere and want to
  go back home before 14:00 - that seems like a silly rule."

## What it changes

Outside travel mode, the header's origin is the station the user is at and
its destination is home when they are away from home, with no saved trip
required and no clock rule. Inside travel mode (a focused journey) nothing
changes: directions.

## Pieces identified (to be designed, not decided)

1. A baked station index (roadmap M6) so the client can name the nearest
   station to a fix even when it is in no saved trip.
2. Home inferred from where the app is opened, on the device only: candidate
   rule "the station nearest the first open of each day votes for home,
   three votes to trust it". Completed rides may still vote.
3. Prediction rewritten as "from here, to home when away from home,
   otherwise to the usual place from here", with saved trips and history as
   evidence rather than the only candidates.
4. First run with location granted opens as "You're at <station>. Where
   to?" with one field; the two-field sheet stays for no location.
5. Receipts for each leap class, drafted by Codex.

## Depends on

`playtest-fixes` landing first: its location floor is the interim step and
is superseded here.
