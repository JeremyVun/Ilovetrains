/* The matrix shooter: every concept at every frame, scheme and scenario the
 * round's comps.json declares, plus the probe results that make the captions
 * measurements instead of adjectives.
 *
 * Usage
 *   node tools/comps/shoot.js <workshop> [concept] [scenario] [--no-zooms]
 *
 * Output: <workshop>/shots/<concept>-<WxH>-<scenario>[-light].png at
 * deviceScaleFactor 2, and <workshop>/shots/report.json.
 *
 * The traps this instrument exists to defeat are in tools/comps/chrome.js and
 * tools/comps/probes.js, each as one line beside the code that defeats it.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const chrome = require('./chrome.js');
const probes = require('./probes.js');
const manifest = require('./manifest.js');
const { shootClip } = require('./zoom.js');

async function shoot(page, m, job, probeConfig) {
  const url = `file://${path.join(m.dir, job.concept + '.html')}?s=${job.scenario}`;
  await chrome.frame(page, {
    url, width: job.frame.w, height: job.frame.h,
    scheme: job.scheme, dsf: m.dsf, settle: m.settle
  });

  const measured = await chrome.evaluate(page, probes.source(probeConfig));
  const png = await chrome.screenshot(page);
  fs.writeFileSync(path.join(m.dir, 'shots', job.name + '.png'), png);

  console.log('  ' + job.name + '.png   ' + probes.summarise(measured, probeConfig.tapMin));
  return {
    concept: job.concept, scenario: job.scenario,
    frame: job.frame.tag, frameName: job.frame.name, scheme: job.scheme,
    file: 'shots/' + job.name + '.png',
    ...measured
  };
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--no-zooms');
  const withZooms = !process.argv.includes('--no-zooms');
  const [workshop, onlyConcept, onlyScenario] = argv;
  if (!workshop) throw new Error('usage: shoot.js <workshop> [concept] [scenario] [--no-zooms]');

  const m = manifest.read(path.resolve(workshop));
  const out = path.join(m.dir, 'shots');
  fs.mkdirSync(out, { recursive: true });

  const jobs = manifest.jobs(m).filter((j) =>
    (!onlyConcept || j.concept === onlyConcept) && (!onlyScenario || j.scenario === onlyScenario));
  if (!jobs.length) throw new Error('no jobs matched');

  const probeConfig = probes.withDefaults(m.probes);
  const report = {
    round: m.round || path.basename(m.dir),
    shotAt: new Date().toISOString(),
    chrome: chrome.chromeBinary(),
    dsf: m.dsf,
    frames: m.frames,
    shots: {},
    zooms: {}
  };

  await chrome.withPage(async (page) => {
    for (const job of jobs) report.shots[job.name] = await shoot(page, m, job, probeConfig);
    if (withZooms && !onlyConcept) {
      for (const spec of m.zooms || []) {
        const done = await shootClip(page, m, spec);
        report.zooms[done.name.replace(/\.png$/, '')] = done;
        console.log('  ' + done.name + `   ${spec.w}x${spec.h} at ${spec.scale || 4}x`);
      }
    }
  });

  const reportFile = path.join(out, 'report.json');
  const previous = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { shots: {}, zooms: {} };
  report.shots = Object.assign({}, previous.shots, report.shots);
  report.zooms = Object.assign({}, previous.zooms, report.zooms);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');

  console.log(`\n${jobs.length} shots -> ${out}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
