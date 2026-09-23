import test from 'node:test';
import assert from 'node:assert/strict';

import { pinResult, rideAdded } from '../js/focus.js';
import { journeyKey } from '../js/journey.js';

const leg = (line, scheduled) => ({ line: { name: line }, departure: { scheduled }, arrival: { scheduled } });
const journey = (...legs) => ({ legDetail: legs, departure: legs[0].departure, arrival: legs.at(-1).arrival });
const shown = journey(leg('T1', '2026-09-23T08:12:00+10:00'));
const later = journey(leg('T1', '2026-09-23T08:24:00+10:00'));
const sameFirstOtherChange = journey(leg('T1', '2026-09-23T08:12:00+10:00'), leg('T9', '2026-09-23T08:40:00+10:00'));
const answer = { tripId: 'a', direction: 'forward', journeyKey: journeyKey(shown) };

test('a pin of the header\'s own journey is same, another service on its trip is service', () => {
  assert.equal(pinResult(answer, { tripId: 'a', direction: 'forward' }, shown), 'same');
  assert.equal(pinResult(answer, { tripId: 'a', direction: 'forward' }, later), 'service');
  assert.equal(pinResult(answer, { tripId: 'a', direction: 'forward' }, sameFirstOtherChange), 'service');
});

test('another trip or the other direction is trip, whatever the journey', () => {
  assert.equal(pinResult(answer, { tripId: 'b', direction: 'forward' }, shown), 'trip');
  assert.equal(pinResult(answer, { tripId: 'a', direction: 'reverse' }, shown), 'trip');
  assert.equal(pinResult({ ...answer, journeyKey: null }, { tripId: 'b', direction: 'forward' }, shown), 'trip');
});

test('a same-trip pin when the header showed no journey, or no answer at all, is not classified', () => {
  assert.equal(pinResult({ ...answer, journeyKey: null }, { tripId: 'a', direction: 'forward' }, shown), null);
  assert.equal(pinResult(null, { tripId: 'a', direction: 'forward' }, shown), null);
});

const ride = (tripId, scheduledDeparture, arrivedAt = '2026-09-23T08:41:00+10:00') =>
  ({ tripId, direction: 'forward', scheduledDeparture, departedAt: scheduledDeparture, arrivedAt });

test('only a ride identity absent before the write counts as added', () => {
  const before = { rides: [ride('a', '2026-09-22T08:12:00+10:00')] };
  assert.equal(rideAdded(before, { rides: [...before.rides, ride('a', '2026-09-23T08:12:00+10:00')] }), true);
  assert.equal(rideAdded(before, {
    rides: [ride('a', '2026-09-22T08:12:00+10:00', '2026-09-22T08:50:00+10:00')]
  }), false, 'a corrected arrival is the same ride');
  assert.equal(rideAdded(before, { rides: [] }), false, 'a withdrawal adds nothing');
  assert.equal(rideAdded({}, { rides: [ride('a', '2026-09-23T08:12:00+10:00')] }), true);
});

test('a capped history that drops its oldest ride still reports the new one', () => {
  const full = Array.from({ length: 100 }, (_, i) => ride('a', new Date(Date.UTC(2026, 5, 1 + i)).toISOString()));
  const after = [...full.slice(1), ride('b', '2026-09-23T08:12:00+10:00')];
  assert.equal(rideAdded({ rides: full }, { rides: after }), true);
  assert.equal(rideAdded({ rides: full }, { rides: full.slice(1) }), false);
});
