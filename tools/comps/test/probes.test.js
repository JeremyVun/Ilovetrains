/* Every probe is proven to BITE. Each fixture is one page rendered twice: once
 * clean, once with a single planted defect, so a probe that reports nothing on
 * both is a probe that is not looking.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const chrome = require('../chrome.js');
const probes = require('../probes.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const CONFIG = probes.withDefaults();

let page;
let close;

test.before(async () => { ({ page, close } = await chrome.open()); });
test.after(() => close());

async function probe(fixture, { defect = false, width = 390, height = 844 } = {}) {
  await chrome.frame(page, {
    url: 'file://' + path.join(FIXTURES, fixture) + (defect ? '?defect' : ''),
    width, height, dsf: 1, settle: 120
  });
  return chrome.evaluate(page, probes.source(CONFIG));
}

test('right-edge overflow and below-fold are reported against the viewport', async () => {
  const clean = await probe('overflow.html');
  assert.strictEqual(clean.overflow, null);
  assert.strictEqual(clean.belowFold, null);

  const bad = await probe('overflow.html', { defect: true });
  assert.ok(bad.overflow && bad.overflow.px > 60, JSON.stringify(bad.overflow));
  assert.ok(bad.belowFold && bad.belowFold.px > 300, JSON.stringify(bad.belowFold));
});

test('tap targets under the product minimum are reported', async () => {
  const clean = await probe('tap.html');
  assert.deepStrictEqual(clean.taps, []);

  const bad = await probe('tap.html', { defect: true });
  assert.strictEqual(bad.taps.length, 3);
  assert.ok(bad.taps.some((t) => t.endsWith(':38')), bad.taps.join(' '));
  assert.ok(bad.taps.some((t) => t.endsWith(':30')), bad.taps.join(' '));
});

test('whole items and scroll position are measured against the scroller', async () => {
  const clean = await probe('scroller.html');
  assert.strictEqual(clean.scroller.whole, 3, 'past items are not counted');
  assert.strictEqual(clean.scroller.top, 200);
  assert.strictEqual(clean.scroller.extent, 300);

  const bad = await probe('scroller.html', { defect: true });
  assert.strictEqual(bad.scroller.whole, 2, 'a shorter scroller loses a whole item');
  assert.strictEqual(bad.scroller.extent, 350);
  assert.strictEqual(bad.overflow, null, 'the loss is invisible to the viewport probes');
  assert.strictEqual(bad.belowFold, null);
});

test('text spill is separated from deliberate ellipsis', async () => {
  const clean = await probe('spill.html');
  assert.deepStrictEqual(clean.spill, []);
  assert.strictEqual(clean.clip.length, 1);

  const bad = await probe('spill.html', { defect: true });
  assert.strictEqual(bad.spill.length, 1, bad.spill.join(' '));
  assert.deepStrictEqual(bad.clip, []);
  assert.strictEqual(bad.overflow, null, 'a fixed track does not move its own right edge');
});

test('a track is stressed with the widest value its vocabulary allows', async () => {
  const clean = await probe('track.html');
  assert.strictEqual(clean.tracks.length, 2);
  assert.deepStrictEqual(clean.tracks.map((t) => t.value), ['78', '999']);
  assert.ok(clean.tracks.every((t) => !t.invades), JSON.stringify(clean.tracks));

  const bad = await probe('track.html', { defect: true });
  const wide = bad.tracks.find((t) => t.value === '999');
  assert.ok(wide.invades, JSON.stringify(bad.tracks));
  assert.strictEqual(bad.overflow, null, 'the invasion is leftwards, so no overflow probe fires');
});

test('the lockup stress measures through the real cascade, never a bare clone', async () => {
  const r = await probe('track-cascade.html');
  const guarded = r.tracks[0];
  const bare = r.tracks[1];
  assert.strictEqual(guarded.value, bare.value);
  assert.ok(guarded.ink < bare.ink, `${guarded.ink} vs ${bare.ink}`);
  assert.strictEqual(guarded.invades, false);
  assert.strictEqual(bare.invades, true);
});

test('the time axis is checked against the arithmetic it claims to obey', async () => {
  const clean = await probe('axis.html');
  const a = clean.axes[0];
  assert.deepStrictEqual(a.mins, [27, 7, 10]);
  assert.ok(a.dev.every((d) => d <= 0.1), JSON.stringify(a));
  assert.strictEqual(a.offScale, false);
  assert.ok(Math.abs(a.tailRight - a.want[0]) <= 0.1, JSON.stringify(a));
  assert.ok(Math.abs(a.headLeft - (a.want[0] + a.want[1])) <= 0.1, JSON.stringify(a));
  assert.strictEqual(a.clamped, 0);

  const bad = await probe('axis.html', { defect: true });
  const b = bad.axes[0];
  assert.strictEqual(b.offScale, true, JSON.stringify(b));
  assert.ok(Math.max(...b.dev) > 20, JSON.stringify(b));
  assert.strictEqual(bad.overflow, null, 'absolutely positioned marks are invisible to the overflow probes');
});

test('a page with no viewport meta is refused rather than laid out at 980px', async () => {
  await assert.rejects(
    () => chrome.frame(page, { url: 'file://' + path.join(FIXTURES, 'noviewport.html'), width: 390, height: 844, dsf: 1, settle: 60 }),
    /VIEWPORT LIE: asked 390, got 980/
  );
});
