process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setFocus, clearFocus, isFocused, focusExpired, matchJourney, refreshFocus,
  FOCUS_CLEAR_MS
} from '../js/focus.js';
import { parseDoc, serializeDoc, emptyDoc, removeTrip } from '../js/storage.js';
import {
  TRANSFER_NOW, TRANSFER_DEPARTED_NOW, transferBody, transferJourneys, delayLeg
} from './fixture.js';

const TRIP = {
  id: 'trip-rhodes-bondi',
  from: { id: '213820', name: 'Rhodes Station' },
  to: { id: '200080', name: 'Bondi Junction Station' },
  createdAt: '2026-08-01T08:00:00+10:00'
};
const SELECTION = { tripId: TRIP.id, direction: 'forward' };

function docWithFocus(journey = transferJourneys()[0], now = TRANSFER_NOW) {
  return setFocus({ ...emptyDoc(), trips: [TRIP] }, SELECTION, journey, now);
}

test('focusing snapshots the journey verbatim', () => {
  const journey = transferJourneys()[0];
  const doc = docWithFocus(journey);

  assert.equal(doc.focus.tripId, TRIP.id);
  assert.equal(doc.focus.direction, 'forward');
  assert.equal(doc.focus.focusedAt, '2026-08-31T23:21:00.000Z');
  assert.deepEqual(doc.focus.journey, journey);
  assert.equal(isFocused(doc, journey), true);
  assert.equal(isFocused(doc, transferJourneys()[1]), false);
});

test('at most one focus: focusing another replaces it', () => {
  const first = docWithFocus(transferJourneys()[0]);
  const second = setFocus(first, SELECTION, transferJourneys()[2], TRANSFER_NOW);

  assert.equal(isFocused(second, transferJourneys()[0]), false);
  assert.equal(isFocused(second, transferJourneys()[2]), true);
});

test('the focus survives a storage round trip, and a malformed one is dropped', () => {
  const doc = docWithFocus();
  const back = parseDoc(serializeDoc(doc));

  assert.deepEqual(back.focus, doc.focus);
  // Absent = none: a document written before this shipped needs no migration.
  assert.equal(parseDoc(serializeDoc(emptyDoc())).focus, undefined);
  assert.equal(parseDoc(JSON.stringify({ focus: { tripId: 'x' } })).focus, undefined);
  assert.equal(parseDoc(JSON.stringify({ focus: { ...doc.focus, journey: null } })).focus, undefined);
});

test('deleting a trip takes its focused journey with it', () => {
  const doc = removeTrip(docWithFocus(), TRIP.id);
  assert.equal(doc.focus, undefined);
});

test('re-matching finds the same journey after a delay lands on it', () => {
  const doc = docWithFocus();
  const journeys = transferJourneys();
  delayLeg(journeys[0], 0, 6);

  const next = refreshFocus(doc, SELECTION, transferBody({ journeys }), TRANSFER_NOW);

  assert.equal(next.focus.journey.legDetail[0].departure.estimated, '2026-08-31T23:30:18.000Z');
  assert.equal(next.focus.focusedAt, doc.focus.focusedAt);
  assert.equal(matchJourney(journeys, doc.focus.journey), journeys[0]);
});

test('a departed journey keeps its snapshot rather than losing itself', () => {
  const doc = docWithFocus();
  // 09:47: the board no longer carries the 09:24, and is right not to.
  const remaining = transferJourneys().slice(2);
  const next = refreshFocus(doc, SELECTION, transferBody({ journeys: remaining }), TRANSFER_DEPARTED_NOW);

  assert.equal(matchJourney(remaining, doc.focus.journey), null);
  assert.deepEqual(next.focus.journey, doc.focus.journey);
});

test('another trip\'s board never overwrites the snapshot', () => {
  const doc = docWithFocus();
  const next = refreshFocus(doc, { tripId: 'trip-other', direction: 'forward' },
    transferBody({ journeys: transferJourneys() }), TRANSFER_NOW);

  assert.deepEqual(next.focus, doc.focus);
});

test('the focus clears itself half an hour past arrival, and not a minute before', () => {
  const doc = docWithFocus();
  const arrival = Date.parse('2026-09-01T10:08:00+10:00');

  assert.equal(focusExpired(doc.focus, arrival), false);
  assert.equal(focusExpired(doc.focus, arrival + FOCUS_CLEAR_MS), false);
  assert.equal(focusExpired(doc.focus, arrival + FOCUS_CLEAR_MS + 1000), true);
  assert.equal(refreshFocus(doc, SELECTION, transferBody(), arrival + FOCUS_CLEAR_MS + 1000).focus, undefined);
  assert.equal(clearFocus(doc).focus, undefined);
});
