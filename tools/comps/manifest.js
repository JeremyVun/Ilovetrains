/* comps.json: the round's job list, read once and expanded into shots. The
 * schema is documented in tools/comps/README.md.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FRAMES = {
  phone: { w: 390, h: 844, note: 'the standard frame' },
  short: { w: 412, h: 732, note: "a 412px Android with its browser chrome on screen — the owner's phone" },
  narrow: { w: 360, h: 780, note: 'the narrowest frame worth surviving' }
};

function read(workshop) {
  const file = path.join(workshop, 'comps.json');
  if (!fs.existsSync(file)) throw new Error(`no comps.json in ${workshop}`);
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.dir = workshop;
  m.frames = m.frames || DEFAULT_FRAMES;
  m.settle = m.settle || 260;
  m.dsf = m.dsf || 2;
  return m;
}

function frameOf(manifest, name) {
  const f = manifest.frames[name];
  if (!f) throw new Error(`unknown frame "${name}" (have ${Object.keys(manifest.frames).join(', ')})`);
  return { name, w: f.w, h: f.h, tag: f.w + 'x' + f.h };
}

function shotName(concept, frame, scenario, scheme) {
  return [concept, frame.tag, scenario, scheme === 'dark' ? '' : scheme].filter(Boolean).join('-');
}

function jobs(manifest) {
  const declared = manifest.jobs && manifest.jobs.length
    ? manifest.jobs
    : [{ concepts: manifest.concepts, scenarios: manifest.scenarios, frames: ['phone'] }];

  const out = [];
  const seen = new Set();
  for (const job of declared) {
    const concepts = job.concepts || [job.concept];
    const scenarios = job.scenarios || [job.scenario];
    const frames = job.frames || [job.frame || 'phone'];
    const schemes = job.schemes || [job.scheme || 'dark'];
    for (const concept of concepts) {
      for (const scenario of scenarios) {
        for (const frameName of frames) {
          for (const scheme of schemes) {
            const frame = frameOf(manifest, frameName);
            const name = shotName(concept, frame, scenario, scheme);
            if (seen.has(name)) continue;
            seen.add(name);
            out.push({ name, concept, scenario, frame, scheme });
          }
        }
      }
    }
  }
  return out;
}

module.exports = { read, jobs, frameOf, shotName, DEFAULT_FRAMES };
