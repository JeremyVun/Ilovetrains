/* The experience bar, measured (docs/backlog/v1-core-loop/DESIGN.md):
 *
 *   warm open → the predicted board is on screen  < 500ms  (from cache)
 *   live data replaces it                          < 2s     (working network)
 *
 *   node tools/measure-open.js [--url http://localhost:8092/#/board] [--shots DIR]
 *
 * Both numbers come from the page's own Performance API on a real navigation,
 * not from a stopwatch around the harness:
 *
 *   cached paint = first-contentful-paint. The client renders the cached board
 *                  synchronously while main.js evaluates, so the first pixels
 *                  ARE the board — the run asserts rows were present, which is
 *                  what makes FCP mean what it says here.
 *   live data    = responseEnd of the /api/v1/departures resource entry, i.e.
 *                  the last byte of the live answer, after which the client
 *                  re-renders synchronously.
 *
 * Run 1 is a cold open into an empty profile: it also installs the service
 * worker. Run 2 reuses that profile (screenshot.js --profile), so it is a real
 * warm open, served by the worker — the number the bar is about.
 *
 * The seeded cache is written relative to the wall clock, not to the fixture's
 * 22:45, or every seeded service would already have departed and the "board"
 * whose paint is being timed would be an empty state.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TRIP = {
  id: 'trip-central-parramatta',
  from: { id: '200060', name: 'Central Station' },
  to: { id: '215020', name: 'Parramatta Station' },
  createdAt: new Date(Date.now() - 30 * 86400000).toISOString()
};

function iso(ms) { return new Date(ms).toISOString(); }

function liveSeed(now) {
  const journeys = [3, 18, 27, 33, 48, 63].map((mins, i) => ({
    departure: {
      scheduled: iso(now + mins * 60000),
      estimated: i < 4 ? iso(now + mins * 60000) : null,
      platform: 'Platform ' + [12, 8, 7, 13, 13, 12][i]
    },
    arrival: {
      scheduled: iso(now + (mins + 29) * 60000),
      estimated: i < 4 ? iso(now + (mins + 29) * 60000) : null
    },
    line: { name: i === 2 ? 'BMT' : 'T1', mode: 'train' },
    destinationHeadsign: i === 2 ? 'Mount Victoria via Parramatta' : 'Penrith via Parramatta',
    stopsAway: null,
    cancelled: false,
    legs: 1
  }));

  return {
    schemaVersion: 1,
    trips: [TRIP],
    history: [1, 2, 3].map((d) => ({
      tripId: TRIP.id, direction: 'forward', t: iso(now - d * 86400000)
    })),
    lastViewed: { tripId: TRIP.id, direction: 'forward' },
    cache: {
      '200060-215020': {
        fetchedAt: iso(now),
        body: {
          from: TRIP.from, to: TRIP.to, generatedAt: iso(now), journeys
        }
      }
    }
  };
}

/* Reported from inside the page. Waits for the live answer rather than
   sampling too early and reporting a zero. */
const TIMING_EVAL = `(async () => {
  const deadline = Date.now() + 5000;
  const apiEntry = () => performance.getEntriesByType('resource')
    .find((r) => r.name.includes('/api/v1/departures') && r.responseEnd > 0);
  while (!apiEntry() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));

  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const api = apiEntry();
  console.warn('TIMING ' + JSON.stringify({
    serviceWorker: navigator.serviceWorker.controller ? 'controlling' : 'none',
    fcpMs: fcp ? Math.round(fcp.startTime) : null,
    domInteractiveMs: Math.round(nav.domInteractive || 0),
    apiResponseEndMs: api ? Math.round(api.responseEnd) : null,
    apiFromServiceWorker: api ? Boolean(api.workerStart) : null,
    rowsOnScreen: document.querySelectorAll('[data-t="row"]').length,
    figures: [...document.querySelectorAll('[data-t="figure"]')].map((e) => e.firstChild && e.firstChild.nodeValue).slice(0, 3)
  }));
})()`;

function shoot(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'tools/screenshot.js'), ...args], {
      env: { ...process.env, TZ: 'Australia/Sydney' }
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(out || 'screenshot failed'))));
  });
}

function parseTiming(output) {
  const line = output.split('\n').find((l) => l.includes('TIMING '));
  if (!line) throw new Error('no TIMING line in:\n' + output);
  return JSON.parse(line.slice(line.indexOf('TIMING ') + 7));
}

async function main() {
  const argv = process.argv.slice(2);
  // Home is a smart directions view in board v2. This harness measures the
  // board's cached rows, so its default must name the board route explicitly.
  let url = 'http://localhost:8092/#/board';
  let shots = path.join(os.tmpdir(), 'trains-measure');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url') url = argv[++i];
    else if (argv[i] === '--shots') shots = path.resolve(argv[++i]);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-open-'));
  const seedFile = path.join(work, 'seed.json');
  const profile = path.join(work, 'profile');
  fs.writeFileSync(seedFile, JSON.stringify(liveSeed(Date.now())));

  try {
    const common = ['--size', '390x844', '--dsf', '2', '--wait', '400', '--seed', seedFile,
      '--profile', profile, '--eval', TIMING_EVAL];

    const cold = parseTiming(await shoot([url, path.join(shots, 'open-cold.png'), ...common]));
    // Same profile, so the worker installed by the cold run is now in charge.
    fs.writeFileSync(seedFile, JSON.stringify(liveSeed(Date.now())));
    const warm = parseTiming(await shoot([url, path.join(shots, 'open-warm.png'), ...common]));

    for (const [name, t] of [['cold', cold], ['warm', warm]]) {
      console.log(name.padEnd(5),
        'sw=' + t.serviceWorker.padEnd(11),
        'cached paint(FCP)=' + String(t.fcpMs) + 'ms',
        ' live data=' + String(t.apiResponseEndMs) + 'ms',
        ' rows=' + t.rowsOnScreen,
        ' figures=' + JSON.stringify(t.figures));
    }
    const bar = [];
    if (!(warm.fcpMs < 500)) bar.push(`cached paint ${warm.fcpMs}ms >= 500ms`);
    if (!(warm.apiResponseEndMs < 2000)) bar.push(`live data ${warm.apiResponseEndMs}ms >= 2000ms`);
    if (!warm.rowsOnScreen) bar.push('the warm open painted no rows');
    if (warm.serviceWorker !== 'controlling') bar.push('the warm open was not served by the service worker');
    if (bar.length) {
      console.error('EXPERIENCE BAR NOT MET: ' + bar.join('; '));
      process.exitCode = 1;
    } else {
      console.log('experience bar met (warm open, docs/backlog/v1-core-loop/DESIGN.md)');
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
