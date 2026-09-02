/* A count says a comp differs; the round has to name WHICH thing differs, and
 * has to be able to magnify the exemplar it is being judged against. Both are
 * proven to bite: the bands are asserted against a planted defect at a known
 * y, and the clip is asserted to be a real magnification of a known pixel.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const chrome = require('../chrome.js');
const { diff } = require('../diff.js');
const { shootClip } = require('../zoom.js');

const BAND_TOP = 100;
const BAND_HEIGHT = 20;
const page = (mark) => 'data:text/html,' + encodeURIComponent(
  '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<body style="margin:0;background:#000">'
  + (mark ? `<div style="position:absolute;left:40px;top:${BAND_TOP}px;`
    + `width:60px;height:${BAND_HEIGHT}px;background:#fff"></div>` : '')
  + '</body>');

let dir;

test.before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-comps-diff-')); });
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function shoot(name, mark) {
  const file = path.join(dir, name);
  await chrome.withPage(async (p) => {
    await chrome.frame(p, { url: page(mark), width: 200, height: 200, dsf: 2, settle: 60 });
    fs.writeFileSync(file, await chrome.screenshot(p));
  });
  return file;
}

test('the diff names the band a difference is in, not only how many pixels', async () => {
  const clean = await shoot('clean.png', false);
  const marked = await shoot('marked.png', true);

  const same = await diff(clean, clean);
  assert.strictEqual(same[0].differs, 0);
  assert.deepStrictEqual(same[0].rows, [], 'an identical pair reports no rows');

  const [r] = await diff(clean, marked);
  assert.strictEqual(r.differs, 60 * BAND_HEIGHT * 4, 'the planted rectangle, in device px');
  assert.ok(r.rows.length, 'a differing pair carries its rows');

  const top = Math.min(...r.rows.map((row) => row.y)) / 2;
  const bottom = Math.max(...r.rows.map((row) => row.y)) / 2;
  const left = Math.min(...r.rows.map((row) => row.x0)) / 2;
  assert.ok(Math.abs(top - BAND_TOP) <= 1, `band starts at ${top}, planted at ${BAND_TOP}`);
  assert.ok(Math.abs(bottom - (BAND_TOP + BAND_HEIGHT)) <= 1, `band ends at ${bottom}`);
  assert.ok(Math.abs(left - 40) <= 1, `band starts at x ${left}, planted at 40`);
});

test('a clip can be taken from an exemplar PNG, magnified rather than resampled', async () => {
  const marked = await shoot('src.png', true);
  const workshop = { dir };
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });

  const done = await chrome.withPage((p) => shootClip(p, workshop, {
    from: marked, x: 40, y: BAND_TOP, w: 10, h: 10, scale: 4, out: 'probe'
  }));
  const clip = path.join(dir, 'shots', done.name);
  assert.ok(fs.existsSync(clip), 'the clip is written');

  // 10 CSS px of a dsf-2 PNG at 4x is 40 device px square, and every one of
  // them is inside the planted white rectangle.
  const white = await shoot('white.png', true);
  const whiteClip = await chrome.withPage((p) => shootClip(p, workshop, {
    from: white, x: 40, y: BAND_TOP, w: 10, h: 10, scale: 4, out: 'twin'
  }));
  const [r] = await diff(clip, path.join(dir, 'shots', whiteClip.name));
  assert.strictEqual(r.differs, 0, 'the same clip of the same content is identical');
  assert.deepStrictEqual(r.size, [40, 40], 'scale 4 on a dsf-2 source is a 2x magnification');
});
