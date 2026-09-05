process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AT_STATION_KM, NEAR_STATION_KM, distanceKm, here, loadStations, nearest
} from '../js/stations.js';
import { emptyDoc } from '../js/storage.js';
import { INDEX, STATIONS, tripBetween } from './fixture.js';

test('the index answers the nearest station inside a radius, and nothing outside it', () => {
  const atTownHall = { lat: -33.87215, lon: 151.2070 };
  assert.equal(nearest(INDEX, atTownHall, NEAR_STATION_KM).station.id, STATIONS.townhall.id);
  assert.ok(Math.abs(nearest(INDEX, atTownHall, NEAR_STATION_KM).km - 0.15) < 0.005);
  assert.equal(nearest(INDEX, atTownHall, 0.1), null);
  assert.equal(nearest(INDEX, null, NEAR_STATION_KM), null);
  assert.equal(nearest(null, atTownHall, NEAR_STATION_KM), null);
  assert.equal(distanceKm({ lat: -33.8308, lon: 151.0879 }, null), null);
});

test('tier 1: standing at a station wins even when a saved origin is nearer than 2 km', () => {
  // 150 m from Town Hall, 1.23 km from the saved trip's Central.
  const doc = { ...emptyDoc(), trips: [tripBetween('t1', 'central', 'parramatta')] };
  const spot = here(doc, INDEX, { lat: -33.87215, lon: 151.2070 });

  assert.deepEqual([spot.station.id, spot.tier], [STATIONS.townhall.id, 1]);
  assert.ok(distanceKm({ lat: -33.87215, lon: 151.2070 }, STATIONS.townhall.location) <= AT_STATION_KM);
});

test('tier 2: a saved end at 1.2 km beats a station the user has never used at 0.3 km', () => {
  const doc = { ...emptyDoc(), trips: [tripBetween('t1', 'rhodes', 'bondi')] };
  const fix = { lat: -33.820054, lon: 151.089193 };
  const spot = here(doc, INDEX, fix);

  assert.deepEqual([spot.station.id, spot.tier], [STATIONS.rhodes.id, 2]);
  assert.equal(nearest(INDEX, fix, NEAR_STATION_KM).station.id, STATIONS.meadowbank.id);
});

test('tier 3: with no saved end within 2 km the nearest index station answers', () => {
  const doc = { ...emptyDoc(), trips: [tripBetween('t1', 'rhodes', 'bondi')] };
  const spot = here(doc, INDEX, { lat: -33.8907, lon: 151.1040 });

  assert.deepEqual([spot.station.id, spot.tier], [STATIONS.burwood.id, 3]);
});

test('further than 2 km from every station, and without an index, there is no here', () => {
  const doc = { ...emptyDoc(), trips: [tripBetween('t1', 'rhodes', 'bondi')] };
  assert.equal(here(doc, INDEX, { lat: -33.9042, lon: 151.1040 }), null);
  assert.equal(here(doc, null, { lat: -33.87215, lon: 151.2070 }), null);
  assert.equal(here(doc, INDEX, null), null);
});

test('the index is fetched once per page load and a failure degrades to null', async () => {
  let calls = 0;
  const fetchFn = async (url) => {
    calls += 1;
    assert.equal(url, '/stations.json');
    return { ok: true, json: async () => INDEX };
  };
  assert.deepEqual(await loadStations(fetchFn), INDEX);
  assert.deepEqual(await loadStations(fetchFn), INDEX);
  assert.equal(calls, 1, 'the second open of the page is not a second request');

  const fresh = await import('../js/stations.js?failure');
  assert.equal(await fresh.loadStations(async () => { throw new Error('offline'); }), null);

  const notFound = await import('../js/stations.js?notfound');
  assert.equal(await notFound.loadStations(async () => ({ ok: false })), null);

  const garbage = await import('../js/stations.js?garbage');
  assert.equal(await garbage.loadStations(async () => ({ ok: true, json: async () => ({}) })), null);
});
