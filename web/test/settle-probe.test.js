process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import { setFocus, settleRide, settleRefreshedFocus, directionsModel, clearFocus } from '../js/focus.js';
import { arrivalMs } from '../js/journey.js';
import { emptyDoc, recordRide, correctRide } from '../js/storage.js';
import { transferBody, transferJourneys } from './fixture.js';

/* Review probes for the timetable-realtime phase 1 seam (client-storage.md,
   Completed rides). Each test names the invariant it attacks. */

const TRIP = {
  id: 'trip-rhodes-bondi',
  from: { id: '213820', name: 'Rhodes Station' },
  to: { id: '202210', name: 'Bondi Junction Station', location: { lat: -33.8917, lon: 151.2504 } },
  createdAt: '2026-08-01T08:00:00+10:00'
};
const SELECTION = { tripId: TRIP.id, direction: 'forward' };
const ARRIVAL = Date.parse('2026-09-01T10:08:00+10:00');
const AT_BONDI = { lat: -33.8917, lon: 151.2504, at: ARRIVAL };

function docWithFocus(journey = transferJourneys()[0], now = ARRIVAL - 20 * 60_000) {
  return setFocus({ ...emptyDoc(), trips: [TRIP] }, SELECTION, journey, now);
}

function shiftedBody(minutes) {
  const journeys = transferJourneys();
  const journey = journeys[0];
  const shift = (iso) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
  const last = journey.legDetail[journey.legDetail.length - 1];
  last.arrival.estimated = shift(last.arrival.scheduled);
  journey.arrival.estimated = last.arrival.estimated;
  return transferBody({ journeys });
}

test('I2: correcting then withdrawing then re-recording never duplicates a row', () => {
  const now = ARRIVAL + 2 * 60_000;
  let doc = settleRide(docWithFocus(), now);
  doc = settleRefreshedFocus(doc, SELECTION, shiftedBody(1), now);
  doc = settleRefreshedFocus(doc, SELECTION, shiftedBody(1), now);
  assert.equal(doc.rides.length, 1, 'a repeated refresh with the same arrival is idempotent');
  const withdrawn = settleRefreshedFocus(doc, SELECTION, shiftedBody(10), now);
  assert.equal(withdrawn.rides.length, 0);
  const again = settleRefreshedFocus(withdrawn, SELECTION, shiftedBody(10), now + 11 * 60_000);
  assert.equal(again.rides.length, 1, 'recorded once the moved arrival has passed');
  assert.equal(Date.parse(again.rides[0].arrivedAt), ARRIVAL + 10 * 60_000);
});

test('I2: the 100-row cap holds through a correction that re-adds the row', () => {
  const now = ARRIVAL + 2 * 60_000;
  const filler = Array.from({ length: 100 }, (_, i) => ({
    tripId: 'other', direction: 'forward', scheduledDeparture: `2026-01-01T00:${String(i).padStart(2, '0')}:00+11:00`,
    departedAt: 'x', arrivedAt: '2026-01-01T01:00:00+11:00', from: TRIP.from, to: TRIP.to
  }));
  let doc = { ...docWithFocus(), rides: filler };
  doc = settleRide(doc, now, AT_BONDI);
  assert.equal(doc.rides.length, 100);
  doc = settleRefreshedFocus(doc, SELECTION, shiftedBody(3), now, AT_BONDI);
  assert.equal(doc.rides.length, 100);
  assert.equal(doc.rides.filter((r) => r.tripId === TRIP.id).length, 1);
});

test('I3: a 200 m completion records before the timetable agrees and survives an unmoved refresh', () => {
  const now = ARRIVAL - 3 * 60_000;
  const recorded = settleRide(docWithFocus(), now, AT_BONDI);
  assert.equal(recorded.rides.length, 1, 'the fix at the destination records the ride');
  assert.equal(Date.parse(recorded.rides[0].arrivedAt), ARRIVAL);

  const unmoved = settleRefreshedFocus(recorded, SELECTION, shiftedBody(0), now, null);
  assert.equal(unmoved.rides.length, 1, 'an unmoved arrival leaves the location completion alone');
  assert.notEqual(directionsModel(unmoved.focus, now).phase, 'done', 'the pure model does not know about the fix');
});

test('I3 hazard: a 200 m completion is withdrawn by a later-moved arrival once the fix is gone', () => {
  const now = ARRIVAL - 3 * 60_000;
  const recorded = settleRide(docWithFocus(), now, AT_BONDI);
  const moved = settleRefreshedFocus(recorded, SELECTION, shiftedBody(2), now + 30_000, null);
  assert.equal(moved.rides.length, 0, 'documented: the timetable overrules the fix that already arrived');
  const withFix = settleRefreshedFocus(recorded, SELECTION, shiftedBody(2), now + 30_000, AT_BONDI);
  assert.equal(withFix.rides.length, 1, 'with the fix still valid the row is re-recorded');
  assert.equal(Date.parse(withFix.rides[0].arrivedAt), ARRIVAL + 2 * 60_000);
});

test('plan text: a recorded ride takes a refreshed arrival that moved EARLIER but is still past', { todo: 'builder guards on later-only; owner ruling' }, () => {
  const now = ARRIVAL + 5 * 60_000;
  const recorded = settleRide(docWithFocus(), now);
  const earlier = settleRefreshedFocus(recorded, SELECTION, shiftedBody(-2), now);
  assert.equal(Date.parse(earlier.rides[0].arrivedAt), ARRIVAL - 2 * 60_000);
});

test('builder behaviour: an earlier-moved arrival is left on the recorded row', () => {
  const now = ARRIVAL + 5 * 60_000;
  const recorded = settleRide(docWithFocus(), now);
  const earlier = settleRefreshedFocus(recorded, SELECTION, shiftedBody(-2), now);
  assert.equal(Date.parse(earlier.rides[0].arrivedAt), ARRIVAL);
  assert.equal(arrivalMs(earlier.focus.journey), ARRIVAL - 2 * 60_000, 'the focus itself did move');
});

test('legacy row: a ride without scheduledDeparture is matched through departedAt', () => {
  const now = ARRIVAL + 2 * 60_000;
  const journey = transferJourneys()[0];
  const legacy = {
    tripId: TRIP.id, direction: 'forward', departedAt: journey.departure.scheduled,
    arrivedAt: journey.arrival.scheduled, from: TRIP.from, to: TRIP.to
  };
  const doc = { ...docWithFocus(), rides: [legacy] };
  const corrected = settleRefreshedFocus(doc, SELECTION, shiftedBody(1), now);
  assert.equal(corrected.rides.length, 1);
  assert.equal(Date.parse(corrected.rides[0].arrivedAt), ARRIVAL + 60_000);
  assert.equal(corrected.rides[0].scheduledDeparture, undefined, 'the row is not migrated');
});

test('legacy row recorded from a delayed departure matches neither recordRide nor correctRide (pre-existing)', () => {
  const now = ARRIVAL + 2 * 60_000;
  const journey = transferJourneys()[0];
  const legacy = {
    tripId: TRIP.id, direction: 'forward',
    departedAt: new Date(Date.parse(journey.departure.scheduled) + 60_000).toISOString(),
    arrivedAt: journey.arrival.scheduled, from: TRIP.from, to: TRIP.to
  };
  const doc = { ...docWithFocus(), rides: [legacy] };
  const settled = settleRefreshedFocus(doc, SELECTION, shiftedBody(1), now);
  assert.equal(settled.rides.length, 2, 'documented: the legacy row cannot be found, so a second is added');
});

test('I4: settleRide on an unmoved journey equals the old recordCompletedFocus', () => {
  const now = ARRIVAL + 60_000;
  const doc = docWithFocus();
  const ends = { from: TRIP.from, to: TRIP.to };
  assert.deepEqual(settleRide(doc, now).rides, recordRide(doc, SELECTION, doc.focus.journey, ends.from, ends.to).rides);
  assert.equal(settleRide(doc, ARRIVAL - 60_000), doc, 'before arrival, nothing to record without a fix');
  assert.equal(correctRide(doc, SELECTION, doc.focus.journey, now), doc, 'nothing recorded, nothing to correct');
  assert.equal(clearFocus(settleRide(doc, now)).focus, undefined);
});

test('I4: settleRide without a trip for the focus records nothing', () => {
  const doc = { ...docWithFocus(), trips: [] };
  assert.equal(settleRide(doc, ARRIVAL + 60_000), doc);
});

test('I5-analogue: a refresh that expires the focus still records the ride first', () => {
  const now = ARRIVAL + 31 * 60_000;
  const settled = settleRefreshedFocus(docWithFocus(), SELECTION, shiftedBody(0), now);
  assert.equal(settled.focus, undefined);
  assert.equal(settled.rides.length, 1);
});
