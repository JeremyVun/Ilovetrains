import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ferryHub } from '../build-stations.js';

const mapping = JSON.parse(readFileSync(new URL('../fixtures/ferry_stop_mapping.json', import.meta.url)));

test('real boarding IDs resolve to canonical Trip Planner hubs', () => {
  assert.equal(ferryHub(mapping, '20951').id, '209573');
  assert.equal(ferryHub(mapping, '21501').id, '2150112');
  assert.equal(ferryHub(mapping, '2000216').id, '200020');
  assert.deepEqual(ferryHub(mapping, '2000216'), ferryHub(mapping, '2000217'));
  assert.equal(ferryHub(mapping, '20951').name, 'Manly Wharf');
});

test('a new or ambiguous boarding stop cannot silently disappear', () => {
  assert.throws(() => ferryHub(mapping, 'unknown'), /No verified ferry hub/);
  const bad = structuredClone(mapping);
  bad.queries['20951'].locations.push(structuredClone(bad.queries['20951'].locations[0]));
  assert.throws(() => ferryHub(bad, '20951'), /No verified ferry hub/);
});

test('invalid coordinates cannot enter the station index', () => {
  const bad = structuredClone(mapping);
  bad.queries['20951'].locations[0].coord = [151.28, -33.8];
  assert.throws(() => ferryHub(bad, '20951'), /Invalid ferry hub/);
});
