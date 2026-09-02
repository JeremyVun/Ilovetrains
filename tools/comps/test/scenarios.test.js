/* The catalogue's oracle: the tables it derives from tools/fixtures/ must be
 * the tables the board v2 workshop hand-maintained, which are the ones the
 * locked exemplars in assets/comps/latest/ were rendered from. The archive is
 * read out of git so the test needs nothing on disk but the repository.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const scenarios = require('../scenarios.js');
const sheet = require('../sheet.js');

const REPO = path.join(__dirname, '..', '..', '..');
const ARCHIVE = '91aadd9:docs/backlog/board-v2/comps-final/';

function archived(file) {
  return evaluate(execFileSync('git', ['show', ARCHIVE + file], { cwd: REPO, encoding: 'utf8' }));
}

/* Each script gets its own context, so its objects carry that context's Object
   prototype and deepStrictEqual would reject them on identity alone. */
function evaluate(source) {
  const sandbox = {};
  vm.runInNewContext(source, sandbox, { filename: 'comps-data.js' });
  return JSON.parse(JSON.stringify(sandbox, (k, v) => (typeof v === 'function' ? undefined : v)));
}

test('board tables are derived, not typed', () => {
  const want = archived('data.js');
  const got = evaluate(scenarios.renderBoardData());

  assert.deepStrictEqual(got.RHODES, want.RHODES);
  assert.deepStrictEqual(got.CENTRAL, want.CENTRAL);
  assert.deepStrictEqual(got.TRIPS, want.TRIPS);
  assert.deepStrictEqual(got.SCENARIOS, want.SCENARIOS);
});

test('home tables are derived, not typed', () => {
  const want = archived('hdata.js');
  const got = evaluate(scenarios.renderHomeData());

  for (const name of ['OUT', 'TIGHT', 'WIDE', 'CXL', 'BACK', 'TRIPS', 'TRIPS_MANY', 'RECENT', 'MATCHES']) {
    assert.deepStrictEqual(got[name], want[name], name);
  }
  assert.deepStrictEqual(got.SCENARIOS, want.SCENARIOS);
});

test('the On Demand class is excluded before a client ever sees it', () => {
  assert.strictEqual(scenarios.EXCLUDED_PRODUCT_CLASS, 10);
  assert.strictEqual(scenarios.plannedJourneys('trip_rhodes_bondijunction').length, 6);
  assert.strictEqual(scenarios.RHODES.services.length, 6);
});

test('minute arithmetic floors both sides to the clock minute', () => {
  assert.strictEqual(scenarios.span('09:24', '09:51'), 27);
  assert.strictEqual(scenarios.span('23:48', '00:17'), 29);
  assert.strictEqual(scenarios.shift('09:24', 540), '18:24');
});

test('every applied delta is declared in the generated head', () => {
  const board = scenarios.renderBoardData();
  for (const d of scenarios.DELTAS) assert.match(board, new RegExp('`' + d.id + '`'));
  const home = scenarios.renderHomeData();
  for (const d of scenarios.HOME_DELTAS) assert.match(home, new RegExp('`' + d.id + '`'));
});

test('the sheet lede prints the declaration, not the comment it lives in', () => {
  const wrapped = scenarios.DELTAS.concat(scenarios.HOME_DELTAS)
    .filter((d) => d.text.includes('\n'));
  assert.ok(wrapped.length, 'a declaration wraps, or this test proves nothing');

  const lede = sheet.deltaLede();
  assert.doesNotMatch(lede, /\*/, 'no continuation marker reaches the sheet');
  assert.doesNotMatch(lede, /\s{2,}/, 'no run of whitespace survives');
  for (const d of scenarios.DELTAS) assert.ok(lede.includes(d.id), d.id + ' is named');
});
