#!/usr/bin/env node

/*
 * Usage:
 *   python3 -m http.server 8198 --bind 127.0.0.1 --directory web
 *   node tools/check-commute-feedback.js --url http://127.0.0.1:8198 \
 *     --out /tmp/ilovetrains-commute-feedback-check
 *
 * The checker installs its clock, API, permission, and geolocation providers
 * before the app loads. It makes no departures, feedback, or analytics request.
 * It captures guarded Home and C1 before/during/after transfer states in both
 * phone sizes and schemes after their DOM and geometry assertions pass.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { withPage, screenshot, sleep } = require('./comps/chrome.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : fallback;
};
const baseURL = new URL(value('--url', 'http://127.0.0.1:8198'));
const outDir = path.resolve(value('--out', '/tmp/ilovetrains-commute-feedback-check'));
const only = value('--only', 'all');
const allowedOnly = new Set(['all', 'arrival', 'recommendation', 'screens', 'c1', 'review']);

if (!['localhost', '127.0.0.1'].includes(baseURL.hostname)) {
  throw new Error('--url must use a private localhost server');
}
if (!allowedOnly.has(only)) throw new Error('--only must be all, arrival, recommendation, screens, c1, or review');

const FIXED_NOW = Date.parse('2026-09-09T00:00:00.000Z');
const MINUTE = 60_000;
const FROM = {
  id: '213820', name: 'Rhodes Station', modes: ['train'],
  location: { lat: -33.830834, lon: 151.087868 }
};
const TO = {
  id: '202210', name: 'Bondi Junction Station', modes: ['train'],
  location: { lat: -33.891819, lon: 151.247455 }
};
const CHANGE = {
  id: '200060', name: 'Central Station', modes: ['train'],
  location: { lat: -33.883882, lon: 151.205829 }
};
const CACHE_KEY = `${FROM.id}-${TO.id}`;

function iso(ms) { return new Date(ms).toISOString(); }

function directJourney(name, departure, arrival, options = {}) {
  const scheduledDeparture = options.scheduledDeparture ?? departure;
  const scheduledArrival = options.scheduledArrival ?? arrival;
  return {
    id: name,
    departure: {
      scheduled: iso(scheduledDeparture), estimated: iso(departure), platform: options.platform || '1'
    },
    arrival: { scheduled: iso(scheduledArrival), estimated: iso(arrival) },
    line: { name, mode: 'train' },
    destinationHeadsign: TO.name,
    legs: 1,
    legDetail: [{
      from: { ...FROM, platform: options.platform || '1' },
      to: { ...TO, platform: options.arrivalPlatform || '2' },
      departure: { scheduled: iso(scheduledDeparture), estimated: iso(departure) },
      arrival: { scheduled: iso(scheduledArrival), estimated: iso(arrival) },
      line: { name, mode: 'train' }
    }]
  };
}

function transferJourney(name, departure, arrival) {
  const changeArrival = departure + 20 * MINUTE;
  const secondDeparture = changeArrival + 5 * MINUTE;
  return {
    id: name,
    departure: { scheduled: iso(departure), estimated: iso(departure), platform: '1' },
    arrival: { scheduled: iso(arrival), estimated: iso(arrival) },
    line: { name, mode: 'train' },
    destinationHeadsign: TO.name,
    legs: 2,
    legDetail: [
      {
        from: { ...FROM, platform: '1' }, to: { ...CHANGE, platform: '17' },
        departure: { scheduled: iso(departure), estimated: iso(departure) },
        arrival: { scheduled: iso(changeArrival), estimated: iso(changeArrival) },
        line: { name, mode: 'train' }
      },
      {
        from: { ...CHANGE, platform: '24' }, to: { ...TO, platform: '2' },
        departure: { scheduled: iso(secondDeparture), estimated: iso(secondDeparture) },
        arrival: { scheduled: iso(arrival), estimated: iso(arrival) },
        line: { name: 'T4', mode: 'train' }
      }
    ]
  };
}

function c1Journey(departure) {
  const firstArrival = departure + 27 * MINUTE;
  const secondDeparture = departure + 34 * MINUTE;
  const arrival = departure + 44 * MINUTE;
  return {
    ...transferJourney('T9', departure, arrival),
    legDetail: [
      {
        from: { ...FROM, platform: '1' }, to: { ...CHANGE, platform: '3' },
        departure: { scheduled: iso(departure), estimated: iso(departure) },
        arrival: { scheduled: iso(firstArrival), estimated: iso(firstArrival) },
        line: { name: 'T9', mode: 'train' }
      },
      {
        from: { ...CHANGE, platform: '5' }, to: { ...TO, platform: '2' },
        departure: { scheduled: iso(secondDeparture), estimated: iso(secondDeparture) },
        arrival: { scheduled: iso(arrival), estimated: iso(arrival) },
        line: { name: 'T4', mode: 'train' }
      }
    ]
  };
}

function threeLegJourney(departure) {
  const firstArrival = departure + 20 * MINUTE;
  const secondDeparture = departure + 25 * MINUTE;
  const secondArrival = departure + 45 * MINUTE;
  const thirdDeparture = departure + 50 * MINUTE;
  const arrival = departure + 70 * MINUTE;
  const northSydney = {
    id: '206010', name: 'North Sydney Station', modes: ['train'],
    location: { lat: -33.84076, lon: 151.20745 }
  };
  return {
    id: 'THREE', legs: 3,
    departure: { scheduled: iso(departure), estimated: iso(departure), platform: '1' },
    arrival: { scheduled: iso(arrival), estimated: iso(arrival) },
    line: { name: 'T9', mode: 'train' }, destinationHeadsign: TO.name,
    legDetail: [
      {
        from: { ...FROM, platform: '1' }, to: { ...CHANGE, platform: '3' },
        departure: { scheduled: iso(departure), estimated: iso(departure) },
        arrival: { scheduled: iso(firstArrival), estimated: iso(firstArrival) },
        line: { name: 'T9', mode: 'train' }
      },
      {
        from: { ...CHANGE, platform: '5' }, to: { ...northSydney, platform: '2' },
        departure: { scheduled: iso(secondDeparture), estimated: iso(secondDeparture) },
        arrival: { scheduled: iso(secondArrival), estimated: iso(secondArrival) },
        line: { name: 'T4', mode: 'train' }
      },
      {
        from: { ...northSydney, platform: '1' }, to: { ...TO, platform: '2' },
        departure: { scheduled: iso(thirdDeparture), estimated: iso(thirdDeparture) },
        arrival: { scheduled: iso(arrival), estimated: iso(arrival) },
        line: { name: 'T8', mode: 'train' }
      }
    ]
  };
}

function body(generatedAt, journeys) {
  return { generatedAt: iso(generatedAt), journeys };
}

function documentFor(journey, options = {}) {
  const doc = {
    schemaVersion: 1,
    trips: [{ id: 'commute', from: FROM, to: TO, createdAt: iso(FIXED_NOW - 86_400_000) }],
    history: [], rides: [], searches: { from: [], to: [] }, homeVotes: [],
    lastOpen: null, lastViewed: { tripId: 'commute', direction: 'forward' },
    preferences: {
      appearance: 'system', useLocation: options.useLocation ?? true,
      enabledModes: ['train', 'metro', 'ferry'], transferLimit: options.transferLimit || 'two'
    },
    flags: { transferLimit: true },
    cache: {
      [CACHE_KEY]: {
        fetchedAt: iso(FIXED_NOW), body: body(FIXED_NOW, options.cachedJourneys || [journey]),
        maxTransfers: options.maxTransfers ?? 2,
        ...(options.recommendationPages ? { recommendationPages: options.recommendationPages } : {})
      }
    }
  };
  if (options.focus !== false) {
    doc.focus = {
      tripId: 'commute', direction: 'forward', focusedAt: iso(FIXED_NOW - 30 * MINUTE),
      by: 'focus', journey,
      ...(options.guard === false ? {} : {
        arrivalGuard: { armed: true, retainedAt: iso(FIXED_NOW - MINUTE) }
      })
    };
  }
  return doc;
}

function apiRule(query, response, extra = {}) {
  return {
    match: { path: '/api/v1/departures', query },
    responses: [response], repeatLast: extra.repeatLast !== false
  };
}

function response(bodyValue, options = {}) {
  return {
    body: bodyValue, status: options.status || 200, delayMs: options.delayMs || 0,
    stale: options.stale === true, hold: options.hold || null
  };
}

function installHarness(initial) {
  const sessionRules = sessionStorage.getItem('__commute_feedback_rules__');
  const sessionNowRaw = sessionStorage.getItem('__commute_feedback_now__');
  const sessionNow = sessionNowRaw === null ? null : Number(sessionNowRaw);
  const config = {
    ...initial,
    now: sessionNow !== null && Number.isFinite(sessionNow) ? sessionNow : initial.now,
    rules: sessionRules ? JSON.parse(sessionRules) : initial.rules
  };
  const NativeDate = Date;
  const h = {
    clock: {
      now: config.now,
      set(value) { this.now = value; },
      persist(value) {
        this.now = value;
        sessionStorage.setItem('__commute_feedback_now__', String(value));
      }
    },
    permission: { state: config.permission || 'granted', queries: 0, listeners: new Set() },
    visibility: { hidden: false },
    storageWrites: [],
    timers: { requested: [] },
    net: { requests: [], external: [], rules: config.rules || [], pending: new Map(), aborted: [] },
    geo: {
      nextId: 1, watches: new Map(), archived: new Map(), current: [], clears: [],
      activeIds() { return [...this.watches.keys()]; },
      emit(id, sample) {
        const watcher = this.watches.get(id) || this.archived.get(id);
        if (!watcher) throw new Error(`unknown geolocation watch ${id}`);
        watcher.success(position(sample));
      },
      fail(id, message = 'synthetic location failure', code = 2) {
        const watcher = this.watches.get(id) || this.archived.get(id);
        if (!watcher) throw new Error(`unknown geolocation watch ${id}`);
        watcher.error?.({ code, message });
      },
      emitCurrent(sample) {
        const request = this.current.shift();
        if (!request) throw new Error('no pending getCurrentPosition request');
        request.success(position(sample));
      }
    }
  };

  function position(sample) {
    return {
      timestamp: sample.timestamp,
      coords: {
        latitude: sample.lat, longitude: sample.lon, accuracy: sample.accuracy,
        altitude: null, altitudeAccuracy: null, heading: null,
        speed: Object.prototype.hasOwnProperty.call(sample, 'speed') ? sample.speed : null
      }
    };
  }

  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [h.clock.now])); }
    static now() { return h.clock.now; }
  }
  globalThis.Date = FixedDate;
  if (config.fastDeadline) {
    const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
    globalThis.setTimeout = (callback, delay, ...args) => {
      h.timers.requested.push(delay);
      return nativeSetTimeout(callback, delay > 11_000 && delay <= 12_000 ? 80 : delay, ...args);
    };
  }

  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === 'trains.v1') h.storageWrites.push(String(value));
    return nativeSetItem.call(this, key, value);
  };

  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: {
      query: async ({ name }) => {
        if (name !== 'geolocation') throw new Error(`unexpected permission query ${name}`);
        h.permission.queries += 1;
        return h.permission.status;
      }
    }
  });
  h.permission.status = {
    get state() { return h.permission.state; },
    onchange: null,
    addEventListener(type, listener) {
      if (type === 'change') h.permission.listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'change') h.permission.listeners.delete(listener);
    }
  };
  h.permission.set = (state) => {
    h.permission.state = state;
    const event = new Event('change');
    h.permission.status.onchange?.call(h.permission.status, event);
    for (const listener of h.permission.listeners) listener.call(h.permission.status, event);
  };
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition(success, error, options) {
        h.geo.current.push({ success, error, options });
      },
      watchPosition(success, error, options) {
        const id = h.geo.nextId++;
        h.geo.watches.set(id, { success, error, options });
        return id;
      },
      clearWatch(id) {
        const watcher = h.geo.watches.get(id);
        if (watcher) h.geo.archived.set(id, watcher);
        h.geo.watches.delete(id);
        h.geo.clears.push(id);
      }
    }
  });

  h.setHidden = (hidden) => {
    h.visibility.hidden = Boolean(hidden);
    document.dispatchEvent(new Event('visibilitychange'));
  };
  Object.defineProperty(document, 'hidden', {
    configurable: true, get: () => h.visibility.hidden
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true, get: () => h.visibility.hidden ? 'hidden' : 'visible'
  });

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const matches = (rule, url) => {
    if (rule.match?.path !== url.pathname) return false;
    return Object.entries(rule.match.query || {}).every(([key, expected]) => {
      if (expected === null) return !url.searchParams.has(key);
      if (expected === '*') return url.searchParams.has(key);
      return url.searchParams.get(key) === String(expected);
    });
  };
  const makeResponse = (entry) => new Response(JSON.stringify(entry.body), {
    status: entry.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...(entry.stale ? { 'X-Data-Stale': 'true' } : {}),
      ...(entry.headers || {})
    }
  });
  const waitForResponse = (entry, signal) => new Promise((resolve, reject) => {
    let timer = null;
    const abort = () => {
      if (timer) clearTimeout(timer);
      if (entry.hold) {
        h.net.pending.delete(entry.hold);
        h.net.aborted.push(entry.hold);
      }
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve(makeResponse(entry));
    };
    if (entry.hold) h.net.pending.set(entry.hold, finish);
    else timer = setTimeout(finish, entry.delayMs || 0);
  });
  h.net.setRules = (rules) => { h.net.rules = rules; };
  h.net.persistRules = (rules) => {
    sessionStorage.setItem('__commute_feedback_rules__', JSON.stringify(rules));
  };
  h.net.release = (label) => {
    const finish = h.net.pending.get(label);
    if (!finish) throw new Error(`no held response ${label}`);
    h.net.pending.delete(label);
    finish();
  };
  globalThis.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url || input, location.href);
    const method = init.method || request?.method || 'GET';
    const signal = init.signal || request?.signal;
    if (url.origin !== location.origin) {
      h.net.external.push({ url: url.href, method });
      return makeResponse({
        body: { error: { code: 'external_blocked', message: 'blocked by verifier' } }, status: 503
      });
    }
    if (!url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }
    h.net.requests.push({ url: url.href, method, body: init.body || null });
    if (url.pathname === '/api/v1/flags') {
      return makeResponse({ body: { transferLimit: true }, status: 200 });
    }
    if (url.pathname === '/api/v1/stops') {
      return makeResponse({ body: { stops: [] }, status: 200 });
    }
    if (url.pathname !== '/api/v1/departures') {
      return makeResponse({ body: { error: { code: 'blocked', message: 'blocked by verifier' } }, status: 503 });
    }
    const rule = h.net.rules.find((candidate) => matches(candidate, url));
    if (!rule) {
      return makeResponse({ body: { error: { code: 'unstubbed', message: url.href } }, status: 503 });
    }
    rule.used = (rule.used || 0) + 1;
    const index = Math.min(rule.used - 1, rule.responses.length - 1);
    if (index >= rule.responses.length || index > 0 && !rule.repeatLast) {
      return makeResponse({ body: { error: { code: 'exhausted', message: url.href } }, status: 503 });
    }
    return waitForResponse(rule.responses[index], signal);
  };
  globalThis.__commuteHarness = h;
}

async function evaluate(page, fn, argument) {
  const expression = `(${fn.toString()})(${JSON.stringify(argument)})`;
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true
  });
  if (exceptionDetails) {
    const detail = exceptionDetails.exception?.description || exceptionDetails.text;
    throw new Error(detail);
  }
  return result.value;
}

async function waitForApp(page) {
  await evaluate(page, async () => {
    for (let index = 0; index < 160; index += 1) {
      if (window.__trains?.state?.root) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('app test seam did not load');
  });
}

async function configurePage(page, config, doc, frame = {}) {
  await page.send('Runtime.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${installHarness.toString()})(${JSON.stringify(config)})`
  });
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: frame.width || 390, height: frame.height || 844,
    deviceScaleFactor: 2, mobile: true
  });
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: frame.scheme || 'dark' }]
  });
  const seedURL = new URL('/__commute_feedback_seed__', baseURL);
  await page.send('Page.navigate', { url: seedURL.href });
  await sleep(80);
  await evaluate(page, (seed) => {
    localStorage.clear();
    sessionStorage.removeItem('__commute_feedback_rules__');
    sessionStorage.removeItem('__commute_feedback_now__');
    localStorage.setItem('trains.v1', JSON.stringify(seed));
  }, doc);
  const target = new URL(baseURL);
  target.hash = '#/';
  await page.send('Page.navigate', { url: target.href });
  await waitForApp(page);
  const viewport = await evaluate(page, () => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    meta: Boolean(document.querySelector('meta[name="viewport"]'))
  }));
  if (viewport.width !== (frame.width || 390) || viewport.height !== (frame.height || 844)) {
    throw new Error(`VIEWPORT LIE: ${JSON.stringify(viewport)}`);
  }
  if (!viewport.meta) throw new Error('page has no viewport meta tag');
}

function assertPrivateRequests(requests) {
  for (const request of requests) {
    const url = new URL(request.url);
    if (request.method !== 'GET') throw new Error(`unexpected API write ${request.method} ${url.pathname}`);
    for (const key of ['lat', 'lon', 'latitude', 'longitude', 'location', 'speed', 'accuracy']) {
      if (url.searchParams.has(key)) throw new Error(`personal evidence escaped in ${key}`);
    }
    if (!['/api/v1/departures', '/api/v1/flags', '/api/v1/stops'].includes(url.pathname)) {
      throw new Error(`unexpected API request ${url.pathname}`);
    }
  }
}

async function runCase(name, config, doc, script, frame) {
  await withPage(async (page) => {
    await configurePage(page, config, doc, frame);
    await evaluate(page, script);
    const requests = await evaluate(page, () => window.__commuteHarness.net.requests);
    assertPrivateRequests(requests);
    const external = await evaluate(page, () => window.__commuteHarness.net.external);
    if (external.length) throw new Error(`external requests attempted: ${JSON.stringify(external)}`);
  });
  console.log(`PASS ${name}`);
}

async function runReloadCase(name, config, doc, beforeReload, afterReload, beforeArgument, afterArgument) {
  await withPage(async (page) => {
    await configurePage(page, config, doc);
    await evaluate(page, beforeReload, beforeArgument);
    const beforeRequests = await evaluate(page, () => window.__commuteHarness.net.requests);
    const beforeExternal = await evaluate(page, () => window.__commuteHarness.net.external);
    await page.send('Page.reload');
    await sleep(120);
    await waitForApp(page);
    await evaluate(page, afterReload, afterArgument);
    const afterRequests = await evaluate(page, () => window.__commuteHarness.net.requests);
    assertPrivateRequests([...beforeRequests, ...afterRequests]);
    const afterExternal = await evaluate(page, () => window.__commuteHarness.net.external);
    if (beforeExternal.length || afterExternal.length) {
      throw new Error(`external requests attempted: ${JSON.stringify([...beforeExternal, ...afterExternal])}`);
    }
  });
  console.log(`PASS ${name}`);
}

function focusedConfig(journey, extraRules = [], nowMs = FIXED_NOW) {
  const current = body(nowMs, [journey]);
  return {
    now: nowMs, permission: 'granted',
    rules: [
      apiRule({ limit: '6' }, response(current)),
      apiRule({ limit: '10' }, response(current)),
      ...extraRules
    ]
  };
}

async function checkGuardedLifecycle() {
  const journey = directJourney('T9', FIXED_NOW - 30 * MINUTE, FIXED_NOW);
  await runReloadCase('guarded timing, background generation, and reload', focusedConfig(journey),
    documentFor(journey), async () => {
      const h = window.__commuteHarness;
      const t = window.__trains;
      const wait = async (read, message) => {
        for (let index = 0; index < 120; index += 1) {
          const result = read();
          if (result) return result;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(message);
      };
      const watch = await wait(() => h.geo.activeIds()[0], 'arrival watch did not start');
      const away = { lat: -33.85, lon: 151.15, accuracy: 12, speed: 12 };
      for (const delta of [-30_000, -15_000, 0]) h.geo.emit(watch, { ...away, timestamp: h.clock.now + delta });
      if (t.state.arrivalDecision?.state !== 'arrivalUnconfirmed' || !t.state.arrivalDecision.moving) {
        throw new Error(`moving away evidence did not guard ETA: ${JSON.stringify(t.state.arrivalDecision)}`);
      }
      if (t.state.doc.rides.length) throw new Error('moving away evidence recorded a ride');
      if (document.querySelector('.hm-hd .sy-mk')?.style.left !== '98%') {
        throw new Error('fresh movement did not show the pending-end marker at 98%');
      }
      const text = document.body.textContent;
      if (!text.includes('Arrival uncertain') || !text.includes('Still on the way to Bondi Junction')) {
        throw new Error('moving unconfirmed copy is missing');
      }
      if (/\b0\s*min\s*to go\b/i.test(text) || document.querySelector('[data-act="way-back"]')) {
        throw new Error('unconfirmed Home claimed zero minutes or offered a return');
      }

      h.setHidden(true);
      if (h.geo.activeIds().length || !h.geo.clears.includes(watch)) {
        throw new Error('backgrounding did not clear the location watch');
      }
      h.geo.emit(watch, {
        lat: -33.891819, lon: 151.247455, accuracy: 5, speed: 0, timestamp: h.clock.now
      });
      if (t.state.arrivalWindow?.samples?.length) throw new Error('background callback survived its generation');
      h.clock.set(h.clock.now + 179_000);
      h.setHidden(false);
      const resumed = await wait(() => h.geo.activeIds().find((id) => id !== watch), 'resume did not start a new watch');
      if (t.state.arrivalWindow?.samples?.length) throw new Error('resume retained raw arrival samples');
      t.tick();
      if (t.state.arrivalDecision?.state !== 'checkingArrival') {
        throw new Error(`ETA+2:59 was not checking arrival: ${t.state.arrivalDecision?.state}`);
      }
      h.clock.set(h.clock.now + 1_000);
      t.tick();
      if (t.state.arrivalDecision?.state !== 'arrivalUnconfirmed') {
        throw new Error(`ETA+3:00 was not unconfirmed: ${t.state.arrivalDecision?.state}`);
      }
      if (t.state.doc.rides.length || document.querySelector('[data-act="way-back"]')) {
        throw new Error('missing evidence created a ride or return action');
      }
      if (document.querySelector('.hm-hd .sy-mk')) throw new Error('missing movement kept the pending-end marker visible');
      if (!h.geo.activeIds().includes(resumed)) throw new Error('guarded unconfirmed trip stopped sampling');
      h.clock.persist(h.clock.now);
    }, async () => {
      for (let index = 0; index < 120 && !window.__trains?.state?.arrivalDecision; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const restored = window.__trains.state;
      if (!restored.doc.focus?.arrivalGuard?.armed || restored.doc.rides.length) {
        throw new Error('reload lost the guard or created a ride');
      }
      if (restored.arrivalWindow?.samples?.length) throw new Error('reload persisted raw arrival samples');
      if (restored.arrivalDecision.state !== 'arrivalUnconfirmed') {
        throw new Error(`reload changed guarded result: ${restored.arrivalDecision.state}`);
      }
    });
}

async function checkLocationOff() {
  const journey = directJourney('T9', FIXED_NOW - 30 * MINUTE, FIXED_NOW);
  await runCase('location-off cancellation and late callback rejection', focusedConfig(journey),
    documentFor(journey), async () => {
      const h = window.__commuteHarness;
      const t = window.__trains;
      const wait = async (read, message) => {
        for (let index = 0; index < 120; index += 1) {
          const result = read();
          if (result) return result;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(message);
      };
      const watch = await wait(() => h.geo.activeIds()[0], 'arrival watch did not start');
      document.querySelector('[data-act="settings"]').click();
      await wait(() => document.querySelector('.st-location-row'), 'Settings did not open');
      document.querySelector('.st-location-row').click();
      await wait(() => t.state.doc.preferences?.useLocation === false, 'location preference did not turn off');
      if (h.geo.activeIds().length || !h.geo.clears.includes(watch)) {
        throw new Error('turning location off did not clear the watch');
      }
      h.geo.emit(watch, {
        lat: -33.891819, lon: 151.247455, accuracy: 5, speed: 0, timestamp: h.clock.now
      });
      if (t.state.arrivalWindow?.samples?.length || t.state.doc.rides.length || t.state.fix) {
        throw new Error('late callback mutated state after location was disabled');
      }
      if (!t.state.doc.focus?.arrivalGuard?.armed) throw new Error('location off removed the persisted guard');
    });
}

async function checkPermissionRevocation() {
  const journey = directJourney('T9', FIXED_NOW - 30 * MINUTE, FIXED_NOW);
  await runCase('permission change clears evidence and rejects invalid timestamps', focusedConfig(journey),
    documentFor(journey), async () => {
      const h = window.__commuteHarness;
      const t = window.__trains;
      for (let index = 0; index < 120 && !h.geo.activeIds().length; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const watch = h.geo.activeIds()[0];
      if (!watch) throw new Error('arrival watch did not start');
      const near = { lat: -33.891819, lon: 151.247455, accuracy: 8, speed: 0 };
      h.geo.emit(watch, { ...near, timestamp: 0 });
      h.geo.emit(watch, { ...near });
      if (t.state.arrivalWindow?.samples?.length) {
        throw new Error('timestamp zero or missing timestamp became current time');
      }
      h.geo.emit(watch, {
        lat: -33.85, lon: 151.15, accuracy: 12, speed: 12, timestamp: h.clock.now
      });
      if (t.state.arrivalWindow?.samples?.length !== 1) throw new Error('valid evidence did not reach the reducer');
      h.permission.set('denied');
      for (let index = 0; index < 120 && h.geo.activeIds().length; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (h.geo.activeIds().length || !h.geo.clears.includes(watch)) {
        throw new Error('permission revocation did not clear the active watch');
      }
      if (t.state.geoPermission !== 'denied' || t.state.arrivalWindow?.samples?.length) {
        throw new Error('permission revocation retained granted state or raw evidence');
      }
      h.geo.emit(watch, { ...near, timestamp: h.clock.now });
      if (t.state.doc.rides.length || t.state.arrivalWindow?.samples?.length) {
        throw new Error('callback from revoked permission generation mutated arrival state');
      }
    });
}

async function checkProviderPermissionError() {
  const journey = directJourney('T9', FIXED_NOW - 30 * MINUTE, FIXED_NOW);
  await runCase('provider permission error clears watch and granted state', focusedConfig(journey),
    documentFor(journey), async () => {
      const h = window.__commuteHarness;
      const t = window.__trains;
      for (let index = 0; index < 120 && !h.geo.activeIds().length; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const watch = h.geo.activeIds()[0];
      if (!watch) throw new Error('arrival watch did not start');
      h.geo.emit(watch, {
        lat: -33.85, lon: 151.15, accuracy: 12, speed: 12, timestamp: h.clock.now
      });
      h.geo.fail(watch, 'permission denied', 1);
      for (let index = 0; index < 120 && h.geo.activeIds().length; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (h.geo.activeIds().length || !h.geo.clears.includes(watch)) {
        throw new Error('PERMISSION_DENIED left the old watch active');
      }
      if (t.state.geoPermission !== 'denied' || t.state.arrivalWindow?.samples?.length) {
        throw new Error('PERMISSION_DENIED retained granted state or evidence');
      }
      if (t.state.doc.rides.length) throw new Error('PERMISSION_DENIED created a ride');
    });
}

async function checkAtomicArrival() {
  const journey = directJourney('T9', FIXED_NOW - 30 * MINUTE, FIXED_NOW);
  await runCase('near confirmation writes one location-basis ride atomically', focusedConfig(journey),
    documentFor(journey), async () => {
      const h = window.__commuteHarness;
      const t = window.__trains;
      for (let index = 0; index < 120 && !h.geo.activeIds().length; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const watch = h.geo.activeIds()[0];
      if (!watch) throw new Error('arrival watch did not start');
      await new Promise((resolve) => setTimeout(resolve, 100));
      h.storageWrites.length = 0;
      const near = { lat: -33.891819, lon: 151.247455, accuracy: 8, speed: 0 };
      for (const delta of [-30_000, -15_000, 0]) h.geo.emit(watch, { ...near, timestamp: h.clock.now + delta });
      if (t.state.arrivalDecision?.state !== 'arrived' || t.state.arrivalDecision?.basis !== 'location') {
        throw new Error(`near window did not confirm arrival: ${JSON.stringify(t.state.arrivalDecision)}`);
      }
      if (t.state.doc.rides.length !== 1 || t.state.doc.focus?.arrivalGuard?.basis !== 'location') {
        throw new Error('location confirmation did not persist one ride and its basis');
      }
      if (t.state.arrivalWindow?.samples?.length) {
        throw new Error('confirmed arrival retained raw location samples');
      }
      const commits = h.storageWrites.map((raw) => JSON.parse(raw)).filter((doc) =>
        doc.rides?.length === 1 && doc.focus?.arrivalGuard?.basis === 'location');
      if (commits.length !== 1) throw new Error(`arrival was not one atomic storage write: ${commits.length}`);
      h.geo.emit(watch, { ...near, timestamp: h.clock.now + 5_000 });
      if (t.state.doc.rides.length !== 1) throw new Error('late completion callback duplicated the ride');
      if (h.geo.activeIds().length || !h.geo.clears.includes(watch)) {
        throw new Error('confirmed arrival did not stop collection');
      }
    });
}

async function checkGrantedRestoreArmsFirst() {
  const journey = directJourney('T9', FIXED_NOW - 30 * MINUTE, FIXED_NOW - MINUTE);
  await runCase('known-granted restore arms before estimate settlement', focusedConfig(journey),
    documentFor(journey, { guard: false }), async () => {
      const t = window.__trains;
      const h = window.__commuteHarness;
      for (let index = 0; index < 120 && !t.state.doc.focus?.arrivalGuard?.armed; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (h.permission.queries < 1) throw new Error('restored focus did not query location permission');
      if (!t.state.doc.focus?.arrivalGuard?.armed) throw new Error('known-granted restored focus was not armed');
      if (t.state.doc.rides.length || t.state.arrivalDecision?.basis === 'estimate') {
        throw new Error('known-granted restored focus settled from ETA before arming');
      }
      if (!['checkingArrival', 'arrivalUnconfirmed'].includes(t.state.arrivalDecision?.state)) {
        throw new Error(`known-granted restore has wrong state: ${t.state.arrivalDecision?.state}`);
      }
    });
}

async function checkRefreshBeforeSettlement() {
  const oldJourney = directJourney('T9', FIXED_NOW - 30 * MINUTE, FIXED_NOW - MINUTE);
  const delayedJourney = directJourney('T9', FIXED_NOW - 30 * MINUTE, FIXED_NOW + 5 * MINUTE, {
    scheduledDeparture: FIXED_NOW - 30 * MINUTE,
    scheduledArrival: FIXED_NOW - MINUTE
  });
  const config = {
    now: FIXED_NOW, permission: 'denied',
    rules: [
      apiRule({ limit: '6' }, response(body(FIXED_NOW, [delayedJourney]), { delayMs: 80 })),
      apiRule({ limit: '10' }, response(body(FIXED_NOW, [oldJourney])))
    ]
  };
  await runCase('matching refresh applies before arrival settlement', config,
    documentFor(oldJourney, { guard: false, useLocation: false }), async () => {
      const t = window.__trains;
      const h = window.__commuteHarness;
      for (let index = 0; index < 160; index += 1) {
        if (t.state.doc.focus?.journey?.arrival?.estimated === '2026-09-09T00:05:00.000Z') break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (t.state.doc.focus?.journey?.arrival?.estimated !== '2026-09-09T00:05:00.000Z') {
        throw new Error('matching refresh did not update the focused ETA');
      }
      if (t.state.arrivalDecision?.state !== 'travelling' || t.state.doc.rides.length) {
        throw new Error(`refresh settled against the old ETA: ${JSON.stringify(t.state.arrivalDecision)}`);
      }
      const rideWrites = h.storageWrites.map((raw) => JSON.parse(raw)).filter((doc) => doc.rides?.length);
      if (rideWrites.length) throw new Error('old ETA wrote a transient ride before matching refresh');
      const text = document.body.textContent;
      if (/\b0\s*min\s*to go\b/i.test(text) || document.querySelector('[data-act="way-back"]')) {
        throw new Error('postponed ETA retained finished copy');
      }
    });
}

function recommendationFixture() {
  const early = Array.from({ length: 6 }, (_, index) => transferJourney(
    `T${index + 1}`, FIXED_NOW + (5 + index * 5) * MINUTE, FIXED_NOW + (70 + index) * MINUTE
  ));
  const recommended = directJourney('T9', FIXED_NOW + 42 * MINUTE, FIXED_NOW + 74 * MINUTE);
  const cursorStop = { ...directJourney('T8', FIXED_NOW + 80 * MINUTE, FIXED_NOW + 100 * MINUTE), cancelled: true };
  return { early, recommended, cursorStop };
}

async function checkRecommendation() {
  const { early, recommended, cursorStop } = recommendationFixture();
  const base = body(FIXED_NOW - 2 * MINUTE, early);
  const later = body(FIXED_NOW, [recommended, cursorStop]);
  const config = {
    now: FIXED_NOW, permission: 'denied',
    rules: [
      apiRule({ limit: '10', at: null }, response(base)),
      apiRule({ limit: '10', at: '*' }, response(later))
    ]
  };
  await runReloadCase('page-two recommendation, source, throttle, generation, detail, and direct reload',
    config, documentFor(early[0], { focus: false, cachedJourneys: early }), async ({ later, recommended }) => {
      const h = window.__commuteHarness;
      const t = window.__trains;
      const keyOf = (journey) => JSON.stringify(journey.legDetail.map((leg) => [leg.line.name, leg.departure.scheduled]));
      const expected = keyOf(recommended);
      const wait = async (read, message) => {
        for (let index = 0; index < 200; index += 1) {
          const result = read();
          if (result) return result;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(message);
      };
      await wait(() => t.state.recommendation?.journey?.line?.name === 'T9', 'page-two direct was not recommended');
      if (t.state.body.journeys.length !== 6 || t.state.body.journeys.some((journey, index, rows) =>
        index && Date.parse(journey.departure.estimated) < Date.parse(rows[index - 1].departure.estimated))) {
        throw new Error('recommendation changed the six-row chronological board source');
      }
      if (t.state.recommendation.source?.body?.generatedAt !== '2026-09-09T00:00:00.000Z') {
        throw new Error('recommendation borrowed freshness from the base page');
      }
      if (document.querySelector('.hm-fresh .lbl')?.textContent.trim() !== 'Live') {
        throw new Error('Home did not show the chosen page own freshness');
      }
      const earlier = document.querySelector('[data-act="next-service"]');
      if (!earlier || !earlier.textContent.includes('Earlier train')) {
        throw new Error('later recommendation did not expose the earlier direct-action rail');
      }

      const beforeThrottle = h.net.requests.filter((item) => new URL(item.url).searchParams.has('at')).length;
      await t.refresh();
      await t.refresh();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const afterThrottle = h.net.requests.filter((item) => new URL(item.url).searchParams.has('at')).length;
      if (afterThrottle !== beforeThrottle) throw new Error('60-second throttle allowed another supplementary search');

      const open = document.querySelector('[data-act="recommendation-detail"], [data-act="open-recommendation"]');
      if (!open) throw new Error('Home has no action for the chosen recommendation detail');
      open.click();
      await wait(() => t.state.view === 'detail' && document.querySelector('.detail-fresh[data-t="footer"]'),
        'chosen recommendation detail did not render');
      if (keyOf(t.state.journey) !== expected) throw new Error('detail opened a different journey than the recommendation');
      if (document.querySelector('[data-t="footer"]')?.textContent.trim() !== 'Live') {
        throw new Error('chosen detail lost its page source freshness');
      }
      const pin = document.querySelector('[data-act="focus"]');
      if (!pin) throw new Error('chosen recommendation detail has no pin action');
      pin.click();
      await wait(() => t.state.doc.focus && t.state.view === 'home' && document.querySelector('[data-act="unpin"]'),
        'pin action did not return to focused Home');
      if (keyOf(t.state.doc.focus.journey) !== expected) throw new Error('pin persisted a different journey');
      document.querySelector('[data-act="unpin"]').click();
      await wait(() => !t.state.doc.focus, 'unpin did not clear recommendation focus');

      location.hash = '#/settings';
      await wait(() => document.querySelector('.st-transfer-row'), 'Settings did not open');
      const heldAny = [{
        match: { path: '/api/v1/departures', query: { limit: '10', transferLimit: null } },
        responses: [{ body: later, status: 200, hold: 'old-any' }], repeatLast: true
      }];
      h.net.setRules(heldAny);
      document.querySelector('.st-transfer-row').click();
      await wait(() => t.state.doc.preferences.transferLimit === 'any', 'two did not cycle to any');
      h.net.setRules([
        ...heldAny,
        { match: { path: '/api/v1/departures', query: { limit: '10', transferLimit: '0', at: null } },
          responses: [{ body: { generatedAt: '2026-09-09T00:00:00.000Z', journeys: [recommended] }, status: 200 }], repeatLast: true },
        { match: { path: '/api/v1/departures', query: { limit: '10', transferLimit: '0', at: '*' } },
          responses: [{ body: { generatedAt: '2026-09-09T00:00:00.000Z', journeys: [] }, status: 200 }], repeatLast: true }
      ]);
      document.querySelector('.st-transfer-row').click();
      await wait(() => t.state.doc.preferences.transferLimit === 'direct', 'any did not cycle to direct');
      if (h.net.pending.has('old-any')) h.net.release('old-any');
      location.hash = '#/';
      await wait(() => t.state.recommendation?.journey?.line?.name === 'T9', 'direct-only result did not paint');
      if (!h.net.aborted.includes('old-any')) throw new Error('A→B preference change did not abort the old generation');
      const directRequests = h.net.requests.filter((item) =>
        new URL(item.url).pathname === '/api/v1/departures'
        && new URL(item.url).searchParams.get('transferLimit') === '0');
      if (!directRequests.length) throw new Error('direct-only did not send numeric cap zero');
      const cache = t.state.doc.cache['213820-202210'];
      if (cache?.maxTransfers !== 0 || cache.body.journeys.some((journey) => journey.legDetail.length !== 1)) {
        throw new Error('direct-only cache retained incompatible journeys');
      }
      if (t.state.recommendation.journey.legDetail.length !== 1) {
        throw new Error('late uncapped generation replaced direct-only state');
      }

      const failed = [{
        match: { path: '/api/v1/departures', query: {} },
        responses: [{ body: { error: { code: 'offline', message: 'synthetic offline' } }, status: 503 }],
        repeatLast: true
      }];
      h.net.persistRules(failed);
    }, async () => {
      for (let index = 0; index < 200 && !window.__trains?.state?.recommendation; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const restored = window.__trains.state;
      if (restored.doc.preferences.transferLimit !== 'direct'
          || restored.recommendation.journey.legDetail.length !== 1
          || restored.doc.cache['213820-202210']?.maxTransfers !== 0) {
        throw new Error('direct-only preference/cache did not survive reload');
      }
      if (restored.recommendationCandidates.some((candidate) => candidate.journey.legDetail.length !== 1)) {
        throw new Error('direct-only reload admitted an incompatible cached recommendation');
      }
      const home = document.querySelector('.home-screen');
      if (!home || !home.textContent.includes('T9') || home.textContent.includes('T1')) {
        throw new Error('Home did not present only the eligible cached direct recommendation');
      }
    }, { later, recommended });
}

async function checkRecommendationDeadline() {
  const first = transferJourney('T2', FIXED_NOW + 5 * MINUTE, FIXED_NOW + 90 * MINUTE);
  const base = body(FIXED_NOW, [first]);
  const config = {
    now: FIXED_NOW, permission: 'denied', fastDeadline: true,
    rules: [
      apiRule({ limit: '10', at: null }, response(base)),
      apiRule({ limit: '10', at: '*' }, response(body(FIXED_NOW, []), { hold: 'deadline-page' }))
    ]
  };
  await runCase('supplementary deadline aborts without losing first-page answer', config,
    documentFor(first, { focus: false, cachedJourneys: [first] }), async () => {
      const h = window.__commuteHarness;
      const t = window.__trains;
      for (let index = 0; index < 160 && !h.net.aborted.includes('deadline-page'); index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (!h.net.aborted.includes('deadline-page')) throw new Error('12-second supplementary deadline did not abort');
      if (!h.timers.requested.some((delay) => delay > 11_000 && delay <= 12_000)) {
        throw new Error('controller did not schedule the remaining 12-second deadline budget');
      }
      if (t.state.recommendation?.journey?.line?.name !== 'T2') {
        throw new Error('deadline discarded the first-page recommendation');
      }
      if (t.state.recommendationPages.length || t.state.doc.cache['213820-202210']?.recommendationPages?.length) {
        throw new Error('aborted supplementary response entered memory or persisted cache');
      }
    });
}

async function captureGuardedHome() {
  fs.mkdirSync(outDir, { recursive: true });
  const journey = directJourney('T9', FIXED_NOW - 30 * MINUTE, FIXED_NOW - 3 * MINUTE);
  for (const { width, height } of [{ width: 390, height: 844 }, { width: 412, height: 732 }]) {
    for (const scheme of ['dark', 'light']) {
      await withPage(async (page) => {
        await configurePage(page, focusedConfig(journey), documentFor(journey), { width, height, scheme });
        await evaluate(page, async () => {
          const t = window.__trains;
          for (let index = 0; index < 120 && t.state.arrivalDecision?.state !== 'arrivalUnconfirmed'; index += 1) {
            t.tick();
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          if (t.state.arrivalDecision?.state !== 'arrivalUnconfirmed') {
            throw new Error(`guarded Home did not reach arrivalUnconfirmed: ${t.state.arrivalDecision?.state}`);
          }
          const text = document.body.textContent;
          if (!text.includes('Arrival unconfirmed') || !text.includes('Arrival time needs an update.')) {
            throw new Error('guarded Home capture has the wrong missing-evidence copy');
          }
          if (/\b0\s*min\s*to go\b/i.test(text) || document.querySelector('[data-act="way-back"]')) {
            throw new Error('guarded Home capture contains finished-trip UI');
          }
          const all = [...document.querySelectorAll('body *')];
          const worst = all.reduce((answer, element) => {
            const rect = element.getBoundingClientRect();
            return rect.right - document.documentElement.clientWidth > answer.overflow
              ? { overflow: rect.right - document.documentElement.clientWidth, tag: element.className || element.tagName }
              : answer;
          }, { overflow: 0, tag: '' });
          if (worst.overflow > 0.5) throw new Error(`horizontal overflow ${JSON.stringify(worst)}`);
        });
        const file = path.join(outDir, `home-guarded-${width}x${height}-${scheme}.png`);
        fs.writeFileSync(file, await screenshot(page));
      });
      console.log(`PASS guarded Home ${width}x${height} ${scheme}`);
    }
  }
}

async function inspectC1(page, expectedPhase, completedIndexes) {
  await evaluate(page, async ({ phase, complete }) => {
    const t = window.__trains;
    for (let index = 0; index < 120; index += 1) {
      t.tick();
      if (document.querySelector(`.hm-hd .sy-mk.${phase}`)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const marker = document.querySelector(`.hm-hd .sy-mk.${phase}`);
    if (!marker) throw new Error(`C1 marker did not enter ${phase}`);
    const chips = [...document.querySelectorAll('.hm-hd .sy-p[data-transfer-index]')];
    if (chips.length < 2) throw new Error('C1 transfer chips did not render');
    const probe = document.createElement('span');
    probe.style.color = 'var(--bg)';
    document.body.append(probe);
    const bg = getComputedStyle(probe).color;
    probe.remove();
    for (const chip of chips) {
      const index = Number(chip.dataset.transferIndex);
      const shouldFade = complete.includes(index);
      const after = getComputedStyle(chip, '::after');
      const faded = after.content !== 'none' && after.content !== 'normal';
      if (faded !== shouldFade) {
        throw new Error(`transfer ${index} ${chip.dataset.pin} fade=${faded}, expected ${shouldFade}`);
      }
      if (shouldFade) {
        if (Math.abs(Number(after.opacity) - 0.62) > 0.01) {
          throw new Error(`transfer ${index} ${chip.dataset.pin} opacity is ${after.opacity}`);
        }
        if (after.backgroundColor !== bg) {
          throw new Error(`transfer ${index} ${chip.dataset.pin} overlay ${after.backgroundColor}, expected ${bg}`);
        }
        const inset = [after.top, after.right, after.bottom, after.left].map(parseFloat);
        if (inset.some((value) => !Number.isFinite(value) || Math.abs(value) > 0.1)) {
          throw new Error(`transfer ${index} ${chip.dataset.pin} overlay does not cover the whole chip`);
        }
      }
    }
    for (const index of complete) {
      const pair = chips.filter((chip) => Number(chip.dataset.transferIndex) === index);
      if (pair.length !== 2) throw new Error(`completed transfer ${index} did not keep both chips`);
    }
    const progress = document.querySelector('.hm-hd .sy-progress-dim, .hm-hd [data-progress-dim]');
    if (!progress) throw new Error('C1 travelled-route overlay is missing');
    const markerRect = marker.getBoundingClientRect();
    const barRect = marker.closest('.sy-bar').getBoundingClientRect();
    if (markerRect.left < barRect.left - 1 || markerRect.right > barRect.right + 1) {
      throw new Error('C1 marker left the route axis');
    }
  }, { phase: expectedPhase, complete: completedIndexes });
}

async function captureC1() {
  fs.mkdirSync(outDir, { recursive: true });
  const departure = FIXED_NOW - 25 * MINUTE;
  const journey = c1Journey(departure);
  const phases = [
    { name: 'before', now: departure + 25 * MINUTE, marker: 'ride', complete: [] },
    { name: 'during', now: departure + 30 * MINUTE, marker: 'dwell', complete: [] },
    { name: 'after', now: departure + 37 * MINUTE, marker: 'ride2', complete: [0] }
  ];
  for (const { width, height } of [{ width: 390, height: 844 }, { width: 412, height: 732 }]) {
    for (const scheme of ['dark', 'light']) {
      for (const phase of phases) {
        await withPage(async (page) => {
          await configurePage(page, focusedConfig(journey, [], phase.now), documentFor(journey), {
            width, height, scheme
          });
          await inspectC1(page, phase.marker, phase.complete);
          const file = path.join(outDir, `c1-transfer-${phase.name}-${width}x${height}-${scheme}.png`);
          fs.writeFileSync(file, await screenshot(page));
        });
        console.log(`PASS C1 transfer ${phase.name} ${width}x${height} ${scheme}`);
      }
    }
  }

  const longDeparture = FIXED_NOW - 55 * MINUTE;
  const longJourney = threeLegJourney(longDeparture);
  await withPage(async (page) => {
    await configurePage(page, focusedConfig(longJourney, [], FIXED_NOW), documentFor(longJourney));
    await inspectC1(page, 'ride2', [0, 1]);
  });
  console.log('PASS C1 multi-transfer completed pairs stay dim');
}

async function checkResumeExpiry() {
  const journey = directJourney('T9', FIXED_NOW - 180 * MINUTE, FIXED_NOW - 150 * MINUTE);
  const doc = documentFor(journey);
  doc.focus.arrivalGuard.retainedAt = iso(FIXED_NOW - 180 * MINUTE);
  for (const delayedRefresh of [false, true]) {
    const config = focusedConfig(journey);
    if (delayedRefresh) config.rules[0].responses[0].hold = 'focus-lookup';
    await runCase(`overdue restore holds expiry through ${delayedRefresh ? 'service' : 'provider'} lookup`,
      config, doc, async () => {
        const t = window.__trains, h = window.__commuteHarness;
        await new Promise(resolve => setTimeout(resolve, 120));
        const watch = h.geo.activeIds()[0];
        if (!t.state.doc.focus || !watch) throw new Error('overdue focus expired before provider lookup');
        if (h.net.pending.has('focus-lookup')) {
          h.geo.emit(watch, { lat: -33.83, lon: 151.08, accuracy: 1000, speed: 12, timestamp: h.clock.now });
          if (!t.state.doc.focus) throw new Error('invalid provider callback expired focus during service lookup');
        }
        h.clock.set(h.clock.now + 14_000);
        t.tick();
        if (!t.state.doc.focus) throw new Error('lookup did not retain focus for its bounded allowance');
        h.geo.emit(watch, { lat: -33.83, lon: 151.08, accuracy: 10, speed: 12, timestamp: h.clock.now });
        if (h.net.pending.has('focus-lookup')) h.net.release('focus-lookup');
        await new Promise(resolve => setTimeout(resolve, 30));
        h.clock.set(h.clock.now + 2000);
        t.tick();
        if (!t.state.doc.focus || t.state.doc.rides.length) throw new Error('fresh away evidence did not retain unconfirmed focus');
      });
  }
  await runCase('overdue restore without evidence expires at the bounded deadline', focusedConfig(journey),
    doc, async () => {
      const t = window.__trains, h = window.__commuteHarness;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!t.state.doc.focus) throw new Error('expired before lookup allowance');
      h.clock.set(h.clock.now + 15_001);
      t.tick();
      if (t.state.doc.focus || t.state.doc.rides.length || h.geo.activeIds().length) {
        throw new Error('overdue focus did not expire silently at lookup deadline');
      }
    });
}

async function checkCompletedRestore() {
  const journey = directJourney('T9', FIXED_NOW - 30 * MINUTE, FIXED_NOW - MINUTE);
  const doc = documentFor(journey, { guard: false });
  doc.focus.arrivalGuard = { armed: false, basis: 'estimate' };
  doc.rides = [{ tripId: 'commute', direction: 'forward',
    scheduledDeparture: journey.departure.scheduled, departedAt: journey.departure.estimated,
    arrivedAt: journey.arrival.estimated, from: FROM, to: TO }];
  const config = focusedConfig(journey);
  config.rules[0].responses[0].hold = 'completed-refresh';
  await runCase('restored estimate-basis ride is never rearmed before its refresh', config, doc, async () => {
    const t = window.__trains, h = window.__commuteHarness;
    await new Promise(resolve => setTimeout(resolve, 100));
    if (h.geo.activeIds().length || t.state.doc.focus.arrivalGuard.armed) {
      throw new Error('restored completed ride was rearmed before initial refresh');
    }
    h.net.release('completed-refresh');
    await new Promise(resolve => setTimeout(resolve, 30));
    if (t.state.doc.rides.length !== 1 || t.state.arrivalDecision?.state !== 'arrived'
        || h.geo.activeIds().length) throw new Error('completed restore lost its estimate-basis arrival');
  });
}

async function checkRecommendationRetirement() {
  const first = directJourney('T9', FIXED_NOW + 20 * MINUTE, FIXED_NOW + 40 * MINUTE);
  const config = { now: FIXED_NOW, permission: 'denied', rules: [
    apiRule({ limit: '10', at: null }, response(body(FIXED_NOW, [])))
  ] };
  await runCase('successful empty search retires old supplementary pages', config,
    documentFor(first, { focus: false, recommendationPages: [{
      at: FIXED_NOW + 10 * MINUTE, body: body(FIXED_NOW, [first]), maxTransfers: 2
    }] }), async () => {
      const t = window.__trains;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (t.state.recommendation || t.state.recommendationPages.length
          || t.state.doc.cache['213820-202210'].recommendationPages?.length) {
        throw new Error('fresh successful empty search resurrected a cached supplementary recommendation');
      }
    });
}

async function checkRecommendationClock() {
  const first = directJourney('T9', FIXED_NOW + MINUTE, FIXED_NOW + 20 * MINUTE);
  const later = directJourney('T8', FIXED_NOW + 5 * MINUTE, FIXED_NOW + 25 * MINUTE);
  const config = { now: FIXED_NOW, permission: 'denied', rules: [
    apiRule({ limit: '10', at: null }, response(body(FIXED_NOW, [first, later]))),
    apiRule({ limit: '10', at: '*' }, response(body(FIXED_NOW, [])))
  ] };
  await runCase('clock excludes departed recommendations and ages each source', config,
    documentFor(first, { focus: false }), async () => {
      const t = window.__trains, h = window.__commuteHarness;
      await new Promise(resolve => setTimeout(resolve, 100));
      h.clock.set(h.clock.now + 91_000);
      t.tick();
      if (t.state.recommendation?.journey.line.name !== 'T8') throw new Error('tick still recommends departed service');
      if (!t.state.recommendation.stale || !t.state.recommendation.source.stale) {
        throw new Error('recommendation source stayed fresh beyond its own 90-second age');
      }
      if (document.querySelector('.hm-fresh .lbl')?.textContent.trim() === 'Live') {
        throw new Error('aged recommendation still displays Live');
      }
    });
}

async function checkSupplementCancellation() {
  const journey = directJourney('T9', FIXED_NOW + 5 * MINUTE, FIXED_NOW + 90 * MINUTE);
  for (const event of ['refresh', 'hide']) {
    const config = { now: FIXED_NOW, permission: 'denied', rules: [
      apiRule({ limit: '10', at: null }, response(body(FIXED_NOW, [journey]))),
      apiRule({ limit: '10', at: '*' }, response(body(FIXED_NOW, []), { hold: 'old-page' }))
    ] };
    await runReloadCase(`supplementary request aborts on ${event}`, config,
      documentFor(journey, { focus: false }), async event => {
        const t = window.__trains, h = window.__commuteHarness;
        for (let i = 0; i < 100 && !h.net.pending.has('old-page'); i++) await new Promise(r => setTimeout(r, 10));
        if (!h.net.pending.has('old-page')) throw new Error('supplementary request did not start');
        if (event === 'refresh') await t.refresh();
        else h.setHidden(true);
        if (!h.net.aborted.includes('old-page')) throw new Error(`superseded request was not aborted on ${event}`);
      }, () => {}, event);
  }
}

async function verifyServer() {
  const source = await fetch(new URL('/js/main.js', baseURL));
  if (!source.ok) throw new Error(`${baseURL.href} is not serving web/js/main.js`);
  const text = await source.text();
  if (!text.includes('reduceArrival') || !text.includes('fetchRecommendationPages')) {
    throw new Error('server is not serving the commute-feedback web integration');
  }
}

await verifyServer();
if (only === 'all' || only === 'review') {
  const failures = [];
  for (const check of [checkResumeExpiry, checkCompletedRestore, checkRecommendationRetirement, checkRecommendationClock, checkSupplementCancellation]) {
    try { await check(); } catch (error) { failures.push(error.message); console.error(error.message); }
  }
  if (failures.length) throw new Error(failures.join('\n'));
}
if (only === 'all' || only === 'arrival') {
  await checkGuardedLifecycle();
  await checkLocationOff();
  await checkPermissionRevocation();
  await checkProviderPermissionError();
  await checkAtomicArrival();
  await checkGrantedRestoreArmsFirst();
  await checkRefreshBeforeSettlement();
}
if (only === 'all' || only === 'recommendation') {
  await checkRecommendation();
  await checkRecommendationDeadline();
}
if (only === 'all' || only === 'screens') await captureGuardedHome();
if (only === 'all' || only === 'screens' || only === 'c1') await captureC1();
console.log(`commute-feedback browser checks passed; frames: ${outDir}`);
