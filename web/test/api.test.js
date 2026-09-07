import test from 'node:test';
import assert from 'node:assert/strict';
import { getDepartures, getFlags } from '../js/api.js';

test('departures distinguishes default, subset and explicit all-off requests', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: new URL(url, 'https://example.test'), options });
    return new Response(JSON.stringify({ journeys: [] }), { headers: { 'X-Data-Stale': 'true' } });
  };
  try {
    await getDepartures('a', 'b');
    await getDepartures('a', 'b', { modes: ['train', 'metro'], at: '2026-09-06T12:00:00+10:00' });
    const result = await getDepartures('a', 'b', { modes: [] });
    assert.equal(requests[0].url.searchParams.has('modes'), false);
    assert.equal(requests[1].url.searchParams.get('modes'), 'train,metro');
    assert.equal(requests[1].url.searchParams.get('at'), '2026-09-06T12:00:00+10:00');
    assert.equal(requests[2].url.searchParams.get('modes'), '');
    assert.equal(result.serverStale, true);
  } finally { globalThis.fetch = original; }
});

test('the transfer cap is a request hint the client only sends while capped', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(new URL(url, 'https://example.test'));
    return new Response(JSON.stringify({ journeys: [] }));
  };
  try {
    await getDepartures('a', 'b', { transferLimit: 2 });
    await getDepartures('a', 'b', { transferLimit: undefined });
    await getDepartures('a', 'b');
    assert.equal(requests[0].searchParams.get('transferLimit'), '2');
    assert.equal(requests[1].searchParams.has('transferLimit'), false);
    assert.equal(requests[2].searchParams.has('transferLimit'), false);
  } finally { globalThis.fetch = original; }
});

test('flags are read from the backend and an offline open keeps the stored answer', async () => {
  const original = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(url);
    return new Response(JSON.stringify({ tiny_train: false, transferLimit: true }));
  };
  try {
    assert.deepEqual(await getFlags(), { tiny_train: false, transferLimit: true });
    assert.deepEqual(paths, ['/api/v1/flags'], 'every flag shares the one request');
    globalThis.fetch = async () => new Response(JSON.stringify({}));
    assert.deepEqual(await getFlags(), {});
    globalThis.fetch = async () => { throw new TypeError('failed to fetch'); };
    await assert.rejects(getFlags(), (error) => error.code === 'offline');
    const controller = new AbortController();
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.signal, controller.signal);
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    await assert.rejects(getFlags({ signal: controller.signal }), (error) => error.name === 'AbortError');
  } finally { globalThis.fetch = original; }
});
