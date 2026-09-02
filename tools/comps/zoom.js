/* The magnifier. Some decisions live in twenty CSS pixels — a transfer numeral
 * at the head of a 29px leg — and a 2x phone shot cannot be judged on them.
 * This renders the same page at the same viewport and captures a CLIP at 4x, so
 * what the owner looks at is the real cascade magnified, never a resampled PNG.
 *
 * An EXEMPLAR is a PNG, not a page, and a calibration round is decided on the
 * two magnified side by side — so the same clip can be taken from a file with
 * `--from`, nearest-neighbour so it stays a magnification.
 *
 * Usage
 *   node tools/comps/zoom.js <workshop> <concept> <scenario> <x> <y> <w> <h>
 *          [--out NAME] [--scale 4] [--scheme dark] [--frame phone]
 *   node tools/comps/zoom.js <workshop> --from <png> <x> <y> <w> <h>
 *          [--out NAME] [--scale 4] [--srcdsf 2]
 *
 * The manifest's `zooms` array runs with the matrix; this CLI is for finding
 * the clip in the first place.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const chrome = require('./chrome.js');
const manifest = require('./manifest.js');

const CLIP_PNG = `(async (src, x, y, w, h, scale) => {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('could not decode the source PNG'));
    i.src = src;
  });
  const c = new OffscreenCanvas(w * scale, h * scale);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x, y, w, h, 0, 0, w * scale, h * scale);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return { png: btoa(s), w: img.width, h: img.height };
})`;

/** The clip is named in CSS px, as on a page; a shot holds device px. */
async function clipPng(page, spec) {
  const dsf = spec.srcdsf || 2;
  const src = 'data:image/png;base64,' + fs.readFileSync(spec.from).toString('base64');
  const args = [JSON.stringify(src), spec.x * dsf, spec.y * dsf, spec.w * dsf, spec.h * dsf,
    (spec.scale || 4) / dsf].join(', ');
  const out = await chrome.evaluate(page, `${CLIP_PNG}(${args})`);
  return Buffer.from(out.png, 'base64');
}

async function shootClip(page, m, spec) {
  if (spec.from) {
    const png = await clipPng(page, spec);
    const name = 'zoom-' + (spec.out || path.basename(spec.from, '.png')) + '.png';
    fs.writeFileSync(path.join(m.dir, 'shots', name), png);
    return { name, ...spec, scale: spec.scale || 4 };
  }
  const frame = manifest.frameOf(m, spec.frame || 'phone');
  const scheme = spec.scheme || 'dark';
  await chrome.frame(page, {
    url: `file://${path.join(m.dir, spec.concept + '.html')}?s=${spec.scenario}`,
    width: frame.w, height: frame.h, scheme, dsf: 1, settle: m.settle
  });
  const png = await chrome.screenshot(page, {
    x: spec.x, y: spec.y, width: spec.w, height: spec.h, scale: spec.scale || 4
  });
  const name = 'zoom-' + (spec.out || `${spec.concept}-${spec.scenario}`) + '.png';
  fs.writeFileSync(path.join(m.dir, 'shots', name), png);
  return { name, ...spec, scheme, frame: frame.tag };
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  const [workshop, ...rest] = positional;
  const [concept, scenario] = flags.from ? [] : rest;
  const [x, y, w, h] = flags.from ? rest : rest.slice(2);
  if (!workshop || h === undefined || (!flags.from && !scenario)) {
    throw new Error('usage: zoom.js <workshop> <concept> <scenario> <x> <y> <w> <h> [--out NAME] [--scale 4] [--scheme dark] [--frame phone]\n'
      + '   or: zoom.js <workshop> --from <png> <x> <y> <w> <h> [--out NAME] [--scale 4] [--srcdsf 2]');
  }
  const m = manifest.read(path.resolve(workshop));
  fs.mkdirSync(path.join(m.dir, 'shots'), { recursive: true });

  const spec = {
    concept, scenario,
    x: Number(x), y: Number(y), w: Number(w), h: Number(h),
    scale: flags.scale ? Number(flags.scale) : 4,
    scheme: flags.scheme, frame: flags.frame, out: flags.out,
    from: flags.from ? path.resolve(m.dir, flags.from) : undefined,
    srcdsf: flags.srcdsf ? Number(flags.srcdsf) : undefined
  };
  const done = await chrome.withPage((page) => shootClip(page, m, spec));
  console.log(path.join(m.dir, 'shots', done.name));
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { shootClip };
