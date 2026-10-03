#!/usr/bin/env node

/*
 * Usage: node tools/check-commute-reliability.js [--out DIR] [--only past,arrival,reopen,start,boarding,snapshot,onboard]
 *
 * Builds the TfNSW stub and the server into a temporary directory, boots both
 * on free loopback ports with no API key (fixtures only), and drives this
 * checkout's web client in headless Chrome through trip mode: the board's
 * first past page, a guarded trip settling by estimate, the ten-minute new
 * open, running-row starts and Stop trip, Home left open through boarding, the open snapshot retired by a platform sighting after its
 * train left, and on-board entry. Screens land in --out.
 *
 * The clock, location permission, geolocation provider and page visibility are
 * page-side adapters installed before the app loads. Departures go to the real
 * server and stub with two corrections the verbatim stub cannot make: an `at`
 * in the fixture era is moved inside the server's 24-hour window, and each
 * answer keeps only the journeys departing at or after the requested time (now
 * when none), as the live planner does.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { withPage, screenshot, sleep } = require('./comps/chrome.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : fallback;
};
const outDir = path.resolve(option('--out', path.join(os.tmpdir(), 'ilovetrains-commute-reliability')));
const CASES = ['past', 'arrival', 'reopen', 'start', 'boarding', 'snapshot', 'onboard'];
const only = option('--only', CASES.join(',')).split(',');
for (const name of only) if (!CASES.includes(name)) throw new Error(`--only takes ${CASES.join(',')}`);

/* The Central → Parramatta capture (tools/fixtures/trip_central_parramatta.json)
   runs 22:48, 23:03, 23:12 (BMT), 23:18, 23:33 and 23:48 on 31 August 2026. */
const at = (hhmmss) => Date.parse(`2026-08-31T${hhmmss}+10:00`);
const CENTRAL = { id: '200060', name: 'Central Station', location: { lat: -33.883882, lon: 151.205829 } };
const PARRAMATTA = { id: '215020', name: 'Parramatta Station', location: { lat: -33.817579, lon: 151.005535 } };
const TRIP = { id: 'cp', from: CENTRAL, to: PARRAMATTA, createdAt: '2026-08-01T00:00:00+10:00' };

function documentWith(patch = {}) {
  return {
    schemaVersion: 1, trips: [TRIP], history: [], rides: [], searches: { from: [], to: [] }, homeVotes: [],
    lastOpen: null, lastViewed: null, preferences: { useLocation: true }, cache: {}, ...patch
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function bootStack(work) {
  for (const [target, source] of [['tfnsw-stub', './tools/tfnsw-stub'], ['server', './cmd/server']]) {
    execFileSync('go', ['build', '-o', path.join(work, target), source], { cwd: ROOT, stdio: 'inherit' });
  }
  const stubPort = await freePort();
  const serverPort = await freePort();
  const log = (name) => fs.openSync(path.join(work, `${name}.log`), 'w');
  const stub = spawn(path.join(work, 'tfnsw-stub'), ['--port', String(stubPort), '--fixtures',
    path.join(ROOT, 'tools/fixtures'), '--routes', path.join(ROOT, 'tools/fixtures/stub-routes.json')],
  { cwd: ROOT, stdio: ['ignore', log('stub'), log('stub')] });
  const env = { ...process.env, TFNSW_API_KEY: 'stub', PORT: String(serverPort), WEB_DIR: path.join(ROOT, 'web'),
    TFNSW_BASE_URL: `http://127.0.0.1:${stubPort}`, TFNSW_FEED_BASE_URL: `http://127.0.0.1:${stubPort}`,
    NATIVE_DATA_DIR: path.join(work, 'native-runtime'), NATIVE_BOOTSTRAP_DIR: path.join(ROOT, 'native-data/bootstrap'),
    TIMETABLE_COMPILER: path.join(ROOT, 'tools/compile-timetable.py') };
  for (const key of ['FLAGS_URL', 'ANALYTICS_URL']) delete env[key];
  const server = spawn(path.join(work, 'server'), [], { cwd: ROOT, env, stdio: ['ignore', log('server'), log('server')] });
  const base = `http://localhost:${serverPort}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch (_) { /* not listening yet */ }
    if (server.exitCode !== null) throw new Error(fs.readFileSync(path.join(work, 'server.log'), 'utf8'));
    await sleep(250);
  }
  const listener = execFileSync('lsof', ['-a', '-p', String(server.pid), '-d', 'cwd', '-Fn']).toString();
  if (!listener.includes(`n${ROOT}`)) throw new Error(`port ${serverPort} is not this checkout's server: ${listener}`);
  console.log(`server ${base} (cwd ${ROOT}), stub 127.0.0.1:${stubPort}`);
  return { base, stop: () => { stub.kill('SIGKILL'); server.kill('SIGKILL'); } };
}

function installHarness(config) {
  const NativeDate = Date;
  const h = {
    clock: { now: config.now },
    visibility: { hidden: false },
    permission: { state: 'granted', listeners: new Set() },
    geo: { watches: new Map(), nextId: 1, answer: config.answer || null, current: 0 },
    net: { requests: [], external: [] }
  };
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [h.clock.now])); }
    static now() { return h.clock.now; }
  }
  globalThis.Date = FixedDate;
  if (config.fastRefresh) {
    const nativeSetInterval = globalThis.setInterval.bind(globalThis);
    globalThis.setInterval = (callback, delay, ...args) =>
      nativeSetInterval(callback, delay === 30_000 ? config.fastRefresh : delay, ...args);
  }
  const position = (sample) => ({
    timestamp: sample.at ?? h.clock.now,
    coords: {
      latitude: sample.lat, longitude: sample.lon, accuracy: sample.accuracy ?? 10, altitude: null,
      altitudeAccuracy: null, heading: sample.heading ?? null, speed: sample.speed ?? null
    }
  });
  h.permission.status = {
    get state() { return h.permission.state; },
    onchange: null,
    addEventListener(type, listener) { if (type === 'change') h.permission.listeners.add(listener); },
    removeEventListener(type, listener) { h.permission.listeners.delete(listener); }
  };
  Object.defineProperty(navigator, 'permissions', {
    configurable: true, value: { query: async () => h.permission.status }
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition(success, error) {
        h.geo.current += 1;
        setTimeout(() => (h.geo.answer ? success(position(h.geo.answer)) : error({ code: 2, message: 'none' })), 0);
      },
      watchPosition(success, error) {
        const id = h.geo.nextId++;
        h.geo.watches.set(id, { success, error });
        return id;
      },
      clearWatch(id) { h.geo.watches.delete(id); }
    }
  });
  h.geo.emit = (sample) => { for (const watch of h.geo.watches.values()) watch.success(position(sample)); };
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h.visibility.hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true, get: () => (h.visibility.hidden ? 'hidden' : 'visible')
  });
  h.setHidden = (hidden) => {
    h.visibility.hidden = hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const departs = (journey) => NativeDate.parse(journey.departure?.estimated || journey.departure?.scheduled);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin) {
      h.net.external.push(url.href);
      return new Response('{}', { status: 503 });
    }
    if (url.pathname !== '/api/v1/departures') return nativeFetch(input, init);
    const asked = url.searchParams.get('at');
    h.net.requests.push({ from: url.searchParams.get('from'), to: url.searchParams.get('to'),
      at: asked, limit: url.searchParams.get('limit') });
    const since = asked === null ? h.clock.now : NativeDate.parse(asked);
    if (asked !== null) url.searchParams.set('at', new NativeDate(NativeDate.now()).toISOString());
    const response = await nativeFetch(url.href, { signal: init.signal });
    if (!response.ok) return response;
    const body = await response.json();
    body.journeys = (body.journeys || []).filter((journey) => departs(journey) >= since);
    const headers = { 'Content-Type': 'application/json' };
    if (response.headers.get('X-Data-Stale')) headers['X-Data-Stale'] = response.headers.get('X-Data-Stale');
    return new Response(JSON.stringify(body), { status: 200, headers });
  };
  globalThis.__reliability = h;
}

async function evaluate(page, fn, argument) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${JSON.stringify(argument ?? null)})`, awaitPromise: true, returnByValue: true
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

const PAGE_HELPERS = `
  window.__wait = async (read, message, tries = 200) => {
    for (let i = 0; i < tries; i += 1) {
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(message);
  };
`;

async function open(page, base, { now, doc, hash = '#/', answer = null, fastRefresh = null }) {
  await page.send('Runtime.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${installHarness.toString()})(${JSON.stringify({ now, answer, fastRefresh })});${PAGE_HELPERS}`
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await page.send('Page.navigate', { url: `${base}/__seed__` });
  await sleep(150);
  await evaluate(page, (seed) => {
    localStorage.clear();
    localStorage.setItem('trains.v1', JSON.stringify(seed));
  }, doc);
  await page.send('Page.navigate', { url: `${base}/${hash}` });
  await evaluate(page, () => window.__wait(() => window.__trains?.state?.root, 'the app did not load'));
}

async function shoot(page, name) {
  fs.writeFileSync(path.join(outDir, `${name}.png`), await screenshot(page));
}

async function fixtureJourney(base, departure) {
  const body = await (await fetch(`${base}/api/v1/departures?from=${CENTRAL.id}&to=${PARRAMATTA.id}&limit=6`)).json();
  const journey = body.journeys.find((item) => Date.parse(item.departure.scheduled) === at(departure));
  if (!journey) throw new Error(`the fixture has no ${departure} service`);
  return journey;
}

/* The first past page asks from 30 minutes ago for ten services and the
   board shows the services that left in that half hour above NOW. */
async function checkPast(base) {
  await withPage(async (page) => {
    await open(page, base, { now: at('23:20:00'), doc: documentWith(), hash: '#/board' });
    const result = await evaluate(page, async () => {
      const h = window.__reliability;
      const first = await window.__wait(() => h.net.requests.find((request) => request.at), 'no past page was requested');
      const rows = await window.__wait(() => {
        const past = [...document.querySelectorAll('.sy-row.past .sy-dp')].map((node) => node.textContent);
        return past.length ? past : null;
      }, 'no past rows reached the board');
      const future = [...document.querySelectorAll('.sy-row:not(.past) .sy-dp')].map((node) => node.textContent);
      return { first, rows, future, requests: h.net.requests };
    });
    if (result.first.at !== new Date(at('22:50:00')).toISOString() || result.first.limit !== '10') {
      throw new Error(`first past page asked ${JSON.stringify(result.first)}`);
    }
    for (const time of ['23:03', '23:12', '23:18']) {
      if (!result.rows.includes(time)) throw new Error(`past rows ${result.rows} miss the ${time}`);
    }
    if (result.rows.includes('22:48')) throw new Error('the first page reached past its 30 minutes');
    if (!result.future.includes('23:33')) throw new Error(`future rows ${result.future} miss the 23:33`);
    await shoot(page, 'past-landing');
    await evaluate(page, () => { document.querySelector('[data-t="timeline"]').scrollTop = 0; });
    await sleep(200);
    await shoot(page, 'past-scrolled-up');
    console.log(`PASS past: first page at=${result.first.at} limit=${result.first.limit}; past rows ${result.rows.join(', ')}`);
  });
}

/* A guarded trip ten minutes past its estimate reads Checking arrival for
   the 45 s evidence wait, then settles by estimate with the estimate copy. */
async function checkArrival(base) {
  const journey = await fixtureJourney(base, '22:48:00');
  const doc = documentWith({
    focus: { tripId: TRIP.id, direction: 'forward', focusedAt: '2026-08-31T22:40:00+10:00', by: 'focus', journey,
      arrivalGuard: { armed: true, retainedAt: new Date(at('23:17:00')).toISOString() } }
  });
  await withPage(async (page) => {
    await open(page, base, { now: at('23:27:00'), doc });
    const checking = await evaluate(page, async () => {
      const h = window.__reliability;
      const t = window.__trains;
      await window.__wait(() => h.geo.watches.size, 'arrival monitoring did not start');
      h.geo.emit({ lat: -33.8839, lon: 151.2058, accuracy: 10, speed: 0 });
      await window.__wait(() => document.body.textContent.includes('Checking arrival at Parramatta'), 'no checking copy');
      return { state: t.state.arrivalDecision?.state, text: document.body.textContent, rides: t.state.doc.rides.length };
    });
    if (checking.state !== 'checkingArrival' || checking.rides) throw new Error(`overdue trip read ${JSON.stringify(checking.state)}`);
    await shoot(page, 'arrival-checking');
    const held = await evaluate(page, () => {
      const t = window.__trains;
      window.__reliability.clock.now += 44_000;
      t.tick();
      return t.state.arrivalDecision?.state;
    });
    if (held !== 'checkingArrival') throw new Error(`the evidence wait did not hold at 44 s: ${held}`);
    const settled = await evaluate(page, async () => {
      const t = window.__trains;
      window.__reliability.clock.now += 2_000;
      await window.__wait(() => { t.tick(); return t.state.arrivalDecision?.state === 'arrived'; }, 'the trip never settled');
      await window.__wait(() => document.body.textContent.includes('The last arrival estimate has passed. The return trip is ready.'),
        'no estimate copy');
      return { decision: t.state.arrivalDecision, guard: t.state.doc.focus?.arrivalGuard, rides: t.state.doc.rides.length };
    });
    if (settled.decision.basis !== 'estimate' || settled.guard?.basis !== 'estimate' || settled.rides !== 1) {
      throw new Error(`estimate settlement wrong: ${JSON.stringify(settled)}`);
    }
    await shoot(page, 'arrival-settled');
    console.log('PASS arrival: overdue armed focus: Checking arrival through the 45 s wait, then the estimate copy and one ride');
  });
}

/* Ten minutes in the background is a new open on Home; nine is not. */
async function checkReopen(base) {
  await withPage(async (page) => {
    await open(page, base, { now: at('23:00:00'), doc: documentWith(),
      answer: { lat: CENTRAL.location.lat, lon: CENTRAL.location.lon, accuracy: 10, speed: 0 } });
    const result = await evaluate(page, async () => {
      const h = window.__reliability;
      const t = window.__trains;
      document.querySelector('[data-act="open-trip"]').click();
      await window.__wait(() => t.state.view === 'board', 'the trip row did not open its board');
      h.setHidden(true);
      h.clock.now += 9 * 60_000;
      h.setHidden(false);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const shortReturn = { hash: location.hash, view: t.state.view };
      h.setHidden(true);
      h.clock.now += 10 * 60_000;
      const fixesBefore = h.geo.current;
      h.setHidden(false);
      await window.__wait(() => t.state.view === 'home', 'a ten-minute return did not land on Home');
      await window.__wait(() => h.geo.current > fixesBefore, 'the new open took no fix');
      return { shortReturn, hash: location.hash, view: t.state.view, predicted: t.state.predicted };
    });
    if (result.shortReturn.view !== 'board' || result.shortReturn.hash !== '#/board') {
      throw new Error(`a nine-minute return left the board: ${JSON.stringify(result.shortReturn)}`);
    }
    if (result.hash !== '#/' || !result.predicted) throw new Error(`the new open is not Home's own answer: ${JSON.stringify(result)}`);
    await shoot(page, 'reopen-home');
    console.log('PASS reopen: a 9-minute return kept the board; a 10-minute return landed on Home with a fresh fix');
  });
}

/* A running row starts the trip at once, an upcoming row opens detail, and
   Stop trip declines a started trip silently and a guessed one with
   declined_inferred. */
async function checkStart(base) {
  await withPage(async (page) => {
    await open(page, base, { now: at('23:20:00'), doc: documentWith(), hash: '#/board' });
    const result = await evaluate(page, async () => {
      const t = window.__trains;
      const row = await window.__wait(() => [...document.querySelectorAll('.sy-row')]
        .find((node) => node.querySelector('.sy-dp')?.textContent === '23:18'), 'no 23:18 row');
      row.click();
      await window.__wait(() => t.state.view === 'home' && t.state.doc.focus, 'a running row did not start the trip');
      const started = { by: t.state.doc.focus.by, departure: t.state.doc.focus.journey.departure.scheduled };
      t.analytics.events.length = 0;
      t.stopTrip();
      await window.__wait(() => !t.state.doc.focus, 'Stop trip did not end the trip');
      const stopped = { rides: t.state.doc.rides.length, declined: t.state.doc.inferenceDeclined || null,
        events: t.analytics.events.map((event) => event.t) };
      location.hash = '#/board';
      const upcoming = await window.__wait(() => [...document.querySelectorAll('.sy-row')]
        .find((node) => node.querySelector('.sy-dp')?.textContent === '23:33'), 'no 23:33 row');
      upcoming.click();
      await window.__wait(() => t.state.view === 'detail', 'an upcoming row did not open detail');
      return { started, stopped, focusAfterDetail: Boolean(t.state.doc.focus) };
    });
    if (result.started.by !== 'focus' || Date.parse(result.started.departure) !== at('23:18:00')) {
      throw new Error(`running row started ${JSON.stringify(result.started)}`);
    }
    const declinedDeparture = result.stopped.declined && Date.parse(JSON.parse(result.stopped.declined.departure)[1]);
    if (result.stopped.rides || result.stopped.declined?.tripId !== TRIP.id || result.stopped.declined.direction !== 'forward'
        || declinedDeparture !== at('23:18:00') || result.stopped.events.includes('declined_inferred')) {
      throw new Error(`stopping a started trip did not decline it silently: ${JSON.stringify(result.stopped)}`);
    }
    if (result.focusAfterDetail) throw new Error('opening an upcoming row started a trip');
    await shoot(page, 'start-upcoming-detail');
  });
  const journey = await fixtureJourney(base, '23:18:00');
  await withPage(async (page) => {
    await open(page, base, { now: at('23:25:00'), doc: documentWith({
      focus: { tripId: TRIP.id, direction: 'forward', focusedAt: '2026-08-31T23:21:00+10:00', by: 'inferred', journey } }) });
    const stopped = await evaluate(page, async () => {
      const t = window.__trains;
      await window.__wait(() => t.state.doc.focus, 'the guessed trip did not load');
      t.stopTrip();
      return { declined: t.state.doc.inferenceDeclined, events: t.analytics.events.map((event) => event.t),
        rides: t.state.doc.rides.length };
    });
    if (stopped.declined?.tripId !== TRIP.id || !stopped.events.includes('declined_inferred') || stopped.rides) {
      throw new Error(`stopping a guessed trip did not decline it: ${JSON.stringify(stopped)}`);
    }
    console.log('PASS start: running row started the 23:18; upcoming row opened detail; Stop trip declined a '
      + `started trip silently, and sent declined_inferred and ${JSON.stringify(stopped.declined)} on a guessed one`);
  });
}

/* Home stays open at Central while the 23:03 leaves. A refresh after
   departure, its platform fix now stale, cannot replace the record; the tick
   then takes a fix on the moving train and that held record enters trip mode,
   with no on-board search needed. */
async function checkBoarding(base) {
  await withPage(async (page) => {
    await open(page, base, { now: at('23:00:30'), doc: documentWith(), fastRefresh: 400,
      answer: { lat: CENTRAL.location.lat, lon: CENTRAL.location.lon, accuracy: 10, speed: 0 } });
    const result = await evaluate(page, async () => {
      const h = window.__reliability;
      const t = window.__trains;
      const seen = await window.__wait(() => t.state.doc.lastOpen?.station?.id === '200060' && t.state.doc.lastOpen,
        'no sighted record at Central');
      h.geo.answer = null;
      h.clock.now += 3.5 * 60_000;
      const refreshes = h.net.requests.length;
      await window.__wait(() => h.net.requests.length > refreshes + 1, 'no refresh after departure', 400);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const held = t.state.doc.lastOpen.journey.departure.scheduled;
      const fixesBefore = h.geo.current;
      h.geo.answer = { lat: -33.8772, lon: 151.1855, accuracy: 10, speed: 15, heading: 290 };
      await window.__wait(() => t.state.doc.focus, 'Home left open did not enter trip mode', 400);
      return { seen: seen.journey.departure.scheduled, held, tickFixes: h.geo.current - fixesBefore,
        searched: h.net.requests.filter((request) => request.at && Date.parse(request.at) < h.clock.now
          && request.limit === '10').length,
        focus: { by: t.state.doc.focus.by, departure: t.state.doc.focus.journey.departure.scheduled },
        events: t.analytics.events.map((event) => event.t) };
    });
    if (Date.parse(result.seen) !== at('23:03:00')) throw new Error(`the record named ${result.seen}`);
    if (Date.parse(result.held) !== at('23:03:00')) throw new Error(`a refresh after departure replaced the record with the ${result.held}`);
    if (result.focus.by !== 'inferred' || Date.parse(result.focus.departure) !== at('23:03:00')
        || !result.events.includes('entered_inferred') || !result.tickFixes || result.searched) {
      throw new Error(`boarding with Home open: ${JSON.stringify(result)}`);
    }
    await shoot(page, 'boarding-entered');
    console.log(`PASS boarding: the record held through a refresh after the 23:03 left; ${result.tickFixes} tick fix(es); `
      + 'the held platform record entered it without an on-board search');
  });
}

/* Home opens on Central's platform before the 23:03 and a quick app switch
   snapshots that record. Still on the platform 70 s after the 23:03 left, the
   rider did not board it: the refresh records the next train and retires the
   snapshot, so boarding that train enters it rather than the departed 23:03. */
async function checkSnapshot(base) {
  await withPage(async (page) => {
    await open(page, base, { now: at('23:00:30'), doc: documentWith(), fastRefresh: 400,
      answer: { lat: CENTRAL.location.lat, lon: CENTRAL.location.lon, accuracy: 10, speed: 0 } });
    const result = await evaluate(page, async () => {
      const h = window.__reliability;
      const t = window.__trains;
      const departureOf = (record) => record?.journey?.departure?.scheduled || null;
      const seen = await window.__wait(() => t.state.doc.lastOpen?.station?.id === '200060' && t.state.doc.lastOpen,
        'no sighted record at Central');
      const first = departureOf(seen);
      h.setHidden(true);
      h.clock.now += 20_000;
      h.setHidden(false);
      await new Promise((resolve) => setTimeout(resolve, 600));
      const snapshot = departureOf(t.state.previousOpen);
      h.clock.now = Date.parse(first) + 70_000;
      const held = await window.__wait(() => departureOf(t.state.doc.lastOpen) !== first && t.state.doc.lastOpen,
        'the platform sighting after departure did not replace the record', 400);
      const stored = departureOf(held);
      const snapshotAfter = departureOf(t.state.previousOpen);
      h.clock.now = Date.parse(stored) + 120_000;
      h.geo.answer = { lat: -33.8772, lon: 151.1855, accuracy: 10, speed: 15, heading: 290 };
      await window.__wait(() => t.state.doc.focus, 'no trip mode after boarding the next train', 400);
      return { first, snapshot, stored, heldAt: held.station?.id, snapshotAfter,
        entered: departureOf(t.state.doc.focus), by: t.state.doc.focus.by };
    });
    if (Date.parse(result.first) !== at('23:03:00') || result.snapshot !== result.first) {
      throw new Error(`the return did not snapshot the 23:03 record: ${JSON.stringify(result)}`);
    }
    if (result.heldAt !== CENTRAL.id || result.snapshotAfter !== null) {
      throw new Error(`the sighting after departure did not retire the snapshot: ${JSON.stringify(result)}`);
    }
    if (result.entered !== result.stored || result.by !== 'inferred') {
      throw new Error(`entered the departed ${result.entered}, not the boarded ${result.stored}: ${JSON.stringify(result)}`);
    }
    await shoot(page, 'snapshot-retired-entered');
    console.log(`PASS snapshot: seen at Central 70 s after the 23:03 left, the snapshot retired and boarding entered the ${result.stored}`);
  });
}

/* Opened on a moving train with no record, 10.75 km from Central and
   9.16 km from Parramatta (position progress 0.54), the fix matches the 23:12
   (time progress 0.54) over the 23:03 (0.71) and the 23:18 (0.24). */
async function checkOnBoard(base) {
  await withPage(async (page) => {
    await open(page, base, { now: at('23:25:00'), doc: documentWith(),
      answer: { lat: -33.8481, lon: 151.0977, accuracy: 10, speed: 18, heading: 290 } });
    const result = await evaluate(page, async () => {
      const h = window.__reliability;
      const t = window.__trains;
      await window.__wait(() => t.state.doc.focus, 'on-board entry did not happen', 400);
      return { focus: { by: t.state.doc.focus.by, departure: t.state.doc.focus.journey.departure.scheduled,
        line: t.state.doc.focus.journey.line.name },
      asked: h.net.requests.filter((request) => request.limit === '10' && request.at && Date.parse(request.at) < h.clock.now),
      events: t.analytics.events.map((event) => event.t) };
    });
    if (result.focus.by !== 'inferred' || Date.parse(result.focus.departure) !== at('23:12:00')
        || !result.events.includes('entered_inferred') || result.asked.length !== 1) {
      throw new Error(`on-board entry: ${JSON.stringify(result)}`);
    }
    await shoot(page, 'onboard-entered');
    console.log(`PASS onboard: one request ${JSON.stringify(result.asked[0])}; entered the ${result.focus.line} at 23:12`);
  });
}

fs.mkdirSync(outDir, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ilovetrains-commute-reliability-'));
let stack = null;
try {
  stack = await bootStack(work);
  const checks = { past: checkPast, arrival: checkArrival, reopen: checkReopen, start: checkStart,
    boarding: checkBoarding, snapshot: checkSnapshot, onboard: checkOnBoard };
  for (const name of only) await checks[name](stack.base);
  console.log(`screens in ${outDir}`);
} finally {
  stack?.stop();
  fs.rmSync(work, { recursive: true, force: true });
}
