import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTED_MODES, effectiveCap, filterBody, flagsOf, journeyAllowed, preferencesOf,
  setFlags, setPreferences, tripAllowed, tripsForModes
} from '../js/preferences.js';
import { emptyDoc, parseDoc, serializeDoc } from '../js/storage.js';

const HOME = {
  id: '213820', name: 'Rhodes Station', location: { lat: -33.8308, lon: 151.0879 }
};

test('preferences default to the current behaviour and preserve all-off', () => {
  assert.deepEqual(preferencesOf(emptyDoc()), {
    appearance: 'system', useLocation: true, enabledModes: SUPPORTED_MODES, transferLimit: 'two'
  });

  const parsed = parseDoc(JSON.stringify({ preferences: {
    appearance: 'dark', useLocation: false, enabledModes: []
  } }));
  assert.deepEqual(preferencesOf(parsed), {
    appearance: 'dark', useLocation: false, enabledModes: [], transferLimit: 'two'
  });
  assert.deepEqual(parseDoc(serializeDoc(parsed)).preferences, parsed.preferences);
});

test('corrupt preference fields normalize without reviving an intentional all-off choice', () => {
  const parsed = parseDoc(JSON.stringify({ preferences: {
    appearance: 'violet', useLocation: 'no', enabledModes: ['ferry', 'bus', 'train', 'ferry'],
    homeOverride: { id: '213820', name: 'Rhodes Station', location: { lat: 'south', lon: 151.0879 } }
  } }));

  assert.deepEqual(parsed.preferences, {
    appearance: 'system', useLocation: true, enabledModes: ['train', 'ferry'], transferLimit: 'two'
  });
  assert.deepEqual(preferencesOf({ preferences: { enabledModes: 'train' } }).enabledModes, SUPPORTED_MODES);
});

test('setting preferences is additive and a null home override restores automatic home', () => {
  const initial = setPreferences(emptyDoc(), {
    appearance: 'light', useLocation: false, enabledModes: ['ferry'], homeOverride: HOME
  });
  assert.deepEqual(initial.preferences, {
    appearance: 'light', useLocation: false, enabledModes: ['ferry'], transferLimit: 'two',
    homeOverride: HOME
  });

  const restored = setPreferences(initial, { homeOverride: null });
  assert.deepEqual(restored.preferences, {
    appearance: 'light', useLocation: false, enabledModes: ['ferry'], transferLimit: 'two'
  });
});

test('the transfer limit reads as up to two changes unless it says otherwise', () => {
  assert.equal(preferencesOf(emptyDoc()).transferLimit, 'two');
  assert.equal(preferencesOf({ preferences: { transferLimit: 'any' } }).transferLimit, 'any');
  assert.equal(preferencesOf({ preferences: { transferLimit: 'two' } }).transferLimit, 'two');
  assert.equal(preferencesOf({ preferences: { transferLimit: 'direct' } }).transferLimit, 'direct');
  assert.equal(preferencesOf({ preferences: { transferLimit: 'none' } }).transferLimit, 'two');
  assert.equal(preferencesOf({ preferences: { transferLimit: 4 } }).transferLimit, 'two');

  const chosen = setPreferences(emptyDoc(), { transferLimit: 'any' });
  assert.equal(preferencesOf(chosen).transferLimit, 'any');
  assert.equal(preferencesOf(setPreferences(chosen, { transferLimit: 'sometimes' })).transferLimit, 'any');
  assert.equal(preferencesOf(setPreferences(chosen, { appearance: 'dark' })).transferLimit, 'any');
});

test('flags are booleans this backend answered, and the cap needs the flag and the choice', () => {
  assert.deepEqual(flagsOf(emptyDoc()), {});
  assert.deepEqual(flagsOf({ flags: 'transferLimit' }), {});
  assert.deepEqual(flagsOf({ flags: ['transferLimit'] }), {});
  assert.deepEqual(flagsOf({ flags: { transferLimit: 'true', other: true } }), { other: true });

  const on = setFlags(emptyDoc(), { transferLimit: true });
  assert.equal(effectiveCap(on), 2);
  assert.equal(effectiveCap(setPreferences(on, { transferLimit: 'direct' })), 0);
  assert.equal(effectiveCap(setPreferences(on, { transferLimit: 'any' })), null);
  assert.equal(effectiveCap(emptyDoc()), null);
  assert.equal(effectiveCap(setFlags(emptyDoc(), { transferLimit: 'yes' })), null);

  const round = parseDoc(serializeDoc(setPreferences(on, { transferLimit: 'any' })));
  assert.deepEqual(round.flags, { transferLimit: true });
  assert.equal(effectiveCap(round), null);
  assert.equal(parseDoc(JSON.stringify({ flags: [1] })).flags, undefined);
});

test('the cap hides a journey with more than two changes wherever modes are applied', () => {
  const leg = { line: { mode: 'train' } };
  const twoChanges = { legs: 3, legDetail: [leg, leg, leg] };
  const threeChanges = { legs: 4, legDetail: [leg, leg, leg, leg] };
  const body = { generatedAt: 'now', journeys: [twoChanges, threeChanges] };

  assert.equal(journeyAllowed(twoChanges, SUPPORTED_MODES, 2), true);
  assert.equal(journeyAllowed(threeChanges, SUPPORTED_MODES, 2), false);
  assert.equal(journeyAllowed(threeChanges, SUPPORTED_MODES, null), true);
  assert.equal(journeyAllowed(threeChanges, SUPPORTED_MODES), true);
  // A body cached before `legs` shipped is still counted by its legs.
  assert.equal(journeyAllowed({ legDetail: [leg, leg, leg, leg] }, SUPPORTED_MODES, 2), false);

  assert.deepEqual(filterBody(body, SUPPORTED_MODES, 2).journeys, [twoChanges]);
  assert.deepEqual(filterBody(body, SUPPORTED_MODES, null).journeys, [twoChanges, threeChanges]);
  assert.deepEqual(filterBody(body, ['ferry'], null).journeys, []);
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
