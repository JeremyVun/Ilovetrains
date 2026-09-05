process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_KEY, HISTORY_CAP, TRIPS_CAP, emptyDoc, parseDoc, serializeDoc, cacheKey, leg,
  addTrip, removeTrip, moveTrip, recordView, recordSearch, recordRide, updateStop,
  putCache, getCache, loadDoc, saveDoc, declineLocation, LOCATION_ASK_QUIET_MS,
  recordHomeVote, recordLastOpen, HOME_VOTES_CAP
} from '../js/storage.js';

const CENTRAL = { id: '200060', name: 'Central Station' };
const PARRA = { id: '215020', name: 'Parramatta Station' };
const TOWNHALL = { id: '200070', name: 'Town Hall Station' };

const trip = (id, from, to) => ({ id, from, to, createdAt: '2026-08-31T17:00:00+10:00' });
const T1 = trip('t1', CENTRAL, PARRA);
const T2 = trip('t2', TOWNHALL, PARRA);

function docWithTrips() {
  return addTrip(addTrip(emptyDoc(), T1), T2);
}

function memoryStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _map: map
  };
}

test('the whole document round-trips through one key', () => {
  let doc = docWithTrips();
  doc = recordView(doc, 't1', 'forward', Date.parse('2026-08-31T08:12:00+10:00'));
  doc = putCache(doc, cacheKey('200060', '215020'), { journeys: [] }, Date.parse('2026-08-31T08:12:00+10:00'));

  const back = parseDoc(serializeDoc(doc));
  assert.deepEqual(back, doc);
  assert.equal(back.schemaVersion, 1);
});

test('a corrupt document never bricks the app', () => {
  assert.deepEqual(parseDoc('{not json'), emptyDoc());
  assert.deepEqual(parseDoc(null), emptyDoc());
  assert.deepEqual(parseDoc('[]'), emptyDoc());
  assert.deepEqual(parseDoc('{"trips":[{"id":"x"}],"history":"nope"}'), emptyDoc());
});

test('half-valid input keeps what it can', () => {
  const doc = parseDoc(JSON.stringify({
    trips: [T1, { id: 'bad', from: CENTRAL }],
    history: [
      { tripId: 't1', direction: 'forward', t: '2026-08-31T08:12:00+10:00' },
      { tripId: 't1', direction: 'sideways', t: '2026-08-31T08:12:00+10:00' }
    ],
    lastViewed: { tripId: 't1', direction: 'reverse' },
    cache: { 'a-b': { fetchedAt: '2026-08-31T08:12:00+10:00', body: {} }, 'c-d': 'junk' }
  }));

  assert.equal(doc.trips.length, 1);
  assert.equal(doc.history.length, 1);
  assert.deepEqual(doc.lastViewed, { tripId: 't1', direction: 'reverse' });
  assert.deepEqual(Object.keys(doc.cache), ['a-b']);
});

test('history is capped at 500, oldest evicted', () => {
  let doc = docWithTrips();
  const start = Date.parse('2026-01-01T08:00:00+10:00');
  for (let i = 0; i < HISTORY_CAP + 25; i++) {
    doc = recordView(doc, 't1', 'forward', start + i * 60000);
  }

  assert.equal(doc.history.length, HISTORY_CAP);
  assert.equal(doc.history[0].t, new Date(start + 25 * 60000).toISOString());
  assert.equal(doc.history.at(-1).t, new Date(start + (HISTORY_CAP + 24) * 60000).toISOString());
});

test('a view event also becomes lastViewed', () => {
  const doc = recordView(docWithTrips(), 't2', 'reverse', Date.now());
  assert.deepEqual(doc.lastViewed, { tripId: 't2', direction: 'reverse' });
});

test('deleting a trip takes its live pointers but preserves completed-ride evidence', () => {
  let doc = docWithTrips();
  doc = recordView(doc, 't1', 'forward', Date.now());
  doc = recordView(doc, 't2', 'forward', Date.now());
  doc = putCache(doc, cacheKey('200060', '215020'), { a: 1 }, Date.now());
  doc = putCache(doc, cacheKey('215020', '200060'), { a: 2 }, Date.now());
  doc = recordRide(doc, { tripId: 't1', direction: 'forward' }, {
    departure: { scheduled: '2026-08-31T08:12:00+10:00' },
    arrival: { scheduled: '2026-08-31T08:41:00+10:00' }
  }, CENTRAL, PARRA);
  doc = recordView(doc, 't1', 'forward', Date.now());

  const after = removeTrip(doc, 't1');
  assert.deepEqual(after.trips.map((t) => t.id), ['t2']);
  assert.equal(after.history.every((e) => e.tripId === 't2'), true);
  assert.deepEqual(after.cache, {});
  assert.equal(after.lastViewed, null);
  assert.equal(after.rides.length, 1);
});

test('reorder moves a trip one place and refuses to fall off either end', () => {
  const doc = docWithTrips();
  assert.deepEqual(moveTrip(doc, 't2', -1).trips.map((t) => t.id), ['t2', 't1']);
  assert.deepEqual(moveTrip(doc, 't1', -1).trips.map((t) => t.id), ['t1', 't2']);
  assert.deepEqual(moveTrip(doc, 't2', 1).trips.map((t) => t.id), ['t1', 't2']);
  assert.deepEqual(moveTrip(doc, 'nope', 1).trips.map((t) => t.id), ['t1', 't2']);
});

test('cache holds saved pairs only, in both directions', () => {
  let doc = docWithTrips();
  doc = putCache(doc, cacheKey('200060', '215020'), { a: 1 }, Date.now());
  doc = putCache(doc, cacheKey('215020', '200060'), { a: 2 }, Date.now());
  doc = putCache(doc, cacheKey('999', '888'), { a: 3 }, Date.now());

  assert.equal(getCache(doc, '200060-215020').body.a, 1);
  assert.equal(getCache(doc, '215020-200060').body.a, 2);
  assert.equal(getCache(doc, '999-888'), null, 'an unsaved pair is not cached');

  const pruned = putCache(removeTrip(doc, 't1'), cacheKey('200070', '215020'), { a: 4 }, Date.now());
  assert.deepEqual(Object.keys(pruned.cache), ['200070-215020']);
});

test('reverse means to→from', () => {
  assert.deepEqual(leg(T1, 'forward'), { from: CENTRAL, to: PARRA });
  assert.deepEqual(leg(T1, 'reverse'), { from: PARRA, to: CENTRAL });
});

test('load and save use the single trains.v1 key', () => {
  const store = memoryStore();
  const doc = recordView(docWithTrips(), 't1', 'forward', Date.now());
  assert.equal(saveDoc(doc, store), true);
  assert.deepEqual([...store._map.keys()], [STORAGE_KEY]);
  assert.deepEqual(loadDoc(store), doc);
});

test('a storage write that throws is survivable', () => {
  const store = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.equal(saveDoc(emptyDoc(), store), false);
  assert.deepEqual(loadDoc(store), emptyDoc());
});

test('recent station choices are per field, deduplicated and capped at three', () => {
  let doc = emptyDoc();
  for (const stop of [CENTRAL, PARRA, TOWNHALL, { id: '213820', name: 'Rhodes Station' }, CENTRAL]) {
    doc = recordSearch(doc, 'from', stop);
  }
  doc = recordSearch(doc, 'to', PARRA);
  assert.deepEqual(doc.searches.from.map((stop) => stop.id), ['200060', '213820', '200070']);
  assert.deepEqual(doc.searches.to.map((stop) => stop.id), ['215020']);
});

test('station coordinates survive parse and can be lazily backfilled', () => {
  const located = { ...CENTRAL, location: { lat: -33.883, lon: 151.207 } };
  let doc = addTrip(emptyDoc(), T1);
  doc = updateStop(doc, located);
  assert.deepEqual(parseDoc(serializeDoc(doc)).trips[0].from, located);
});

test('saved trips use a ten-item LRU cap', () => {
  let doc = emptyDoc();
  const start = Date.parse('2026-09-01T08:00:00+10:00');
  for (let i = 0; i < TRIPS_CAP; i++) {
    doc = addTrip(doc, trip(`t${i}`, { id: `a${i}`, name: `A ${i}` }, { id: `b${i}`, name: `B ${i}` }));
  }
  doc = recordView(doc, 't0', 'forward', start + 60_000);
  doc = addTrip(doc, trip('new', { id: 'new-a', name: 'New A' }, { id: 'new-b', name: 'New B' }));
  assert.equal(doc.trips.length, TRIPS_CAP);
  assert.ok(doc.trips.some((saved) => saved.id === 't0'), 'a recently used old trip is retained');
  assert.ok(!doc.trips.some((saved) => saved.id === 't1'), 'the least recently used trip is evicted');
  assert.ok(doc.trips.some((saved) => saved.id === 'new'));
});

test('completed rides deduplicate on planned departure when realtime changes', () => {
  const scheduled = '2026-09-01T09:24:00+10:00';
  const base = {
    departure: { scheduled, estimated: '2026-09-01T09:26:00+10:00' },
    arrival: { scheduled: '2026-09-01T10:08:00+10:00', estimated: '2026-09-01T10:10:00+10:00' }
  };
  let doc = recordRide(docWithTrips(), { tripId: 't1', direction: 'forward' }, base, CENTRAL, PARRA);
  const refreshed = structuredClone(base);
  refreshed.departure.estimated = '2026-09-01T09:27:00+10:00';
  doc = recordRide(doc, { tripId: 't1', direction: 'forward' }, refreshed, CENTRAL, PARRA);
  assert.equal(doc.rides.length, 1);
  assert.equal(doc.rides[0].scheduledDeparture, scheduled);
});


test('a declined location ask is remembered, and a malformed one is dropped', () => {
  const atMs = Date.parse('2026-09-01T09:21:00+10:00');
  const doc = declineLocation(docWithTrips(), atMs);
  assert.deepEqual(doc.locationAsk, { declinedAt: '2026-08-31T23:21:00.000Z' });
  assert.deepEqual(parseDoc(serializeDoc(doc)).locationAsk, doc.locationAsk);

  // Absent means never declined: a document written before this shipped needs
  // no migration.
  assert.equal(parseDoc(serializeDoc(docWithTrips())).locationAsk, undefined);
  assert.equal(parseDoc(JSON.stringify({ locationAsk: { declinedAt: 7 } })).locationAsk, undefined);
  assert.equal(parseDoc(JSON.stringify({ locationAsk: 'nope' })).locationAsk, undefined);
  assert.equal(LOCATION_ASK_QUIET_MS, 30 * 86_400_000);
});


/* ---- home votes, the previous open, and the kind of focus --------------- */

const RHODES = { id: '213820', name: 'Rhodes Station', location: { lat: -33.8308, lon: 151.0879 } };
const BURWOOD = { id: '213410', name: 'Burwood Station' };
const JOURNEY = { line: { name: 'T9' }, departure: { scheduled: '2026-09-05T09:24:00+10:00' } };
const day = (date, time = '08:05') => Date.parse(`2026-09-${date}T${time}:00+10:00`);

test('one home vote per local day, newest last, capped at seven', () => {
  let doc = emptyDoc();
  for (let d = 1; d <= 8; d++) doc = recordHomeVote(doc, RHODES, day(String(d).padStart(2, '0')));

  assert.equal(doc.homeVotes.length, HOME_VOTES_CAP);
  assert.deepEqual(doc.homeVotes.map((vote) => vote.day),
    ['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08']);
  assert.deepEqual(doc.homeVotes[0].station, RHODES, 'the vote keeps the station coordinates');

  // A second open the same day, even much later, is the same day's one vote.
  const again = recordHomeVote(doc, BURWOOD, day('08', '23:50'));
  assert.equal(again, doc);
  assert.equal(recordHomeVote(doc, { id: '', name: 'x' }, day('09')), doc);
});

test('the day a vote records is the device\'s calendar day, not UTC\'s', () => {
  // 09:00 on the 6th in Sydney is still 23:00 on the 5th in UTC.
  const doc = recordHomeVote(emptyDoc(), RHODES, Date.parse('2026-09-06T09:00:00+10:00'));
  assert.equal(doc.homeVotes[0].day, '2026-09-06');
});

test('votes, the previous open and the kind of focus survive a round trip', () => {
  let doc = { ...docWithTrips(), focus: {
    tripId: 't1', direction: 'forward', focusedAt: '2026-09-05T09:20:00+10:00',
    by: 'inferred', journey: JOURNEY
  } };
  doc = recordHomeVote(doc, RHODES, day('05'));
  doc = recordLastOpen(doc, {
    station: { ...RHODES }, tripId: 't1', direction: 'forward', journey: JOURNEY
  }, day('05', '09:15'));

  assert.deepEqual(doc.lastOpen, {
    at: '2026-09-04T23:15:00.000Z',
    station: { id: RHODES.id, name: RHODES.name },
    tripId: 't1',
    direction: 'forward',
    journey: JOURNEY
  });
  assert.equal(doc.lastOpen.station.location, undefined, 'no coordinate is ever persisted');
  assert.deepEqual(parseDoc(serializeDoc(doc)), doc);
});

test('a document written before this shipped needs no migration', () => {
  const legacy = JSON.stringify({
    trips: [], home: { station: RHODES, confidence: 4, inferredAt: '2026-08-31T20:00:00+10:00' },
    focus: { tripId: 't1', direction: 'forward', focusedAt: '2026-09-05T09:20:00+10:00', journey: JOURNEY }
  });
  const doc = parseDoc(legacy);

  assert.equal(doc.home, undefined, 'the stored home is gone, not carried');
  assert.deepEqual(doc.homeVotes, []);
  assert.equal(doc.lastOpen, null);
  assert.equal(doc.focus.by, 'focus', 'an unlabelled focus is a hand-focused one');
});

test('a malformed vote, previous open or focus kind is dropped, not repaired', () => {
  const votes = (list) => parseDoc(JSON.stringify({ homeVotes: list })).homeVotes;

  assert.deepEqual(votes([{ day: '2026-09-05', station: RHODES }]).map((v) => v.day), ['2026-09-05']);
  assert.deepEqual(votes([{ day: '5 September', station: RHODES }]), []);
  assert.deepEqual(votes([{ day: '2026-09-05' }]), []);
  assert.deepEqual(votes([{ day: '2026-09-05', station: { id: '213820' } }]), []);
  assert.deepEqual(votes('not a list'), []);
  assert.deepEqual(
    votes([{ day: '2026-09-05', station: RHODES }, { day: '2026-09-05', station: BURWOOD }])
      .map((v) => v.station.id), ['213820'], 'two votes on one day are one vote');

  const open = (value) => parseDoc(JSON.stringify({ lastOpen: value })).lastOpen;
  const good = { at: '2026-09-05T09:15:00+10:00', station: null, tripId: 't1', direction: 'forward', journey: JOURNEY };
  assert.deepEqual(open(good), good);
  assert.equal(open({ ...good, direction: 'sideways' }), null);
  assert.equal(open({ ...good, journey: null }), null);
  assert.equal(open({ ...good, at: 0 }), null);
  assert.equal(open({ ...good, station: { name: 'Rhodes Station' } }), null);

  const focus = { tripId: 't1', direction: 'forward', focusedAt: '2026-09-05T09:20:00+10:00', journey: JOURNEY };
  assert.equal(parseDoc(JSON.stringify({ focus: { ...focus, by: 'guessed' } })).focus, undefined);
  assert.equal(parseDoc(JSON.stringify({ focus: { ...focus, by: 'inferred' } })).focus.by, 'inferred');
});

test('deleting a trip takes the previous open that described it', () => {
  const doc = recordLastOpen(docWithTrips(), {
    station: CENTRAL, tripId: 't1', direction: 'forward', journey: JOURNEY
  }, day('05', '09:15'));

  assert.equal(removeTrip(doc, 't1').lastOpen, null);
  assert.deepEqual(removeTrip(doc, 't2').lastOpen, doc.lastOpen);
});
