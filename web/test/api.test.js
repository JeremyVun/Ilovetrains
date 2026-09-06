import test from 'node:test';
import assert from 'node:assert/strict';
import { getDepartures } from '../js/api.js';

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
