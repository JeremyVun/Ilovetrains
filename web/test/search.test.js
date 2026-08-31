/* The station picker is the only screen in the app that waits on the network,
   and every distinct query is a cold 0.5–1.5s call to TfNSW. These tests hold
   the two things that make it bearable — asking less, and saying what is
   happening — because neither is visible in a screenshot of a finished list. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_QUERY, SHORT_QUERY, COPY, queryKey, hintFor, createSearcher
} from '../js/search.js';

/* --- how little we ask --------------------------------------------------- */

test('nothing shorter than three characters is worth an upstream call', () => {
  assert.equal(MIN_QUERY, 3);
});

test('one and two characters ask for another letter instead of searching', () => {
  for (const query of ['c', 'ce']) {
    assert.deepEqual(hintFor({ query, phase: 'idle' }), { text: COPY.keepTyping, warn: false });
  }
});

test('an empty field says nothing at all — it is not a failed search', () => {
  assert.equal(hintFor({ query: '', phase: 'idle' }), null);
  assert.equal(hintFor({ query: '   ', phase: 'idle' }), null);
});

/* --- what we say while it happens ---------------------------------------- */

test('a query in flight says so', () => {
  assert.deepEqual(hintFor({ query: 'cen', phase: 'pending' }), { text: COPY.searching, warn: false });
});

test('results replace the hint entirely', () => {
  assert.equal(hintFor({ query: 'central', phase: 'done', count: 3 }), null);
});

/* docs/references/tfnsw-open-data.md: a short query loses to exact word
   matches on street and bus-stop names, so "parr" comes back empty while
   "parra" finds Parramatta. Saying "No stations match" to that is a lie the
   user's next keystroke disproves. */
test('an empty result on a short query asks for another letter, and does not claim there is no station', () => {
  for (const query of ['par', 'parr']) {
    const hint = hintFor({ query, phase: 'done', count: 0 });
    assert.equal(hint.text, COPY.noMatchYet);
    assert.match(hint.text, /keep typing/i);
    assert.doesNotMatch(hint.text, /no stations match/i);
  }
  assert.equal(SHORT_QUERY, 4);
});

test('an empty result on a longer query is a real answer', () => {
  assert.equal(hintFor({ query: 'parramtta', phase: 'done', count: 0 }).text, COPY.noMatch);
});

test('a failed call is the one hint set in coral', () => {
  const hint = hintFor({ query: 'central', phase: 'error' });
  assert.equal(hint.text, COPY.unavailable);
  assert.equal(hint.warn, true);
});

test('every hint is one short line in the label idiom, with no developer words', () => {
  for (const text of Object.values(COPY)) {
    assert.ok(text.length <= 30, `"${text}" is too long for one letterspaced line`);
    assert.doesNotMatch(text, /error|fetch|request|query|API|null|undefined|cache/i);
  }
});

/* --- how little we ask twice --------------------------------------------- */

function counting(answers = { stops: [{ id: '1', name: 'Central Station' }] }) {
  const calls = [];
  const fetchStops = async (query) => {
    calls.push(query);
    if (answers.throw) throw answers.throw;
    return answers.stops;
  };
  return { calls, fetchStops };
}

test('the same query is only ever asked upstream once', async () => {
  const { calls, fetchStops } = counting();
  const searcher = createSearcher(fetchStops);

  const first = await searcher.search('central');
  const second = await searcher.search('central');

  assert.deepEqual(calls, ['central'], 'the second search must not touch the network');
  assert.deepEqual(second, first);
});

test('backspacing to a query already typed is answered without a call', async () => {
  const { calls, fetchStops } = counting();
  const searcher = createSearcher(fetchStops);

  assert.equal(searcher.peek('central'), undefined, 'nothing is remembered before it is asked');
  await searcher.search('central');
  assert.deepEqual(searcher.peek('central'), [{ id: '1', name: 'Central Station' }]);
  assert.deepEqual(calls, ['central']);
});

test('case and stray spaces are the same query, not another call', async () => {
  const { calls, fetchStops } = counting();
  const searcher = createSearcher(fetchStops);

  await searcher.search('Central');
  await searcher.search('  central  ');
  await searcher.search('CENTRAL');

  assert.deepEqual(calls, ['Central']);
  assert.equal(queryKey('  Central   Station '), 'central station');
});

test('two different queries are two calls', async () => {
  const { calls, fetchStops } = counting();
  const searcher = createSearcher(fetchStops);

  await searcher.search('cen');
  await searcher.search('cent');

  assert.deepEqual(calls, ['cen', 'cent']);
  assert.equal(searcher.size, 2);
});

/* One second of dead network must not poison a station name for the session. */
test('a failed call is not remembered, so the next attempt really tries again', async () => {
  const { calls, fetchStops } = counting({ throw: new Error('network unreachable') });
  const searcher = createSearcher(fetchStops);

  await assert.rejects(() => searcher.search('central'));
  assert.equal(searcher.peek('central'), undefined);
  await assert.rejects(() => searcher.search('central'));
  assert.deepEqual(calls, ['central', 'central']);
});
