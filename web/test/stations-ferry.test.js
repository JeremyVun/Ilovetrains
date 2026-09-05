import test from 'node:test';
import assert from 'node:assert/strict';
import { here, nearest, loadStations } from '../js/stations.js';

const fix = { lat: -33.86, lon: 151.2 };
const stop = (id, northMetres) => ({ id, name: id, location: { lat: fix.lat + northMetres / 111195, lon: fix.lon } });
const wharf = stop('wharf', 60);
const rail = {
  ...stop('rail', -20 / 3),
  location: {
    lat: fix.lat - (20 / 3) / 111195,
    lon: fix.lon + Math.sqrt(100 ** 2 - (20 / 3) ** 2) / (111195 * Math.cos(fix.lat * Math.PI / 180))
  }
};
const doc = (...ends) => ({ trips: ends.map((from) => ({ from, to: stop('home', 5000) })) });

test('inside 200 m a saved endpoint wins, then distance breaks the tie', () => {
  const stations = [rail, wharf];
  assert.deepEqual(here(doc(rail), stations, fix), { station: rail, tier: 1 });
  assert.deepEqual(here(doc(), stations, fix), { station: wharf, tier: 1 });
  assert.deepEqual(here(doc(rail, wharf), stations, fix), { station: wharf, tier: 1 });
  assert.equal(here({ trips: [{ from: stop('home', 5000), to: rail }] }, stations, fix).station, rail);
});

test('a saved endpoint outside 200 m cannot displace a station inside it', () => {
  const saved = stop('saved', 800);
  assert.deepEqual(here(doc(saved), [saved, wharf], fix), { station: wharf, tier: 1 });
});

test('the outer tiers prefer saved ends within 2 km, then any nearest station', () => {
  const saved = stop('saved', 1200);
  const nearer = stop('nearer', 900);
  assert.deepEqual(here(doc(saved), [saved, nearer], fix), { station: saved, tier: 2 });
  assert.deepEqual(here(doc(), [saved, nearer], fix), { station: nearer, tier: 3 });
  assert.equal(here(doc(), [stop('far', 3000)], fix), null);
});

test('the index backfills coordinates and names for a saved endpoint before tier 2', () => {
  const saved = stop('saved', 1200);
  const nearer = stop('nearer', 900);
  const legacy = { id: saved.id, name: 'Old name' };
  assert.deepEqual(here(doc(legacy), [saved, nearer], fix), { station: saved, tier: 2 });
  assert.equal(here(doc(legacy), [saved, nearer], fix).station.name, saved.name);
});

test('missing index, fix and coordinates provide no location answer', () => {
  assert.equal(here(doc(rail), null, fix), null);
  assert.equal(here(doc(rail), [rail], null), null);
  assert.equal(nearest([{ id: 'unknown' }], fix, 2), null);
});

test('the index loader shares one request and returns the published stops', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    assert.equal(url, '/stations.json');
    return { ok: true, json: async () => [rail, wharf] };
  });
  const first = loadStations();
  assert.equal(first, loadStations());
  assert.deepEqual(await first, [rail, wharf]);
  assert.equal(calls, 1);
});

test('a failed index request degrades to no station answer', async (t) => {
  const { loadStations: freshLoader } = await import('../js/stations.js?failed-fetch');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  assert.equal(await freshLoader(), null);
});
