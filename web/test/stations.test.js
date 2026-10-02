process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AT_STATION_KM, NEAR_STATION_KM, SIGHTING_KM, distanceKm, here, loadStations, nearest, setupHere,
  sightingOf, trainSpeed
} from '../js/stations.js';
import { emptyDoc } from '../js/storage.js';
import { locate, scoreAll } from '../js/predict.js';
import { INDEX, STATIONS, tripBetween } from './fixture.js';

/* The index's own points (web/stations.json): Gadigal is 152 m from Town Hall. */
const TOWN_HALL = { id: '200070', name: 'Town Hall Station', modes: ['train'], location: { lat: -33.873596, lon: 151.206899 } };
const GADIGAL = { id: '200066', name: 'Gadigal Station', modes: ['metro'], location: { lat: -33.873866, lon: 151.208509 } };
const RHODES = { id: '213820', name: 'Rhodes Station', modes: ['train'], location: { lat: -33.83053, lon: 151.087032 } };
const CITY = [TOWN_HALL, GADIGAL, RHODES];
const commute = { ...emptyDoc(), trips: [{ id: 'c', from: RHODES, to: TOWN_HALL, createdAt: new Date(0).toISOString() }] };
/* 269 m from Town Hall and 119 m from Gadigal; then 342 m and 193 m. */
const NEAR_GADIGAL = { lat: -33.8738, lon: 151.209799 };
const FURTHER_EAST = { lat: -33.8738, lon: 151.210599 };

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

test('a saved station within 400 m beats a stranger within 200 m (the Gadigal case)', () => {
  for (const fix of [NEAR_GADIGAL, FURTHER_EAST]) {
    assert.ok(distanceKm(fix, GADIGAL.location) < AT_STATION_KM);
    const spot = here(commute, CITY, fix);
    assert.deepEqual([spot.station.id, spot.tier], [TOWN_HALL.id, 1]);
  }
  assert.equal(here(emptyDoc(), CITY, NEAR_GADIGAL).station.id, GADIGAL.id, 'unsaved, the nearer station answers');
  assert.equal(locate(commute, Date.parse('2026-10-01T17:30:00+10:00'), { fix: NEAR_GADIGAL, stations: CITY }).direction,
    'reverse', 'the way back from Town Hall');
});

test('setup keeps the 200 m rule: a new trip starts where the user stands', () => {
  for (const fix of [NEAR_GADIGAL, FURTHER_EAST]) {
    assert.equal(setupHere(commute, CITY, fix).station.id, GADIGAL.id);
  }
  const atTownHall = { ...TOWN_HALL.location, speed: 12 };
  assert.equal(setupHere(commute, CITY, atTownHall).station.id, TOWN_HALL.id, 'setup has no train-speed rule');
  assert.deepEqual(setupHere(commute, CITY, { lat: -33.8738, lon: 151.2180 }), { station: TOWN_HALL, tier: 2 });
});

test('the sighting is here within 300 m of its point, and nothing further', () => {
  assert.equal(sightingOf(here(commute, CITY, NEAR_GADIGAL), NEAR_GADIGAL).id, TOWN_HALL.id);
  assert.ok(distanceKm(FURTHER_EAST, TOWN_HALL.location) > SIGHTING_KM);
  assert.equal(sightingOf(here(commute, CITY, FURTHER_EAST), FURTHER_EAST), null);
  assert.equal(sightingOf(null, NEAR_GADIGAL), null);
});

test('a reported speed decides train speed; without one only an impossible jump does', () => {
  const at = Date.parse('2026-10-01T17:40:00+10:00');
  const fix = { ...TOWN_HALL.location, at, accuracy: 20 };
  assert.equal(trainSpeed({ ...fix, speed: 8 }), true);
  assert.equal(trainSpeed({ ...fix, speed: 7.9 }), false);
  /* 30 s at 8 m/s plus both accuracies is 280 m. */
  const behind = (metres, gap = 30_000, accuracy = 20) => ({
    lat: TOWN_HALL.location.lat + metres / 111_195, lon: TOWN_HALL.location.lon, at: at - gap, accuracy
  });
  assert.equal(trainSpeed(fix, behind(281)), true);
  assert.equal(trainSpeed(fix, behind(279)), false, 'GPS jitter cannot reach the bound');
  assert.equal(trainSpeed({ ...fix, speed: 0 }, behind(2000)), false, 'a usable speed is not second-guessed');
  assert.equal(trainSpeed({ ...fix, speed: -1 }, behind(281)), true, 'an invalid speed is no speed');
  assert.equal(trainSpeed(fix, behind(5000, 14_999)), false, 'under 15 s apart');
  assert.equal(trainSpeed(fix, behind(5000, 120_001)), false, 'over 120 s apart');
  assert.equal(trainSpeed(fix, behind(5000, 120_000)), true);
  assert.equal(trainSpeed({ ...fix, accuracy: undefined }, behind(5000)), false, 'unknown accuracy');
  assert.equal(trainSpeed(fix, behind(5000, 30_000, NaN)), false);
  assert.equal(trainSpeed(fix, null), false);
});

test('a fix at train speed has no here, no pair and no location term', () => {
  const now = Date.parse('2026-10-01T17:30:00+10:00');
  const moving = { ...TOWN_HALL.location, speed: 12 };
  assert.equal(here(commute, CITY, moving), null);
  assert.equal(here(commute, CITY, { ...TOWN_HALL.location, at: now, accuracy: 10 },
    { lat: -33.8790, lon: 151.2069, at: now - 30_000, accuracy: 10 }), null, 'derived from the previous fix');
  assert.deepEqual(locate(commute, now, { fix: moving, stations: CITY }),
    { kind: 'trip', tripId: 'c', direction: 'forward', leap: 'usual' }, 'the no-location answer');
  const strathfield = { id: '213510', name: 'Strathfield Station', modes: ['train'], location: { lat: -33.87181, lon: 151.094427 } };
  const passing = { ...strathfield.location, speed: 0 };
  assert.equal(locate(commute, now, { fix: passing, stations: [...CITY, strathfield] }).kind, 'pair');
  assert.equal(locate(commute, now, { fix: { ...passing, speed: 12 }, stations: [...CITY, strathfield] }).kind, 'trip',
    'a passing station never becomes a saved pair');
  assert.ok(scoreAll(commute, now, { fix: moving }).every((candidate) => candidate.factor === 1));
});
