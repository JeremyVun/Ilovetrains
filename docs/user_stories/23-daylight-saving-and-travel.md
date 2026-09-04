# Daylight saving and a phone on the wrong clock

**Persona.** Sam, back from a week in Perth; the phone still on Perth time
for the first hour off the plane.

**Situation.** Sunday 02:30 on the daylight-saving change night, or a phone
whose zone is not Sydney.

**Goal.** Hard: "the times on screen must be Sydney times."

## What happens

1. The API serves ISO timestamps with the Sydney offset.
2. The client prints clock times in the *device's* local zone.
3. On a Perth phone every departure prints two hours early.

## Success looks like

- Clock times are Sydney times regardless of the phone's zone, because the
  stations are in Sydney.
- The DST change night does not produce a negative countdown, a 25-hour
  past window or a duplicated hour.

## Pressure points

- `clock()` uses `getHours()` on the device zone. The contract fixes the API
  to Australia/Sydney but the client silently re-interprets it.
- Prediction's hour buckets, day type and home inference all read device
  local time. A traveller's history is bucketed in a foreign zone for an
  hour and then shifts back.
- The past pager subtracts sixty-minute steps and bounds at twenty-four
  hours in absolute time. On the DST night the bucket boundaries are still
  aligned (server) but the client's "an hour earlier" and the wall clock
  disagree for one hour.
