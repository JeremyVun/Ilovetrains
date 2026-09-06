import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTED_MODES, filterBody, journeyAllowed, preferencesOf, setPreferences, tripAllowed, tripsForModes
} from '../js/preferences.js';
import { emptyDoc, parseDoc, serializeDoc } from '../js/storage.js';

const HOME = {
  id: '213820', name: 'Rhodes Station', location: { lat: -33.8308, lon: 151.0879 }
};

test('preferences default to the current behaviour and preserve all-off', () => {
  assert.deepEqual(preferencesOf(emptyDoc()), {
    appearance: 'system', useLocation: true, enabledModes: SUPPORTED_MODES
  });

  const parsed = parseDoc(JSON.stringify({ preferences: {
    appearance: 'dark', useLocation: false, enabledModes: []
  } }));
  assert.deepEqual(preferencesOf(parsed), {
    appearance: 'dark', useLocation: false, enabledModes: []
  });
  assert.deepEqual(parseDoc(serializeDoc(parsed)).preferences, parsed.preferences);
});

test('corrupt preference fields normalize without reviving an intentional all-off choice', () => {
  const parsed = parseDoc(JSON.stringify({ preferences: {
    appearance: 'violet', useLocation: 'no', enabledModes: ['ferry', 'bus', 'train', 'ferry'],
    homeOverride: { id: '213820', name: 'Rhodes Station', location: { lat: 'south', lon: 151.0879 } }
  } }));

  assert.deepEqual(parsed.preferences, {
    appearance: 'system', useLocation: true, enabledModes: ['train', 'ferry']
  });
  assert.deepEqual(preferencesOf({ preferences: { enabledModes: 'train' } }).enabledModes, SUPPORTED_MODES);
});

test('setting preferences is additive and a null home override restores automatic home', () => {
  const initial = setPreferences(emptyDoc(), {
    appearance: 'light', useLocation: false, enabledModes: ['ferry'], homeOverride: HOME
  });
  assert.deepEqual(initial.preferences, {
    appearance: 'light', useLocation: false, enabledModes: ['ferry'], homeOverride: HOME
  });

  const restored = setPreferences(initial, { homeOverride: null });
  assert.deepEqual(restored.preferences, {
    appearance: 'light', useLocation: false, enabledModes: ['ferry']
  });
});

test('journeys require every service leg and filtering leaves the raw response unchanged', () => {
  const trainThenFerry = {
    line: { mode: 'train' },
    legDetail: [{ line: { mode: 'train' } }, { line: { mode: 'ferry' } }]
  };
  const railOnly = { line: { mode: 'train' } };
  const legacyRail = { line: { name: 'T9' } };
  const legacyUnknown = { line: { name: 'old route' } };
  const body = { generatedAt: 'now', journeys: [trainThenFerry, railOnly] };

  assert.equal(journeyAllowed(null, SUPPORTED_MODES), false);
  assert.equal(journeyAllowed({ legDetail: [{ line: { mode: 'train' } }, { line: { mode: 'walk' } }] }, ['train']), true);
  assert.equal(journeyAllowed({ line: { mode: 'walk' } }, ['train']), false);
  assert.equal(journeyAllowed(trainThenFerry, ['train']), false);
  assert.equal(journeyAllowed(trainThenFerry, ['train', 'ferry']), true);
  assert.equal(journeyAllowed(railOnly, []), false);
  assert.equal(journeyAllowed(legacyRail, ['train']), true);
  assert.equal(journeyAllowed(legacyRail, []), false);
  assert.equal(journeyAllowed(legacyUnknown, SUPPORTED_MODES), true);
  assert.equal(journeyAllowed(legacyUnknown, ['train']), false);
  assert.equal(journeyAllowed(legacyUnknown, []), false);

  const filtered = filterBody(body, ['train']);
  assert.notEqual(filtered, body);
  assert.deepEqual(filtered.journeys, [railOnly]);
  assert.deepEqual(body.journeys, [trainThenFerry, railOnly]);
});


test('trip compatibility treats train, metro and ferry endpoints consistently', () => {
  const stops = [
    { id: 'rail', modes: ['train'] }, { id: 'metro', modes: ['metro'] },
    { id: 'wharf', modes: ['ferry'] }, { id: 'mixed', modes: ['train', 'metro'] }
  ];
  for (const mode of SUPPORTED_MODES) {
    for (const stop of stops) {
      const trip = { from: { id: stop.id }, to: { id: stop.id } };
      assert.equal(tripAllowed(trip, [mode], stops), stop.modes.includes(mode));
    }
  }
  assert.equal(tripAllowed({ from: { id: 'rail' }, to: { id: 'metro' } }, ['train'], stops), false);
  assert.equal(tripAllowed({ from: { id: 'mixed' }, to: { id: 'rail' } }, ['train'], stops), true);
  assert.equal(tripAllowed({ from: { id: 'unknown' }, to: { id: 'rail' } }, ['train'], stops), true);
  assert.equal(tripAllowed({ from: { id: 'unknown' }, to: { id: 'unknown' } }, [], stops), false);
});

test('filtering candidates preserves saved trips and restores them on re-enable', async () => {
  const { predict } = await import('../js/predict.js');
  const rail = { id: 'rail', name: 'Rail', modes: ['train'] };
  const metro = { id: 'metro', name: 'Metro', modes: ['metro'] };
  const trips = [{ id: 'm', from: metro, to: metro }, { id: 't', from: rail, to: rail }];
  const doc = { ...emptyDoc(), trips, lastViewed: { tripId: 'm', direction: 'forward' },
    preferences: { enabledModes: ['train'] } };
  const original = structuredClone(doc);
  const visible = tripsForModes(doc, [rail, metro]);
  assert.deepEqual(visible.trips.map((trip) => trip.id), ['t']);
  assert.equal(predict(visible, Date.now()).tripId, 't');
  assert.deepEqual(doc, original);
  assert.deepEqual(tripsForModes(setPreferences(doc, { enabledModes: SUPPORTED_MODES }), [rail, metro]).trips, trips);
});
