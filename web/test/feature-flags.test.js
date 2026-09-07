import test from 'node:test';
import assert from 'node:assert/strict';
import { tinyTrainPreview, fetchTinyTrain, TINY_TRAIN_KEY } from '../js/feature-flags.js';

function store(value) {
  const values = new Map(value === undefined ? [] : [[TINY_TRAIN_KEY, value]]);
  return { getItem: (key) => values.get(key), setItem: (key, next) => values.set(key, next) };
}

test('production cannot bypass flagsd with query strings or browser storage', () => {
  for (const host of ['ilovetrains.jeremyvun.com', 'localhost.example.com', 'preview.example.com']) {
    const storage = store('1');
    assert.equal(tinyTrainPreview(host, '?tinyTrain=1', storage), null);
    assert.equal(tinyTrainPreview(host, '?tinyTrain=0', storage), null);
    assert.equal(storage.getItem(TINY_TRAIN_KEY), '1');
  }
});

test('local preview links persist enable and disable across ordinary launches', () => {
  const storage = store();
  assert.equal(tinyTrainPreview('localhost', '', storage), null);
  assert.equal(tinyTrainPreview('localhost', '?tinyTrain=1', storage), true);
  assert.equal(tinyTrainPreview('localhost', '', storage), true);
  assert.equal(tinyTrainPreview('localhost', '?tinyTrain=0', storage), false);
  assert.equal(tinyTrainPreview('localhost', '', storage), false);
});

test('invalid preview values defer to the server unless a valid local override exists', () => {
  for (const value of [undefined, '', 'true', 'false', '{}']) {
    assert.equal(tinyTrainPreview('localhost', '?tinyTrain=true', store(value)), null);
  }
  assert.equal(tinyTrainPreview('localhost', '?tinyTrain=false', store('1')), true);
});

test('blocked storage still permits an explicit local preview for this visit', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  for (const storage of [null, blocked]) {
    assert.equal(tinyTrainPreview('localhost', '', storage), null);
    assert.equal(tinyTrainPreview('127.0.0.1', '?tinyTrain=1', storage), true);
    assert.equal(tinyTrainPreview('[::1]', '?tinyTrain=0', storage), false);
  }
});

test('only a successful evaluated boolean true enables the train', async () => {
  for (const body of [null, {}, { 'tiny_train': 'true' }, { 'tiny_train': 1 }, { 'tiny_train': false }]) {
    assert.equal(await fetchTinyTrain(async () => ({ ok: true, json: async () => body })), false);
  }
  const controller = new AbortController();
  assert.equal(await fetchTinyTrain(async (url, options) => {
    assert.equal(url, '/api/v1/flags');
    assert.deepEqual(options, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    return { ok: true, json: async () => ({ 'tiny_train': true }) };
  }, controller.signal), true);
});

test('unavailable, invalid and failed flag responses turn the feature off', async () => {
  assert.equal(await fetchTinyTrain(async () => { throw Error('offline'); }), false);
  assert.equal(await fetchTinyTrain(async () => ({ ok: false, json: async () => ({ 'tiny_train': true }) })), false);
  assert.equal(await fetchTinyTrain(async () => ({ ok: true, json: async () => { throw Error('invalid JSON'); } })), false);
});
