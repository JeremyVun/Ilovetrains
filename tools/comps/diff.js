/* Pixel diff with no dependencies: both PNGs are decoded by the browser that
 * drew them and compared through getImageData, so the comparison uses the same
 * decoder as the capture. Per-platform regression against a golden, and the
 * acceptance oracle for this harness.
 *
 * Usage
 *   node tools/comps/diff.js <a.png> <b.png> [--threshold N]
 *   node tools/comps/diff.js <dirA> <dirB> [--threshold N]   every shared name
 *
 * Exit code is non-zero when any pair differs beyond the threshold (default 0:
 * pixel-identical).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const chrome = require('./chrome.js');

const COMPARE = `(async (a, b) => {
  const load = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode ' + src.slice(0, 40)));
    img.src = src;
  });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  if (ia.width !== ib.width || ia.height !== ib.height) {
    return { differs: ia.width * ia.height, total: 0, size: [ia.width, ia.height, ib.width, ib.height], sizeMismatch: true };
  }
  const pixels = (img) => {
    const c = new OffscreenCanvas(img.width, img.height);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    return x.getImageData(0, 0, img.width, img.height).data;
  };
  const pa = pixels(ia), pb = pixels(ib);
  let differs = 0, worst = 0;
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i+1] - pb[i+1]),
                       Math.abs(pa[i+2] - pb[i+2]), Math.abs(pa[i+3] - pb[i+3]));
    if (d) { differs++; if (d > worst) worst = d; }
  }
  return { differs, total: pa.length / 4, worst, size: [ia.width, ia.height], sizeMismatch: false };
})`;

const dataUrl = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

async function compare(page, a, b) {
  return chrome.evaluate(page, `${COMPARE}(${JSON.stringify(dataUrl(a))}, ${JSON.stringify(dataUrl(b))})`);
}

/** Compare two files, or every PNG name the two directories share. */
async function diff(a, b) {
  const pairs = fs.statSync(a).isDirectory()
    ? fs.readdirSync(a).filter((f) => f.endsWith('.png') && fs.existsSync(path.join(b, f)))
        .sort().map((f) => ({ name: f, a: path.join(a, f), b: path.join(b, f) }))
    : [{ name: path.basename(a), a, b }];
  if (!pairs.length) throw new Error(`no PNG names shared between ${a} and ${b}`);

  return chrome.withPage(async (page) => {
    await chrome.frame(page, { url: 'about:blank', width: 390, height: 844, dsf: 1, settle: 40 })
      .catch(() => { /* about:blank ships no viewport meta; the diff never lays out */ });
    const results = [];
    for (const pair of pairs) results.push({ name: pair.name, ...await compare(page, pair.a, pair.b) });
    return results;
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const t = argv.indexOf('--threshold');
  const threshold = t >= 0 ? Number(argv[t + 1]) : 0;
  const [a, b] = argv.filter((x, i) => !x.startsWith('--') && (t < 0 || i !== t + 1));
  if (!a || !b) throw new Error('usage: diff.js <a.png|dirA> <b.png|dirB> [--threshold N]');

  const results = await diff(path.resolve(a), path.resolve(b));
  let bad = 0;
  for (const r of results) {
    const over = r.differs > threshold;
    if (over) bad++;
    const detail = r.sizeMismatch
      ? `SIZE ${r.size.slice(0, 2).join('x')} vs ${r.size.slice(2).join('x')}`
      : `${r.differs} / ${r.total} px differ` + (r.differs ? `, worst channel ${r.worst}` : '');
    console.log(`${over ? 'DIFF' : 'same'}  ${r.name}  ${detail}`);
  }
  console.log(`\n${results.length - bad}/${results.length} identical within ${threshold}`);
  if (bad) process.exit(1);
}

if (require.main === module) main().catch((e) => { console.error(e.message || e); process.exit(1); });

module.exports = { diff, compare };
