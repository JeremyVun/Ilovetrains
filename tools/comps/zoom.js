/* The magnifier. Some decisions live in twenty CSS pixels — a transfer numeral
 * at the head of a 29px leg — and a 2x phone shot cannot be judged on them.
 * This renders the same page at the same viewport and captures a CLIP at 4x, so
 * what the owner looks at is the real cascade magnified, never a resampled PNG.
 *
 * Usage
 *   node tools/comps/zoom.js <workshop> <concept> <scenario> <x> <y> <w> <h>
 *          [--out NAME] [--scale 4] [--scheme dark] [--frame phone]
 *
 * The manifest's `zooms` array runs with the matrix; this CLI is for finding
 * the clip in the first place.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const chrome = require('./chrome.js');
const manifest = require('./manifest.js');

async function shootClip(page, m, spec) {
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
  const [workshop, concept, scenario, x, y, w, h] = positional;
  if (!workshop || !concept || !scenario || h === undefined) {
    throw new Error('usage: zoom.js <workshop> <concept> <scenario> <x> <y> <w> <h> [--out NAME] [--scale 4] [--scheme dark] [--frame phone]');
  }
  const m = manifest.read(path.resolve(workshop));
  fs.mkdirSync(path.join(m.dir, 'shots'), { recursive: true });

  const spec = {
    concept, scenario,
    x: Number(x), y: Number(y), w: Number(w), h: Number(h),
    scale: flags.scale ? Number(flags.scale) : 4,
    scheme: flags.scheme, frame: flags.frame, out: flags.out
  };
  const done = await chrome.withPage((page) => shootClip(page, m, spec));
  console.log(path.join(m.dir, 'shots', done.name));
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { shootClip };
