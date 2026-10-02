/* Real-stack probe for commute-reliability rule 3 (lead suspect 1): the open
   snapshot versus a platform sighting after departure.

   Boots the fixture stub and the server, drives the real web client in headless
   Chrome with a controlled clock, visibility and geolocation (the adapters of
   tools/check-commute-reliability.js), and replays: Home opened on Central's
   platform before the 23:03; a quick app switch (the return snapshots the
   stored record); the rider still on the platform 70 s after the 23:03 left
   (the refresh records the next train, replacing the held record as the hold
   rule says); then a tick fix at train speed after boarding that next train.

   Ruling 2: being seen at the platform again means the rider did not board the
   23:03, so trip mode must enter the train the stored record names, not the
   departed one the snapshot still holds. Exit 0 when it does, 1 when the
   departed train is entered, 2 on an infrastructure problem.

     node web/test/review-snapshot-stack-probe.mjs */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { withPage, sleep } = require(path.join(ROOT, 'tools/comps/chrome.js'));

const at = (hhmmss) => Date.parse(`2026-08-31T${hhmmss}+10:00`);
const CENTRAL = { id: '200060', name: 'Central Station', location: { lat: -33.883882, lon: 151.205829 } };
const PARRAMATTA = { id: '215020', name: 'Parramatta Station', location: { lat: -33.817579, lon: 151.005535 } };
const TRIP = { id: 'cp', from: CENTRAL, to: PARRAMATTA, createdAt: '2026-08-01T00:00:00+10:00' };
const DOC = {
  schemaVersion: 1, trips: [TRIP], history: [], rides: [], searches: { from: [], to: [] }, homeVotes: [],
  lastOpen: null, lastViewed: null, preferences: { useLocation: true }, cache: {}
};

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
  return { base, stop: () => { stub.kill('SIGKILL'); server.kill('SIGKILL'); } };
}

/* Page-side adapters: a controlled clock, visibility, permission and geolocation,
   and a departures shim that moves the fixture era inside the server's window. */
function installHarness(config) {
  const NativeDate = Date;
  const h = {
    clock: { now: config.now }, visibility: { hidden: false }, permission: { state: 'granted' },
    geo: { watches: new Map(), nextId: 1, answer: config.answer || null, current: 0 }, net: { requests: [] }
  };
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [h.clock.now])); }
    static now() { return h.clock.now; }
  }
  globalThis.Date = FixedDate;
  const nativeSetInterval = globalThis.setInterval.bind(globalThis);
  globalThis.setInterval = (callback, delay, ...args) =>
    nativeSetInterval(callback, delay === 30_000 ? config.fastRefresh : delay, ...args);
  const position = (sample) => ({
    timestamp: h.clock.now,
    coords: { latitude: sample.lat, longitude: sample.lon, accuracy: sample.accuracy ?? 10, altitude: null,
      altitudeAccuracy: null, heading: sample.heading ?? null, speed: sample.speed ?? null }
  });
  h.permission.status = { get state() { return h.permission.state; }, onchange: null, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => h.permission.status } });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition(success, error) {
        h.geo.current += 1;
        setTimeout(() => (h.geo.answer ? success(position(h.geo.answer)) : error({ code: 2, message: 'none' })), 0);
      },
      watchPosition(success, error) { const id = h.geo.nextId++; h.geo.watches.set(id, { success, error }); return id; },
      clearWatch(id) { h.geo.watches.delete(id); }
    }
  });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h.visibility.hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h.visibility.hidden ? 'hidden' : 'visible') });
  h.setHidden = (hidden) => { h.visibility.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); };
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const departs = (journey) => NativeDate.parse(journey.departure?.estimated || journey.departure?.scheduled);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin) return new Response('{}', { status: 503 });
    if (url.pathname !== '/api/v1/departures') return nativeFetch(input, init);
    const asked = url.searchParams.get('at');
    h.net.requests.push({ from: url.searchParams.get('from'), to: url.searchParams.get('to'), at: asked, limit: url.searchParams.get('limit') });
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
  window.__wait = async (read, message, tries = 200) => {
    for (let i = 0; i < tries; i += 1) {
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(message);
  };
}

async function evaluate(page, fn, argument) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${JSON.stringify(argument ?? null)})`, awaitPromise: true, returnByValue: true
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

async function open(page, base, config) {
  await page.send('Runtime.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installHarness.toString()})(${JSON.stringify(config)});` });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Page.navigate', { url: `${base}/__seed__` });
  await sleep(150);
  await evaluate(page, (seed) => { localStorage.clear(); localStorage.setItem('trains.v1', JSON.stringify(seed)); }, DOC);
  await page.send('Page.navigate', { url: `${base}/#/` });
  await evaluate(page, () => window.__wait(() => window.__trains?.state?.root, 'the app did not load'));
}

async function probe(base) {
  return withPage(async (page) => {
    await open(page, base, { now: at('23:00:30'), fastRefresh: 400,
      answer: { lat: CENTRAL.location.lat, lon: CENTRAL.location.lon, accuracy: 10, speed: 0 } });
    return evaluate(page, async () => {
      const h = window.__reliability;
      const t = window.__trains;
      const departureOf = (record) => record?.journey?.departure?.scheduled || null;
      const seen = await window.__wait(() => t.state.doc.lastOpen?.station?.id === '200060' && t.state.doc.lastOpen, 'no sighted record at Central');
      const first = departureOf(seen);

      // A quick app switch: the return is not a new open, and it snapshots the stored record.
      h.setHidden(true);
      h.clock.now += 20_000;
      h.setHidden(false);
      await new Promise((resolve) => setTimeout(resolve, 600));
      const snapshot = departureOf(t.state.previousOpen);

      // 70 s after the shown train left, the rider is still on the platform: the tick fix is at Central.
      h.clock.now = Date.parse(first) + 70_000;
      const held = await window.__wait(() => departureOf(t.state.doc.lastOpen) !== first && t.state.doc.lastOpen, 'the platform sighting after departure did not replace the record', 400);
      const stored = departureOf(held);
      if (held.station?.id !== '200060') throw new Error(`the replacing record is not sighted at Central: ${JSON.stringify(held.station)}`);
      const snapshotAfter = departureOf(t.state.previousOpen);

      // The rider boards that next train; a tick fix at train speed a few km out.
      h.clock.now = Date.parse(stored) + 120_000;
      h.geo.answer = { lat: -33.8772, lon: 151.1855, accuracy: 10, speed: 15, heading: 290 };
      await window.__wait(() => t.state.doc.focus, 'no trip mode after boarding the next train', 400);
      return { first, snapshot, stored, snapshotAfter, entered: departureOf(t.state.doc.focus), by: t.state.doc.focus.by };
    });
  });
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ilt-review-snapshot-'));
let stack = null;
let code = 2;
try {
  stack = await bootStack(work);
  const result = await probe(stack.base);
  console.log(JSON.stringify(result));
  if (result.entered === result.stored && result.by === 'inferred') {
    console.log(`PASS: entered the ${result.stored} the stored record names`);
    code = 0;
  } else {
    console.log(`FAIL: snapshot ${result.snapshotAfter} entered the departed ${result.entered}; the rider was seen on the platform after it left and boarded the ${result.stored}`);
    code = 1;
  }
} catch (error) {
  console.error(`infrastructure: ${error.message}`);
} finally {
  stack?.stop();
  fs.rmSync(work, { recursive: true, force: true });
}
process.exit(code);
