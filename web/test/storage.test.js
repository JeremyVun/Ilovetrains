process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_KEY, HISTORY_CAP, TRIPS_CAP, emptyDoc, parseDoc, serializeDoc, cacheKey, leg,
  addTrip, removeTrip, moveTrip, recordView, recordSearch, recordRide, updateStop,
  putCache, getCache, loadDoc, saveDoc, declineLocation, LOCATION_ASK_QUIET_MS,
  recordOpen, band, milestone
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


test('telemetry is kept only when both counters are in range', () => {
  const good = { opens: 12, bucket: 37 };
  assert.deepEqual(parseDoc(JSON.stringify({ telemetry: good })).telemetry, good);
  assert.deepEqual(parseDoc(JSON.stringify({ telemetry: { opens: 0, bucket: 0 } })).telemetry,
    { opens: 0, bucket: 0 });
  assert.deepEqual(parseDoc(JSON.stringify({ telemetry: { opens: 2, bucket: 99 } })).telemetry,
    { opens: 2, bucket: 99 });

  for (const bad of [{ opens: '7', bucket: 3 }, { opens: 2, bucket: 100 }, { opens: -1, bucket: 3 },
    { opens: 1.5, bucket: 3 }, { opens: 2, bucket: -1 }, { opens: 2 }, { bucket: 2 }, 'nope']) {
    assert.equal(parseDoc(JSON.stringify({ telemetry: bad })).telemetry, undefined,
      `${JSON.stringify(bad)} should be dropped whole`);
  }
  assert.equal(parseDoc(serializeDoc(emptyDoc())).telemetry, undefined);
});

test('an open increments the counter and draws the bucket exactly once', () => {
  const first = recordOpen(emptyDoc(), () => 0.37);
  assert.deepEqual(first.telemetry, { opens: 1, bucket: 37 });

  const second = recordOpen(first, () => 0.9);
  assert.deepEqual(second.telemetry, { opens: 2, bucket: 37 }, 'the bucket is drawn once, ever');
  assert.deepEqual(recordOpen(emptyDoc(), () => 0.999).telemetry, { opens: 1, bucket: 99 });
  assert.deepEqual(recordOpen(emptyDoc(), () => 0).telemetry, { opens: 1, bucket: 0 });
  assert.equal(emptyDoc().telemetry, undefined, 'recordOpen is pure');
});

test('usage bands cover absent telemetry and every boundary', () => {
  assert.equal(band(emptyDoc()), '1');
  for (const [opens, expected] of [
    [0, '1'], [1, '1'], [2, '2-5'], [5, '2-5'], [6, '6-10'], [10, '6-10'],
    [11, '11-15'], [15, '11-15'], [16, '16-20'], [20, '16-20'],
    [21, '21-25'], [25, '21-25'], [26, '26-30'], [30, '26-30'],
    [31, '31-35'], [35, '31-35'], [36, '36-40'], [40, '36-40'],
    [41, '41-45'], [45, '41-45'], [46, '46-50'], [50, '46-50'], [51, '51+']
  ]) {
    assert.equal(band({ telemetry: { opens } }), expected, `opens ${opens}`);
  }
});

test('open milestones are strings and fire only at their exact counts', () => {
  const milestones = [1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250];
  for (const opens of milestones) {
    assert.equal(milestone({ telemetry: { opens } }), String(opens));
  }
  for (const opens of [0, 2, 4, 6, 11, 26, 39, 51, 249, 251]) {
    assert.equal(milestone({ telemetry: { opens } }), null, `opens ${opens}`);
  }
  assert.equal(milestone(emptyDoc()), null);
});

test('telemetry round-trips through trains.v1 with the rest of the document', () => {
  const store = memoryStore();
  const doc = recordOpen(docWithTrips(), () => 0.37);
  saveDoc(doc, store);
  assert.deepEqual(loadDoc(store), doc);
  assert.deepEqual([...store._map.keys()], [STORAGE_KEY], 'still one key');
});
