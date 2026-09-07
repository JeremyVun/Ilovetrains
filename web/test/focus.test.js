process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setFocus, visibleFocus, clearFocus, isFocused, focusExpired, matchJourney, refreshFocus,
  directionsModel, focusStatus, inferTravel, arrived, FOCUS_CLEAR_MS
} from '../js/focus.js';
import { parseDoc, serializeDoc, emptyDoc, recordLastOpen, removeTrip } from '../js/storage.js';
import { setFlags, setPreferences } from '../js/preferences.js';
import {
  TRANSFER_NOW, TRANSFER_DEPARTED_NOW, transferBody, transferJourneys, delayLeg, cancelLeg,
  ferryJourneys, mixedJourneys,
  STATIONS, tripBetween
} from './fixture.js';

const TRIP = {
  id: 'trip-rhodes-bondi',
  from: { id: '213820', name: 'Rhodes Station' },
  to: { id: '202210', name: 'Bondi Junction Station' },
  createdAt: '2026-08-01T08:00:00+10:00'
};
const SELECTION = { tripId: TRIP.id, direction: 'forward' };

function docWithFocus(journey = transferJourneys()[0], now = TRANSFER_NOW) {
  return setFocus({ ...emptyDoc(), trips: [TRIP] }, SELECTION, journey, now);
}

test('focusing snapshots the journey verbatim', () => {
  const journey = transferJourneys()[0];
  const doc = docWithFocus(journey);

  assert.equal(doc.focus.by, 'focus', 'a hand focus says so');
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

/* The cap hides the followed journey without discarding it: the rider who
   turns the limit off gets the journey they were following back. */
test('a three-change focus hides under the cap and returns without it', () => {
  const leg = { line: { mode: 'train' } };
  const journey = {
    ...transferJourneys()[0], legs: 4, legDetail: [leg, leg, leg, leg]
  };
  const doc = setFlags(docWithFocus(journey), { transferLimit: true });

  assert.equal(visibleFocus(doc, TRANSFER_NOW, []), null);
  const uncapped = setPreferences(doc, { transferLimit: 'any' });
  assert.equal(visibleFocus(uncapped, TRANSFER_NOW, [])?.journey, journey);
  assert.equal(parseDoc(serializeDoc(doc)).focus.journey.legs, 4);
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

test('the kind of focus survives a refresh that replaces the snapshot', () => {
  const doc = setFocus({ ...emptyDoc(), trips: [TRIP] }, SELECTION,
    transferJourneys()[0], TRANSFER_NOW, 'inferred');
  const journeys = transferJourneys();
  delayLeg(journeys[0], 0, 6);
  const next = refreshFocus(doc, SELECTION, transferBody({ journeys }), TRANSFER_NOW);

  assert.equal(next.focus.by, 'inferred');
  assert.notDeepEqual(next.focus.journey, doc.focus.journey);
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


/* ---- the late rule (ui.md, smart home) ---------------------------------- */

const at = (time) => Date.parse(`2026-09-01T${time}:00+10:00`);
const legOf = (journey, nowMs) => directionsModel(journey, nowMs).activeLeg;

test('the relevant leg follows the journey phase, not the journey', () => {
  const journey = transferJourneys()[0];
  assert.equal(legOf(journey, at('09:21')), 0, 'before departure');
  assert.equal(legOf(journey, at('09:33')), 0, 'riding the first leg');
  assert.equal(legOf(journey, at('09:53')), 1, 'waiting at Town Hall');
  assert.equal(legOf(journey, at('10:01')), 1, 'riding the second leg');
});

test('a positive realtime delta on the relevant leg is the only source of RUNNING LATE', () => {
  const dwelling = delayLeg(transferJourneys()[0], 1, 1);
  const late = focusStatus(dwelling, { activeLeg: legOf(dwelling, at('09:53')) });
  assert.deepEqual([late.text, late.late, late.leg, late.delay], ['Running late', true, 1, 1]);

  // The same journey read one phase earlier is on time: leg 0 is not delayed.
  const earlier = focusStatus(dwelling, { activeLeg: legOf(dwelling, at('09:33')) });
  assert.deepEqual([earlier.text, earlier.late], ['Running', false]);

  const first = delayLeg(transferJourneys()[0], 0, 1);
  const firstLate = focusStatus(first, { activeLeg: legOf(first, at('09:33')) });
  assert.deepEqual([firstLate.text, firstLate.leg], ['Running late', 0]);

  const onTime = focusStatus(transferJourneys()[0], { activeLeg: 1 });
  assert.deepEqual([onTime.text, onTime.late, onTime.delay], ['Running', false, 0]);
});

test('sub-minute drift the printed clocks cannot explain is not late', () => {
  const journey = transferJourneys()[0];
  const leg = journey.legDetail[1];
  leg.departure.estimated = new Date(Date.parse(leg.departure.scheduled) + 30_000).toISOString();
  assert.equal(focusStatus(journey, { activeLeg: 1 }).late, false);
});

test('stale data and a scheduled-only leg never manufacture RUNNING LATE', () => {
  const stored = delayLeg(transferJourneys()[0], 1, 9);
  assert.equal(focusStatus(stored, { activeLeg: 1, stale: true }).text, 'Running');
  assert.equal(focusStatus(stored, { activeLeg: 1 }).text, 'Running late');

  const scheduled = delayLeg(transferJourneys()[0], 1, 9);
  scheduled.legDetail[1].departure.estimated = null;
  assert.equal(focusStatus(scheduled, { activeLeg: 1 }).text, 'Running');
});

test('cancellation and arrival outrank lateness', () => {
  const cancelled = cancelLeg(delayLeg(transferJourneys()[0], 1, 5), 1);
  const status = focusStatus(cancelled, { activeLeg: 1 });
  assert.deepEqual([status.text, status.kind, status.late], ['Cancelled', 'exception', false]);

  const over = focusStatus(delayLeg(transferJourneys()[0], 1, 5), { activeLeg: 1, over: true });
  assert.deepEqual([over.text, over.kind, over.late], ['Trip over', 'complete', false]);
});


/* ---- tight changes and later-leg cancellations (design.md 1, 7) --------- */

test('a tight change is painted from the first phase, while the words wait', () => {
  // The corridor's real 4-minute change, read before its own train leaves.
  const journey = transferJourneys()[5];
  const before = directionsModel(journey, at('10:30'));
  assert.deepEqual([before.phase, before.tight, before.warn], ['pre', true, false]);
  assert.equal(before.instruction, 'Gordon via Lindfield', 'the paint carries the warning here');

  const riding = directionsModel(journey, at('10:45'));
  assert.deepEqual([riding.phase, riding.tight, riding.warn], ['ride', true, true]);
  assert.equal(riding.instruction, 'Tight change · 4 min · Platform 5');
});

test('a shrunk change keeps its printed receipt once under way', () => {
  const journey = delayLeg(transferJourneys()[0], 0, 5);
  const riding = directionsModel(journey, at('09:40'));
  assert.equal(riding.tight, true);
  assert.equal(riding.instruction, 'Tight change · 2 min · Platform 5');
  assert.equal(riding.receipt, 'Printed change was 7 min.');
});

test('a later leg cancelled after departure names that leg, not the one that left', () => {
  const journey = cancelLeg(transferJourneys()[0], 1);
  const riding = directionsModel(journey, at('09:33'));

  assert.deepEqual([riding.phase, riding.figure, riding.provenance], ['ride', '18', 'TO CHANGE']);
  assert.equal(riding.instruction, '09:58 from Town Hall cancelled');
  assert.deepEqual([riding.warn, riding.tight], [true, false]);

  const dwelling = directionsModel(journey, at('09:53'));
  assert.deepEqual([dwelling.phase, dwelling.figure], ['dwell', '5']);
  assert.equal(dwelling.instruction, '09:58 from Town Hall cancelled');

  // Before it leaves, and when the cancelled leg is the one being ridden, the
  // next-train form is unchanged.
  assert.equal(directionsModel(journey, at('09:21')).instruction, '09:24 CANCELLED · NEXT TRAIN');
  assert.equal(directionsModel(cancelLeg(transferJourneys()[0], 0), at('09:33')).instruction,
    '09:24 CANCELLED · NEXT TRAIN');
});

test('ferry directions name a wharf and keep its boarding side', () => {
  const journey = ferryJourneys()[1];
  const before = directionsModel(journey, Date.parse('2026-09-05T15:36:00+10:00'), {
    leave: '4 min'
  });
  assert.equal(before.instruction, 'Leave now for Wharf 3, Side A');
  assert.equal(before.vehicle, 'ferry');

  journey.cancelled = true;
  journey.legDetail[0].cancelled = true;
  assert.equal(directionsModel(journey, Date.parse('2026-09-05T15:36:00+10:00')).instruction,
    '15:45 CANCELLED · NEXT FERRY');

  const change = directionsModel(mixedJourneys()[1], Date.parse('2026-09-05T15:35:00+10:00'));
  assert.equal(change.instruction, 'Change at Circular Quay · Wharf 3, Side A');
});


/* ---- inferred travel mode (design.md 5) --------------------------------- */

const RIDE = {
  line: { name: 'T9' },
  departure: { scheduled: '2026-09-05T09:24:00+10:00', estimated: null },
  arrival: { scheduled: '2026-09-05T10:03:00+10:00', estimated: null }
};
const on = (time) => Date.parse(`2026-09-05T${time}:00+10:00`);
const AT_STRATHFIELD = { lat: -33.8720, lon: 151.0944 };
const AT_RHODES = { lat: -33.8308, lon: 151.0879 };
/* 1.2 km from Rhodes, but away from Bondi Junction rather than toward it. */
const BACKWARDS = { lat: -33.8254, lon: 151.0765 };
/* 300 m from Rhodes, still 16.4 km from Bondi Junction. */
const JUST_LEFT = { lat: -33.8281, lon: 151.0879 };

function seen(at = '09:15', station = STATIONS.rhodes, direction = 'forward') {
  const doc = { ...emptyDoc(), trips: [tripBetween('t1', 'rhodes', 'bondi')] };
  return recordLastOpen(doc, { station, tripId: 't1', direction, journey: RIDE }, on(at));
}

test('seen on the platform and moved toward the destination is travel mode', () => {
  const focus = inferTravel(seen(), on('09:40'), AT_STRATHFIELD);

  assert.deepEqual(focus, {
    tripId: 't1',
    direction: 'forward',
    focusedAt: new Date(on('09:40')).toISOString(),
    by: 'inferred',
    journey: RIDE
  });
});

test('movement that is not toward the destination is not a ride', () => {
  assert.equal(inferTravel(seen(), on('09:40'), BACKWARDS), null);
  assert.equal(inferTravel(seen(), on('09:40'), AT_RHODES), null, 'still on the platform');
});

test('a sighting too long before departure, or too long after arrival, is not evidence', () => {
  assert.equal(inferTravel(seen('09:05'), on('09:40'), AT_STRATHFIELD), null, '19 min before it left');
  assert.equal(inferTravel(seen('09:09'), on('09:40'), AT_STRATHFIELD).by, 'inferred', '15 min exactly');
  assert.equal(inferTravel(seen(), on('10:34'), AT_STRATHFIELD), null, 'past arrival plus 30 min');
  assert.equal(inferTravel(seen(), on('10:33'), AT_STRATHFIELD).by, 'inferred', '30 min exactly');
  assert.equal(inferTravel(seen(), on('09:23'), AT_STRATHFIELD), null, 'not under way yet');
});

test('speed can stand in for the geometry, but never without leaving the platform', () => {
  assert.equal(inferTravel(seen(), on('09:40'), { ...JUST_LEFT, speed: 12 }).by, 'inferred');
  assert.equal(inferTravel(seen(), on('09:40'), JUST_LEFT), null, 'the same fix with no speed');
  assert.equal(inferTravel(seen(), on('09:40'), { ...AT_RHODES, speed: 12 }), null,
    'a fast reading at the platform is noise, not a ride');
  assert.equal(inferTravel(seen(), on('09:40'), { ...JUST_LEFT, speed: 7 }), null);
  assert.equal(inferTravel(seen(), on('09:40'), { ...JUST_LEFT, speed: NaN }), null);
});

test('entry needs a previous open at this journey\'s own origin, and its trip', () => {
  assert.equal(inferTravel(emptyDoc(), on('09:40'), AT_STRATHFIELD), null);
  assert.equal(inferTravel(seen('09:15', STATIONS.burwood), on('09:40'), AT_STRATHFIELD), null);
  assert.equal(inferTravel(seen('09:15', null), on('09:40'), AT_STRATHFIELD), null,
    'no station at the previous open is no sighting');
  assert.equal(inferTravel(removeTrip(seen(), 't1'), on('09:40'), AT_STRATHFIELD), null);
  assert.equal(inferTravel(seen(), on('09:40'), null), null);
});

/* design.md section 5, Exit: the header is over the moment the fix says so, and
   a countdown may not stand under a TRIP OVER status. */
test('a fix at the destination takes the done treatment before the timetable does', () => {
  const riding = directionsModel(RIDE, on('09:59'), { toName: 'Bondi Junction Station' });
  assert.deepEqual([riding.phase, riding.provenance], ['ride', 'TO GO']);

  const done = directionsModel(RIDE, on('09:59'), { toName: 'Bondi Junction Station', arrived: true });
  assert.equal(done.phase, 'done');
  assert.equal(done.progress.at, 1);
  assert.equal(done.figure, 'Now', 'the figure never counts below zero, however early the fix is');
  assert.equal(done.provenance, 'AGO');
  assert.equal(done.instruction, 'You arrived at Bondi Junction.');
  assert.equal(done.showBoardingPlatform, false);

  assert.equal(directionsModel(RIDE, on('10:06'), { arrived: true }).figure, '3',
    'past the arrival the figure is the real age either way');
});

test('arrival at the destination ends the trip as the rider steps off', () => {
  const focus = { tripId: 't1', direction: 'forward', by: 'inferred', journey: RIDE };
  const platform = { lat: -33.89015, lon: 151.2477 };

  assert.equal(arrived(focus, STATIONS.bondi, platform, on('09:59')), true);
  assert.equal(arrived(focus, STATIONS.bondi, platform, on('09:57')), false, 'five minutes out is too early');
  assert.equal(arrived(focus, STATIONS.bondi, AT_STRATHFIELD, on('09:59')), false);
  assert.equal(arrived(focus, STATIONS.bondi, null, on('09:59')), false);
  assert.equal(arrived(null, STATIONS.bondi, platform, on('09:59')), false);
});


test('every service leg gates displayed focus, including a later metro leg', () => {
  const journey = structuredClone(transferJourneys()[0]);
  journey.legDetail[0].line = { name: 'T8', mode: 'train' };
  journey.legDetail[1].line = { name: 'M1', mode: 'metro' };
  journey.line = journey.legDetail[0].line;
  for (const by of ['focus', 'inferred']) {
    const doc = { ...docWithFocus(journey), preferences: { enabledModes: ['train'] } };
    doc.focus.by = by;
    const original = structuredClone(doc);
    assert.equal(visibleFocus(doc, TRANSFER_NOW), null, 'a train first leg cannot exempt a later metro leg');
    assert.deepEqual(doc, original, 'hiding leaves the stored snapshot untouched');
    doc.preferences.enabledModes = ['train', 'metro'];
    assert.equal(visibleFocus(doc, TRANSFER_NOW), doc.focus, 're-enable restores the same focus');
    doc.preferences.enabledModes = [];
    assert.equal(visibleFocus(doc, TRANSFER_NOW), null, 'all-off hides even a followed journey');
  }
});

test('focus visibility treats trains, metro and ferries identically', () => {
  for (const mode of ['train', 'metro', 'ferry']) {
    const journey = structuredClone(transferJourneys()[0]);
    journey.line = { name: mode, mode };
    for (const detail of journey.legDetail) detail.line = { name: mode, mode };
    const doc = { ...docWithFocus(journey), preferences: { enabledModes: [mode] } };
    assert.equal(visibleFocus(doc, TRANSFER_NOW), doc.focus);
    doc.preferences.enabledModes = ['train', 'metro', 'ferry'].filter((item) => item !== mode);
    assert.equal(visibleFocus(doc, TRANSFER_NOW), null);
  }
});
