# Board v2 — playtest round

Owner playtest feedback 2026-09-01, verbatim (each is a binding complaint;
designs are judged against these words):

1. "I don't see past trips still. Id like for infinite scroll / pagination
   e.g. the view always lands at current time, but the user can scroll up to
   see past times."
2. "the big number for minutes is often confused as the platform."
3. "the usability isn't great, and the colour coding for different lines is
   not visible enough. I.e. blue, orange, red lines etc."
4. "the primary view is mobile. the buttons are small and not in the
   intuitive place for mobile. also, it's not intuitive to press edit to go
   back."
5. "I also want smarts in the app so it knows where you are, what the likely
   trip on your list is, and then highlights it at the top."
6. Process: "iterate until we get a really good design and usability for
   humans."

## Scope

- **Past departures**: the board is a timeline that LANDS at now and scrolls
  UP into the past (see api.md `at` addition). Past rows render in their own
  honest register (they ran; show scheduled/actual clock times, no
  countdowns). The "now" anchor must be unmissable and the board must never
  open scrolled into the past.
- **Board v2 composition**: fix the figure/platform ambiguity (complaint 2) —
  candidates include labelling weight, position exchange, or making the
  platform the figure — comps decide, complaint decides the winner. Line
  colour must be VISIBLE (complaint 3): the line's colour as a first-class
  element per row (rail/bar/badge at real size), not a 10px letterspaced
  code. Still the B·Editorial language (STYLES.md) unless a comp proves the
  language itself is the problem — flag that as an owner call, don't decide
  it.
- **Mobile-first navigation** (complaint 4): thumb-reach primary actions,
  obvious back affordance everywhere (EDIT is not a back button — detail
  view's BOARD label and trips' DONE have the same disease). Propose a
  navigation model: where flip/switch/edit/back live on a phone held in one
  hand. Tap targets ≥44px.
- **Location smarts** (complaint 5): geolocation term in the prediction
  (client-storage.md), station coords via the stops API (api.md). When
  multiple trips are saved, the predicted one is HIGHLIGHTED AT THE TOP of
  any trip list/switcher, and the board announces which trip it chose and
  why-lite ("nearest: Rhodes"). Permission asked contextually (when the user
  has ≥2 trips), never on first load; degrade silently to time+history.

## Constraints carried forward

- All existing binding rules (STYLES.md) hold on the board unless a comp
  explicitly proposes an amendment as an owner call.
- Focus strip (B2) and journey detail (A1) exist; v2 composition must keep
  them coherent (the strip rides the board; detail is one tap from a row).
- Zero-tap answer, honest states, speed budget — unchanged product law.

## Out of scope

- Server-side user state (still forbidden), native app, other modes.
