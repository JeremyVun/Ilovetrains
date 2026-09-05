import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENDPOINT, PROJECT, QUEUE_KEY, QUEUE_CAP, EXPERIMENTS,
  isEnabled, variant, experimentDims, createAnalytics
} from '../js/analytics.js';
import { emptyDoc, recordOpen } from '../js/storage.js';

function memoryStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map
  };
}

const bucketed = (bucket, opens = 1) => ({ ...emptyDoc(), telemetry: { opens, bucket } });

/* A document with no bucket still rides in the control arm, so every enabled
   event carries the experiment dimension. */
const d = (u = '1') => ({ u, 'x.strip-placement': 'a3' });

function fakeFetch(...responses) {
  const calls = [];
  const fetchFn = (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  fetchFn.calls = calls;
  return fetchFn;
}

function make(overrides = {}) {
  const storage = overrides.storage || memoryStore();
  const scheduled = [];
  const analytics = createAnalytics({
    enabled: true,
    storage,
    fetchFn: overrides.fetchFn || fakeFetch({ ok: true }),
    beacon: overrides.beacon,
    schedule: overrides.schedule || ((flush) => scheduled.push(flush)),
    getDoc: overrides.getDoc || (() => emptyDoc()),
    ...('isOnline' in overrides ? { isOnline: overrides.isOnline } : {}),
    ...('enabled' in overrides ? { enabled: overrides.enabled } : {})
  });
  return { analytics, storage, scheduled };
}

test('analytics is enabled only on the production origin, with consent and a usable store', () => {
  const storage = memoryStore();
  assert.equal(isEnabled({ hostname: 'ilovetrains.jeremyvun.com', storage }), true);
  assert.equal(isEnabled({ hostname: 'localhost', storage }), false);
  assert.equal(isEnabled({ hostname: 'ilovetrains.jeremyvun.com', gpc: true, storage }), false);
  assert.equal(isEnabled({ hostname: 'ilovetrains.jeremyvun.com', dnt: '1', storage }), false);
  assert.equal(isEnabled({ hostname: 'ilovetrains.jeremyvun.com' }), false);
  assert.equal(isEnabled({
    hostname: 'ilovetrains.jeremyvun.com',
    storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } }
  }), false);
  assert.equal(isEnabled(), false);
  assert.deepEqual([...storage._map.keys()], [], 'the probe leaves nothing behind');
});

test('the bucket picks the variant, and the control answers when it cannot', () => {
  assert.deepEqual(EXPERIMENTS['strip-placement'], { variants: ['a3', 'a2'], offset: 0 });
  assert.equal(variant(bucketed(37), 'strip-placement', true), 'a2');
  assert.equal(variant(bucketed(38), 'strip-placement', true), 'a3');
  assert.equal(variant(emptyDoc(), 'strip-placement', true), 'a3');
  assert.equal(variant(bucketed(37), 'strip-placement', false), 'a3');
  assert.equal(variant(null, 'strip-placement', true), 'a3');
});

test('every running experiment dimensions every event, and none does when disabled', () => {
  assert.deepEqual(experimentDims(bucketed(37), true), { 'x.strip-placement': 'a2' });
  assert.deepEqual(experimentDims(bucketed(37), false), {});
  assert.deepEqual(Object.keys(experimentDims(emptyDoc(), true)),
    Object.keys(EXPERIMENTS).map((id) => 'x.' + id));
});

test('an event carries its usage band, its own dims and the experiment, and nothing else', () => {
  const { analytics } = make({ getDoc: () => bucketed(37, 4) });
  analytics.track('saved_setup', { f: 'search' });
  assert.deepEqual(analytics.events, [
    { t: 'saved_setup', d: { u: '2-5', f: 'search', 'x.strip-placement': 'a2' } }
  ]);
});

test('repeats compact to a count, a changed dimension starts a new entry', () => {
  let doc = emptyDoc();
  const { analytics, storage } = make({ getDoc: () => doc });
  for (let i = 0; i < 5; i++) analytics.track('shown_predicted');
  assert.deepEqual(analytics.queue(), [{ t: 'shown_predicted', d: d(), n: 5 }]);

  doc = recordOpen(bucketed(37, 4), () => 0);
  analytics.track('shown_predicted');
  assert.deepEqual(analytics.queue(), [
    { t: 'shown_predicted', d: d(), n: 5 },
    { t: 'shown_predicted', d: { u: '2-5', 'x.strip-placement': 'a2' }, n: 1 }
  ]);
  assert.equal(analytics.events.length, 6, 'the ledger keeps every record');
  assert.deepEqual(JSON.parse(storage._map.get(QUEUE_KEY)).queue.length, 2);
});

test('the queue is capped at 200 entries, oldest dropped', () => {
  const { analytics } = make();
  for (let i = 0; i < QUEUE_CAP; i++) analytics.track('e' + i);
  assert.equal(analytics.queue().length, QUEUE_CAP);
  analytics.track('e' + QUEUE_CAP);
  const queue = analytics.queue();
  assert.equal(queue.length, QUEUE_CAP);
  assert.equal(queue[0].t, 'e1');
  assert.equal(queue.at(-1).t, 'e200');
});

test('a malformed queue is treated as empty rather than losing the app', () => {
  const storage = memoryStore();
  storage.setItem(QUEUE_KEY, '{not json');
  const { analytics } = make({ storage });
  analytics.track('shown_predicted');
  assert.deepEqual(analytics.queue(), [{ t: 'shown_predicted', d: d(), n: 1 }]);

  storage.setItem(QUEUE_KEY, '{"queue":"nope"}');
  analytics.track('shown_predicted');
  assert.deepEqual(analytics.queue(), [{ t: 'shown_predicted', d: d(), n: 1 }]);
});

test('disabled records to the ledger and writes nothing at all', () => {
  const fetchFn = fakeFetch({ ok: true });
  const { analytics, storage, scheduled } = make({ enabled: false, fetchFn });
  analytics.track('shown_predicted');
  assert.deepEqual(analytics.events, [{ t: 'shown_predicted', d: { u: '1' } }]);
  assert.deepEqual([...storage._map.keys()], []);
  assert.deepEqual(scheduled, []);
  return analytics.flush().then(() => assert.equal(fetchFn.calls.length, 0));
});

test('malformed queue entries cannot prevent subsequent recording or sending', async () => {
  for (const entry of [null, {}, { t: 'shown_predicted', n: 1 },
    { t: 'shown_predicted', d: {}, n: '1' },
    { t: 'shown_predicted', d: { u: {} }, n: 1 },
    { t: 'shown_predicted', d: {}, n: -1 }]) {
    const storage = memoryStore();
    storage.setItem(QUEUE_KEY, JSON.stringify({ queue: [entry] }));
    const fetchFn = fakeFetch({ ok: true });
    const { analytics } = make({ storage, fetchFn });
    analytics.track('shown_predicted');
    assert.deepEqual(analytics.queue(), [{ t: 'shown_predicted', d: d(), n: 1 }]);
    await analytics.flush();
    assert.equal(fetchFn.calls.length, 1);
    assert.deepEqual(analytics.queue(), []);
  }
});

test('offline flushes keep counts without calling fetch or beacon, then send online', async () => {
  let online = false;
  let beacons = 0;
  const fetchFn = fakeFetch({ ok: true });
  const { analytics } = make({ fetchFn, isOnline: () => online,
    beacon: () => { beacons++; return true; } });
  analytics.track('shown_predicted');
  await analytics.flush();
  await analytics.flush({ beacon: true });
  assert.equal(fetchFn.calls.length, 0);
  assert.equal(beacons, 0);
  assert.deepEqual(analytics.queue(), [{ t: 'shown_predicted', d: d(), n: 1 }]);
  online = true;
  await analytics.flush();
  assert.equal(fetchFn.calls.length, 1);
  assert.deepEqual(analytics.queue(), []);
});

test('the flush is scheduled once per page load, and it is the flush', () => {
  const { analytics, scheduled } = make();
  analytics.track('shown_predicted');
  analytics.track('shown_predicted');
  analytics.track('hit_predicted');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0], analytics.flush);
});

test('a flush posts the whole queue as one text/plain array and clears it on ok', async () => {
  const fetchFn = fakeFetch({ ok: true });
  const { analytics } = make({ fetchFn });
  analytics.track('shown_predicted');
  analytics.track('shown_predicted');
  analytics.track('hit_predicted');
  await analytics.flush();

  assert.equal(fetchFn.calls.length, 1);
  const { url, init, body } = fetchFn.calls[0];
  assert.equal(url, ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.keepalive, true);
  assert.deepEqual(init.headers, { 'Content-Type': 'text/plain' });
  assert.deepEqual(body, [
    { p: PROJECT, t: 'shown_predicted', d: d(), n: 2 },
    { p: PROJECT, t: 'hit_predicted', d: d(), n: 1 }
  ]);
  assert.deepEqual(analytics.queue(), []);
});

test('an empty queue and a disabled client never reach the network', async () => {
  const fetchFn = fakeFetch({ ok: true });
  const { analytics } = make({ fetchFn });
  await analytics.flush();
  assert.equal(fetchFn.calls.length, 0);
});

test('a 429, another failure status or a dead network keeps every count', async () => {
  const fetchFn = fakeFetch({ ok: false, status: 429 }, { ok: false, status: 500 },
    new Error('offline'));
  const { analytics } = make({ fetchFn });
  analytics.track('shown_predicted');
  const queued = analytics.queue();

  for (let attempt = 0; attempt < 3; attempt++) {
    await analytics.flush();
    assert.deepEqual(analytics.queue(), queued, `attempt ${attempt} kept the queue`);
  }
  assert.equal(fetchFn.calls.length, 3);
});

test('a beacon that takes the payload clears it; one that refuses falls through to fetch', async () => {
  const beaconCalls = [];
  let accepts = true;
  const beacon = (url, body) => {
    beaconCalls.push({ url, body });
    return accepts;
  };
  const fetchFn = fakeFetch({ ok: true });
  const { analytics } = make({ beacon, fetchFn });

  analytics.track('shown_predicted');
  await analytics.flush({ beacon: true });
  assert.equal(beaconCalls.length, 1);
  assert.equal(beaconCalls[0].url, ENDPOINT);
  assert.deepEqual(JSON.parse(beaconCalls[0].body),
    [{ p: PROJECT, t: 'shown_predicted', d: d(), n: 1 }]);
  assert.equal(fetchFn.calls.length, 0);
  assert.deepEqual(analytics.queue(), []);

  accepts = false;
  analytics.track('hit_predicted');
  await analytics.flush({ beacon: true });
  assert.equal(beaconCalls.length, 2);
  assert.equal(fetchFn.calls.length, 1, 'a refused beacon falls through to the keepalive fetch');
  assert.deepEqual(analytics.queue(), []);
});

test('counts recorded while a flush is in flight survive it, including repeats', async () => {
  let settle;
  const fetchFn = fakeFetch(new Promise((resolve) => { settle = resolve; }));
  const { analytics } = make({ fetchFn });
  analytics.track('shown_predicted');
  analytics.track('shown_predicted');

  const inFlight = analytics.flush();
  analytics.track('shown_predicted');
  analytics.track('hit_predicted');
  settle({ ok: true });
  await inFlight;

  assert.deepEqual(fetchFn.calls[0].body,
    [{ p: PROJECT, t: 'shown_predicted', d: d(), n: 2 }]);
  assert.deepEqual(analytics.queue(), [
    { t: 'shown_predicted', d: d(), n: 1 },
    { t: 'hit_predicted', d: d(), n: 1 }
  ]);
});

test('overlapping fetch and page-leave flushes share one send and preserve newer counts', async () => {
  let resolve;
  const fetchFn = fakeFetch(new Promise((r) => { resolve = r; }), { ok: true });
  let beacons = 0;
  const { analytics } = make({ fetchFn, beacon: () => { beacons++; return true; } });
  analytics.track('shown_predicted');
  const first = analytics.flush();
  const second = analytics.flush();
  analytics.track('shown_predicted');
  const leaving = analytics.flush({ beacon: true });
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(beacons, 0);
  resolve({ ok: true });
  await Promise.all([first, second, leaving]);
  assert.deepEqual(analytics.queue(), [{ t: 'shown_predicted', d: d(), n: 1 }]);
  await analytics.flush();
  assert.equal(fetchFn.calls.length, 2);
  assert.deepEqual(analytics.queue(), []);
});
