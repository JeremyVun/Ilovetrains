/* Drive the REAL client into each board state and shoot it.
 *
 *   node tools/shoot-states.js                 # every state, into docs/.../shots
 *   node tools/shoot-states.js stale sparse    # just these
 *   node tools/shoot-states.js --list
 *   node tools/shoot-states.js --url http://localhost:8092 --out /tmp/look
 *   node tools/shoot-states.js --media prefers-color-scheme:light --prefix light-
 *
 * This is not a mock of the app: it loads the app the server serves, seeds
 * localStorage exactly as the client writes it, pins the clock through the
 * page's own `window.__trains` harness, and photographs whatever the client
 * decides to draw. The journey data is imported from web/test/fixture.js, so
 * the shots and the unit tests describe the same six real services.
 *
 * TRAPS this driver exists to defeat:
 *
 * 1. THE LIVE FETCH RACE. main.js fires a real /api/v1/departures on load, and
 *    it can land after the state has been set up — replacing a carefully
 *    seeded board with tonight's actual trains, silently. Every state first
 *    freezes `window.fetch` on a promise that never settles and calls
 *    `__trains.refresh()`, which aborts the in-flight request; only then is
 *    the state written. Nothing can arrive afterwards.
 *
 * 2. THE UNPINNED CLOCK. The app renders once at load with the real clock, so
 *    a seeded board of 22:48 services is all "departed" until the clock is
 *    pinned. States pin `__trains.now` and re-render.
 *
 * 3. LOCAL TIME. Every clock string the board prints is device-local. TZ is
 *    forced to Australia/Sydney here so a shot taken on any machine is the
 *    shot the exemplar is judged against.
 *
 * 4. Whatever tools/screenshot.js documents (viewport lie, silent overflow).
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'docs/backlog/v1-core-loop/shots');
const DEFAULT_URL = 'http://localhost:8092/';

/* The exemplar's moment: 22:45 on Monday 31 August 2026, the clock the
   comps were drawn at (comps/shots/b-editorial-390x844.png). */
const NOW_ISO = '2026-08-31T22:45:00+10:00';
const NOW = Date.parse(NOW_ISO);

const TRIP = {
  id: 'trip-central-parramatta',
  from: { id: '200060', name: 'Central Station' },
  to: { id: '215020', name: 'Parramatta Station' },
  createdAt: '2026-08-01T08:00:00+10:00'
};
const TRIP_2 = {
  id: 'trip-town-hall-epping',
  from: { id: '200070', name: 'Town Hall Station' },
  to: { id: '213910', name: 'Epping Station' },
  createdAt: '2026-08-10T08:00:00+10:00'
};

/** History that makes `predict` choose TRIP forward at 22:45 on a weekday. */
function history(tripId = TRIP.id) {
  return [
    { tripId, direction: 'forward', t: '2026-08-28T22:40:00+10:00' },
    { tripId, direction: 'forward', t: '2026-08-27T22:50:00+10:00' },
    { tripId, direction: 'forward', t: '2026-08-26T22:35:00+10:00' }
  ];
}

function doc({ trips = [TRIP], body = null, fetchedAt = NOW_ISO, hist = history() } = {}) {
  const d = {
    schemaVersion: 1,
    trips,
    history: hist,
    lastViewed: trips.length ? { tripId: trips[0].id, direction: 'forward' } : null,
    cache: {}
  };
  if (body) d.cache[trips[0].from.id + '-' + trips[0].to.id] = { fetchedAt, body };
  return d;
}

/* --- the state list ------------------------------------------------------ */

async function states() {
  const fx = await import(pathToFileURL(path.join(ROOT, 'web/test/fixture.js')).href);
  const { departuresBody, baseJourneys, journey, delay, cancel } = fx;

  const board = (name, body, opts = {}) => ({
    name,
    seed: doc({ body, trips: opts.trips || [TRIP] }),
    now: opts.now || NOW,
    body,
    ...opts
  });

  const delayed = baseJourneys();
  delay(delayed[0], 6);
  delay(delayed[3], 3);

  const cancelled = baseJourneys();
  cancel(cancelled[0]);
  cancel(cancelled[3]);

  const scheduled = baseJourneys().map((j) => {
    j.departure.estimated = null;
    j.arrival.estimated = null;
    return j;
  });

  const long = [
    journey('22:48', '23:17', '12', 'BMT', 'Mount Victoria via Parramatta and Katoomba', true),
    journey('23:03', '23:34', '18', 'T1', 'Emu Plains via Parramatta and Penrith', true),
    ...baseJourneys().slice(2)
  ];

  /* The late-night board, which is what Sydney actually shows between the last
     service and the first: waits of three digits, no realtime control on any
     of them. Found live 2026-09-01 at 00:47 — every seeded state until then
     had a one- or two-digit figure. */
  const lateNight = [187, 216, 221, 240, 251, 266].map((mins, i) => ({
    departure: {
      scheduled: new Date(NOW + mins * 60000).toISOString(),
      estimated: null,
      platform: 'Platform ' + [3, 1, 1, 1, 1, 1][i]
    },
    arrival: { scheduled: new Date(NOW + (mins + 31) * 60000).toISOString(), estimated: null },
    line: { name: i === 1 ? 'BMT' : 'T1', mode: 'train' },
    destinationHeadsign: i === 1 ? 'Central' : 'Berowra via Gordon',
    stopsAway: null,
    cancelled: false,
    legs: 1
  }));

  return [
    board('on-time', departuresBody()),
    board('late-night', departuresBody({ journeys: lateNight })),
    board('delayed', departuresBody({ journeys: delayed })),
    board('cancelled', departuresBody({ journeys: cancelled })),
    board('scheduled-only', departuresBody({ journeys: scheduled })),

    // Four hours old: the figures go, the clock times stay, the board dims.
    board('stale', departuresBody({ generatedAt: '2026-08-31T18:45:00+10:00' })),
    // Twenty minutes past its generation: two services have left, so the list
    // closes upward and the four that remain distribute down the frame.
    board('stale-departed', departuresBody(), { now: Date.parse('2026-08-31T23:05:00+10:00') }),

    // Caught mid-dissolve: the 22:48 service has just left, its row is fading
    // and the list is about to close upward (~240ms, docs/STYLES.md).
    board('dissolve', departuresBody(), {
      // No sleep: screenshot.js's own 120ms settle lands the capture around
      // half way through the 240ms fade, which is the only moment it exists.
      after: `t.now = () => ${NOW + 4 * 60000}; t.tick();`
    }),

    // The minute a service leaves in: the figure reads "Now" and holds the row.
    // Its generatedAt moves with the clock, or the board would be stale
    // instead (three minutes past 22:45 is past STALE_MS) and print no figure.
    board('now-leaving', departuresBody({ generatedAt: '2026-08-31T22:48:10+10:00' }),
      { now: Date.parse('2026-08-31T22:48:20+10:00') }),

    board('sparse', departuresBody({ journeys: baseJourneys().slice(0, 3) })),
    board('empty', departuresBody({ journeys: [] })),
    board('long-names', departuresBody({ journeys: long })),

    // Two saved trips: the masthead earns its third word (SWITCH TRIP).
    board('two-trips', departuresBody(), { trips: [TRIP, TRIP_2] }),

    // No cache, no network: the honest nothing-to-show state.
    { name: 'cold-offline', seed: doc({ trips: [TRIP] }), now: NOW, body: null, offline: true },

    { name: 'first-run', seed: doc({ trips: [], hist: [] }), now: NOW, route: '#/setup' },
    {
      name: 'first-run-search',
      seed: doc({ trips: [], hist: [] }),
      now: NOW,
      route: '#/setup',
      type: { role: 'from', text: 'central' }
    },
    { name: 'trips-list', seed: doc({ trips: [TRIP, TRIP_2], body: departuresBody() }), now: NOW, route: '#/trips' },

    { name: 'desktop', seed: doc({ body: departuresBody() }), now: NOW, body: departuresBody(), size: '1280x800', desktop: true },
    {
      name: 'desktop-delayed',
      seed: doc({ body: departuresBody({ journeys: delayed }) }),
      now: NOW,
      body: departuresBody({ journeys: delayed }),
      size: '1280x800',
      desktop: true
    }
  ];
}

/* --- the page script each state runs ------------------------------------- */

const STOPS = {
  stops: [
    { id: '200060', name: 'Central Station', modes: ['train', 'metro'] },
    { id: '2000397', name: 'Central Chalmers Street, Stand C', modes: ['train'] },
    { id: '213891', name: 'Central Coast Line', modes: ['train'] }
  ]
};

function pageScript(state) {
  const body = state.body === undefined ? null : state.body;
  return `(async () => {
  const t = window.__trains;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // TRAP 1: freeze the network and abort whatever main.js already asked for.
  const frozen = () => new Promise(() => {});
  window.fetch = frozen;
  if (t) t.refresh();
  await sleep(40);

  if (t) t.now = () => ${state.now};

  ${state.route ? `if (location.hash !== ${JSON.stringify(state.route)}) { location.hash = ${JSON.stringify(state.route)}; await sleep(60); }` : ''}

  ${state.type ? `
  window.fetch = async () => new Response(${JSON.stringify(JSON.stringify(STOPS))}, { headers: { 'Content-Type': 'application/json' } });
  const input = document.querySelector('[data-role="${state.type ? state.type.role : ''}"]');
  input.focus();
  input.value = ${JSON.stringify(state.type ? state.type.text : '')};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(700);
  ` : ''}

  if (t && t.state.onBoard) {
    t.state.body = ${JSON.stringify(body)};
    t.state.offline = ${state.offline ? 'true' : 'false'};
    t.state.serverStale = false;
    t.rerender();
  }

  ${state.after || ''}

  // Invariants checked on every state, in the browser, at the shot's viewport.
  // They are reported at console.error, which screenshot.js prints under the
  // shot, so a broken invariant cannot hide inside a plausible-looking image.
  try {
    const problems = [];
    for (const row of document.querySelectorAll('[data-t="row"]')) {
      // docs/STYLES.md, binding: three lines per row, in every state.
      const lines = ['.dep', '.meta', '.dest'].map((s) => row.querySelector(s));
      if (lines.some((el) => !el || !el.textContent.trim())) problems.push('row is not three full lines');
      // The figure must fit its column: it has no ellipsis and nothing clips
      // it, so an overlong one is drawn straight through the departure time.
      const mins = row.querySelector('.mins');
      if (mins && mins.scrollWidth > mins.clientWidth) {
        problems.push('figure "' + (mins.firstChild && mins.firstChild.nodeValue) + '" overflows its column: '
          + mins.scrollWidth + ' > ' + mins.clientWidth);
      }
      // Our own copy must never be ellipsised. An upstream headsign may be.
      const note = row.querySelector('.dest.note');
      if (note && note.scrollWidth > note.clientWidth) {
        problems.push('cancelled-lead note truncated: ' + note.scrollWidth + ' > ' + note.clientWidth);
      }
    }
    const ftr = document.querySelector('[data-t="footer"]');
    if (ftr && ftr.scrollWidth > ftr.clientWidth) problems.push('footer truncated');
    if (problems.length) console.error('INVARIANT ' + ${JSON.stringify(state.name)} + ': ' + problems.join('; '));
  } catch (e) { console.error('invariant check failed: ' + e.message); }

  ${state.probe ? `try {
    // Awaited, so a probe that drives the UI can wait for a route change.
    console.warn('PROBE ' + ${JSON.stringify(state.name)} + ' ' + JSON.stringify(await (async () => { ${state.probe} })()));
  } catch (e) { console.error('PROBE failed: ' + e.message); }` : ''}
})()`;
}

/* --- running ------------------------------------------------------------- */

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  let url = DEFAULT_URL;
  let out = DEFAULT_OUT;
  let probe = null;
  let sizeOverride = null;
  let prefix = '';
  const media = [];
  const wanted = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url') url = argv[++i];
    else if (argv[i] === '--out') out = path.resolve(argv[++i]);
    // Measure the state you are looking at, in the same drive that shoots it:
    // --probe "return {w: document.querySelector('.dest').scrollWidth}"
    else if (argv[i] === '--probe') probe = argv[++i];
    // Any state at any viewport: --size 360x800 is the narrow phone the
    // 390px design has to survive.
    else if (argv[i] === '--size') sizeOverride = argv[++i];
    // Passed straight through: --media prefers-reduced-motion:reduce
    else if (argv[i] === '--media') media.push(argv[++i]);
    // A whole sweep shot under an emulated media feature has to land beside the
    // default one without overwriting it: --prefix light- names the set.
    else if (argv[i] === '--prefix') prefix = argv[++i];
    else if (argv[i] === '--list') wanted.push('--list');
    else wanted.push(argv[i]);
  }

  const all = await states();
  if (wanted.includes('--list')) {
    console.log(all.map((s) => s.name).join('\n'));
    return;
  }

  const chosen = wanted.length ? all.filter((s) => wanted.includes(s.name)) : all;
  const missing = wanted.filter((w) => !all.some((s) => s.name === w));
  if (missing.length) throw new Error('unknown state(s): ' + missing.join(', '));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-states-'));
  const env = { ...process.env, TZ: 'Australia/Sydney' };

  try {
    for (const state of chosen) {
      if (probe) state.probe = probe;
      const size = sizeOverride || state.size || '390x844';
      const seedFile = path.join(tmp, state.name + '.json');
      fs.writeFileSync(seedFile, JSON.stringify(state.seed));
      const args = [
        path.join(ROOT, 'tools/screenshot.js'), url,
        path.join(out, `${prefix}${state.name}-${size}.png`),
        '--size', size, '--dsf', '2', '--wait', '600',
        '--seed', seedFile, '--eval', pageScript(state)
      ];
      if (state.desktop) args.push('--desktop');
      for (const feature of media) args.push('--media', feature);
      await run(process.execPath, args, env);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
