#!/usr/bin/env node

/*
 * Usage: node tools/check-controller-lifecycle.js --url http://localhost:8080
 *
 * Drives controller timing in Chromium with synthetic location and journeys.
 * A violated lifecycle contract exits non-zero with `EVAL FAILED` and the
 * specific stale-fix, index, navigation, setup-paint or completion invariant.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const urlAt = argv.indexOf('--url');
const url = urlAt >= 0 ? argv[urlAt + 1] : 'http://localhost:8080';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-controller-'));
const firstPort = Number.parseInt(process.env.CDP_PORT || '9491', 10);

const from = {
  id: '213820', name: 'Rhodes Station',
  location: { lat: -33.830834, lon: 151.087868 }
};
const to = {
  id: '202210', name: 'Bondi Junction Station',
  location: { lat: -33.891819, lon: 151.247455 }
};

function journeyAt(nowMs, arrivalOffsetMs) {
  const departure = new Date(nowMs - 30 * 60_000).toISOString();
  const arrival = new Date(nowMs + arrivalOffsetMs).toISOString();
  return {
    departure: { scheduled: departure, estimated: departure },
    arrival: { scheduled: arrival, estimated: arrival },
    line: { name: 'T9' },
    legDetail: [{
      from: { ...from, platform: '1' }, to: { ...to, platform: '2' },
      departure: { scheduled: departure, estimated: departure },
      arrival: { scheduled: arrival, estimated: arrival },
      line: { name: 'T9' }
    }]
  };
}

function docAt(nowMs, journey, focus = false) {
  const body = { generatedAt: new Date(nowMs).toISOString(), journeys: [journey] };
  const doc = {
    schemaVersion: 1,
    trips: [{ id: 't1', from, to, createdAt: new Date(nowMs - 86_400_000).toISOString() }],
    history: [], rides: [], searches: { from: [], to: [] }, homeVotes: [],
    lastOpen: null, lastViewed: null,
    cache: { [`${from.id}-${to.id}`]: { fetchedAt: body.generatedAt, body } }
  };
  if (focus) {
    doc.focus = {
      tripId: 't1', direction: 'forward', focusedAt: journey.departure.scheduled,
      by: 'inferred', journey
    };
  }
  return doc;
}

function run(name, seed, geo, script, port, startHash = '') {
  const seedPath = path.join(tmp, `${name}.json`);
  const shotPath = path.join(tmp, `${name}.png`);
  fs.writeFileSync(seedPath, JSON.stringify(seed));
  const target = new URL(url);
  target.hash = startHash;
  const args = [
    path.join(ROOT, 'tools/screenshot.js'), target.href, shotPath,
    '--seed', seedPath, '--wait', '400', '--quiet', '--geo', `${geo.lat},${geo.lon}`,
    '--geo-permission', 'granted', '--eval', script
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT, env: { ...process.env, CDP_PORT: String(port), TZ: 'Australia/Sydney' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(output.trim())));
  });
}

const nowMs = Date.now();
const future = journeyAt(nowMs, 40 * 60_000);
const freshDoc = docAt(nowMs, future);
const freshScript = `(async () => {
  const t = window.__trains;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const geo = navigator.geolocation;
  const original = geo.getCurrentPosition.bind(geo);
  let calls = 0;
  Object.defineProperty(geo, 'getCurrentPosition', {
    configurable: true,
    value: (...args) => { calls += 1; return original(...args); }
  });
  t.state.doc = ${JSON.stringify(freshDoc)};
  t.state.selection = null;
  t.state.fix = { lat: ${from.location.lat}, lon: ${from.location.lon}, at: Date.now() - 6 * 60_000 };
  history.replaceState(null, '', '#/');
  t.route();
  await sleep(500);
  if (calls !== 1) throw new Error('a stale fix suppressed the next home-open fix: ' + calls + ' calls');
  if (t.state.doc.homeVotes.length !== 1) throw new Error('the home-open fix did not cast the daily vote');
  calls = 0;
  document.dispatchEvent(new Event('visibilitychange'));
  await sleep(500);
  if (calls !== 1) throw new Error('a recent fix suppressed the visibility-return fix: ' + calls + ' calls');
})()`;

const focusedDoc = docAt(nowMs, future, true);
const indexScript = `(async () => {
  const t = window.__trains;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  t.state.doc = ${JSON.stringify(focusedDoc)};
  t.state.selection = null;
  t.state.fix = null;
  history.replaceState(null, '', '#/');
  t.route();
  await sleep(500);
  t.state.doc.homeVotes = [];
  t.state.stations = null;
  t.state.fix = { lat: ${from.location.lat}, lon: ${from.location.lon}, at: Date.now() };
  t.indexReady([${JSON.stringify(from)}]);
  if (t.state.doc.homeVotes.length !== 1) throw new Error('index arrival skipped the focused header daily vote');
})()`;

const staleCallbackScript = `(async () => {
  const t = window.__trains;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let deliver = null;
  Object.defineProperty(navigator, 'permissions', {
    configurable: true, value: { query: async () => ({ state: 'granted' }) }
  });
  Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
    configurable: true, value: (success) => { deliver = success; }
  });
  t.state.doc = ${JSON.stringify(freshDoc)};
  t.state.selection = null;
  t.state.fix = null;
  history.replaceState(null, '', '#/');
  t.route();
  for (let i = 0; i < 20 && !deliver; i += 1) await sleep(20);
  if (!deliver) throw new Error('the delayed geolocation request never started');
  history.replaceState(null, '', '#/board');
  t.route();
  deliver({
    timestamp: Date.now(),
    coords: { latitude: ${from.location.lat}, longitude: ${from.location.lon}, speed: null }
  });
  await sleep(100);
  if (t.state.fix) throw new Error('a geolocation callback mutated state after navigation');
})()`;

const emptyDoc = {
  schemaVersion: 1, trips: [], history: [], rides: [],
  searches: { from: [], to: [] }, homeVotes: [], lastOpen: null,
  lastViewed: null, cache: {}
};
const setupPaintScript = `(async () => {
  const t = window.__trains;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  Object.defineProperty(navigator, 'permissions', {
    configurable: true, value: { query: async () => ({ state: 'granted' }) }
  });
  Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
    configurable: true,
    value: (success) => setTimeout(() => success({
      timestamp: Date.now(),
      coords: { latitude: ${from.location.lat}, longitude: ${from.location.lon}, speed: null }
    }), 100)
  });
  let firstPaint = null;
  const observer = new MutationObserver(() => {
    const fromInput = document.querySelector('[data-role="from"]');
    if (fromInput && !firstPaint) {
      firstPaint = {
        from: fromInput.value,
        toFocused: document.activeElement === document.querySelector('[data-role="to"]')
      };
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  t.state.doc = ${JSON.stringify(emptyDoc)};
  t.state.selection = null;
  t.state.fix = null;
  history.replaceState(null, '', '#/setup');
  t.route();
  await sleep(600);
  observer.disconnect();
  if (!firstPaint) throw new Error('the first-run sheet never painted');
  if (firstPaint.from !== 'Rhodes' || !firstPaint.toFocused) {
    throw new Error('granted first-run painted before its origin was ready: ' + JSON.stringify(firstPaint));
  }
})()`;

const arriving = journeyAt(nowMs, 4 * 60_000);
const arrivalDoc = docAt(nowMs, arriving, true);
arrivalDoc.lastOpen = {
  at: new Date(nowMs - 35 * 60_000).toISOString(),
  station: { id: from.id, name: from.name },
  tripId: 't1', direction: 'forward', journey: arriving
};
const arrivalScript = `(async () => {
  const t = window.__trains;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  t.state.doc = ${JSON.stringify(arrivalDoc)};
  t.state.selection = null;
  t.state.fix = null;
  history.replaceState(null, '', '#/');
  t.route();
  await sleep(500);
  if (t.state.doc.rides.length !== 1) throw new Error('the destination fix did not persist the completed ride');
  const back = document.querySelector('[data-act="way-back"]');
  if (!back) throw new Error('the destination fix did not show the way-back offer');
  back.click();
  await sleep(80);
  if (t.state.doc.focus) throw new Error('accepting the way back did not clear focus');
  if (t.state.doc.rides.length !== 1) throw new Error('accepting the way back lost the completed ride');
  t.state.selection = null;
  t.state.fix = null;
  const storage = await import('/js/storage.js');
  t.state.doc = storage.parseDoc(localStorage.getItem(storage.STORAGE_KEY));
  t.route();
  await sleep(500);
  if (t.state.doc.focus) throw new Error('the completed journey was inferred again from lastOpen');
  if (t.state.doc.rides.length !== 1) throw new Error('the completed ride did not survive the next open');
})()`;

try {
  await run('fresh-fixes', freshDoc, from.location, freshScript, firstPort);
  await run('deferred-index', focusedDoc, from.location, indexScript, firstPort + 1, '#/board');
  await run('stale-callback', freshDoc, from.location, staleCallbackScript, firstPort + 2, '#/board');
  await run('setup-first-paint', freshDoc, from.location, setupPaintScript, firstPort + 3, '#/board');
  await run('arrival-persistence', arrivalDoc, to.location, arrivalScript, firstPort + 4);
  console.log('controller lifecycle checks passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
