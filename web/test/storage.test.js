process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_KEY, HISTORY_CAP, TRIPS_CAP, emptyDoc, parseDoc, serializeDoc, cacheKey, leg,
  addTrip, removeTrip, moveTrip, recordView, recordSearch, recordRide, updateStop,
  putCache, getCache, loadDoc, saveDoc
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
