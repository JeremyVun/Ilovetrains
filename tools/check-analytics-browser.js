#!/usr/bin/env node

/* Verify production-host analytics decisions while every byte stays local. */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const HTTP_PORT = Number(process.env.HTTP_PORT || 8193);
const CDP_PORT = Number(process.env.CDP_PORT || 9453);
const ORIGIN = `http://ilovetrains.jeremyvun.com:${HTTP_PORT}`;
const ANALYTICS = 'https://analytics.jeremyvun.com/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

const MIME = {
  '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

function chromeBinary() {
  const found = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('no Chrome found; set CHROME=/path/to/chrome');
  return found;
}

function seededDoc(body) {
  const trip = {
    id: 'analytics-browser-trip',
    from: { id: '200060', name: 'Central Station' },
    to: { id: '215020', name: 'Parramatta Station' },
    createdAt: '2026-09-01T08:00:00+10:00'
  };
  return {
    schemaVersion: 1,
    trips: [trip],
    history: [],
    lastViewed: { tripId: trip.id, direction: 'forward' },
    cache: { '200060-215020': { fetchedAt: body.generatedAt, body } }
  };
}

function localServer(body) {
  return http.createServer((req, res) => {
    const pathname = new URL(req.url, ORIGIN).pathname;
    if (pathname === '/api/v1/departures') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(WEB, relative);
    if (file !== WEB && !file.startsWith(WEB + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const content = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(content);
    } catch (_) {
      res.writeHead(404).end();
    }
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const waiter = message.id && pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
    };
    socket.onerror = reject;
    const send = (method, params, sessionId) => new Promise((res, rej) => {
      const message = { id: ++id, method, params: params || {} };
      if (sessionId) message.sessionId = sessionId;
      pending.set(message.id, { resolve: res, reject: rej });
      socket.send(JSON.stringify(message));
    });
    socket.onopen = () => resolve({
      send: (method, params) => send(method, params),
      session: (sessionId) => ({ send: (method, params) => send(method, params, sessionId) }),
      close: () => socket.close()
    });
  });
}

async function debuggerUrl() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      const value = await response.json();
      if (value.webSocketDebuggerUrl) return value.webSocketDebuggerUrl;
    } catch (_) { /* Chrome is still starting. */ }
    await sleep(100);
  }
  throw new Error('Chrome devtools endpoint never came up');
}

async function evaluate(page, expression) {
  const value = await page.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true
  });
  if (value.exceptionDetails) {
    const detail = value.exceptionDetails;
    throw new Error((detail.exception && detail.exception.description) || detail.text);
  }
  return value.result.value;
}

function installScript({ doc, gpc = false, dnt = '0', storageDenied = false }) {
  return `(() => {
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {configurable: true, get: () => ${gpc}});
    Object.defineProperty(Navigator.prototype, 'doNotTrack', {configurable: true, get: () => ${JSON.stringify(dnt)}});
    const rawFetch = window.fetch.bind(window);
    window.__analyticsOutbound = [];
    window.fetch = (input, init) => {
      const url = String(input && input.url || input || '');
      if (url.startsWith(${JSON.stringify(ANALYTICS)})) {
        window.__analyticsOutbound.push({kind: 'fetch', url, body: init && init.body || null});
        return Promise.resolve(new Response('', {status: 204}));
      }
      return rawFetch(input, init);
    };
    Object.defineProperty(Navigator.prototype, 'sendBeacon', {
      configurable: true,
      value: function (url, body) {
        if (String(url).startsWith(${JSON.stringify(ANALYTICS)})) {
          window.__analyticsOutbound.push({kind: 'beacon', url, body: null});
          return true;
        }
        return false;
      }
    });
    ${storageDenied
      ? `Object.defineProperty(window, 'localStorage', {configurable: true, get: () => { throw new DOMException('denied', 'SecurityError'); }});`
      : `localStorage.clear(); localStorage.setItem('trains.v1', ${JSON.stringify(JSON.stringify(doc))});`}
  })();`;
}

async function runScenario(ws, body, scenario) {
  const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' });
  try {
    const { sessionId } = await ws.send('Target.attachToTarget', { targetId, flatten: true });
    const page = ws.session(sessionId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: installScript({ ...scenario, doc: seededDoc(body) })
    });
    await page.send('Page.navigate', { url: ORIGIN });
    for (let attempt = 0; attempt < 60; attempt++) {
      const ready = await evaluate(page, 'Boolean(window.__trains && window.__trains.analytics.events.length)');
      if (ready) break;
      if (attempt === 59) throw new Error(`${scenario.name}: the app never recorded its first answer`);
      await sleep(100);
    }

    const result = await evaluate(page, `(async () => {
      const t = window.__trains;
      if (${scenario.flush ? 'true' : 'false'}) await t.analytics.flush();
      const storage = (() => {
        try { return {
          doc: JSON.parse(localStorage.getItem('trains.v1')),
          queue: localStorage.getItem('trains.analytics.v1')
        }; } catch (_) { return null; }
      })();
      return {
        hostname: location.hostname,
        events: t.analytics.events,
        variant: t.analytics.variant('strip-placement'),
        storage,
        outbound: window.__analyticsOutbound
      };
    })()`);

    if (result.hostname !== 'ilovetrains.jeremyvun.com') {
      throw new Error(`${scenario.name}: hostname is ${result.hostname}`);
    }
    const names = result.events.map((event) => event.t);
    if (JSON.stringify(names) !== JSON.stringify(scenario.events)) {
      throw new Error(`${scenario.name}: events ${JSON.stringify(names)}, want ${JSON.stringify(scenario.events)}`);
    }
    if (scenario.enabled) {
      const telemetry = result.storage && result.storage.doc && result.storage.doc.telemetry;
      if (!telemetry || telemetry.opens !== 1 || !Number.isInteger(telemetry.bucket)
        || telemetry.bucket < 0 || telemetry.bucket > 99) {
        throw new Error(`${scenario.name}: bad first-open telemetry ${JSON.stringify(telemetry)}`);
      }
      const expectedVariant = telemetry.bucket % 2 ? 'a2' : 'a3';
      if (result.variant !== expectedVariant) {
        throw new Error(`${scenario.name}: bucket ${telemetry.bucket} resolved ${result.variant}`);
      }
      if (result.outbound.length !== 1 || result.outbound[0].kind !== 'fetch') {
        throw new Error(`${scenario.name}: outbound capture ${JSON.stringify(result.outbound)}`);
      }
      const payload = JSON.parse(result.outbound[0].body);
      if (payload.map((event) => event.t).join('/') !== 'opened/shown_predicted') {
        throw new Error(`${scenario.name}: payload ${JSON.stringify(payload)}`);
      }
      for (const event of payload) {
        if (event.p !== 'ilovetrains' || event.n !== 1 || event.d.u !== '1'
          || event.d['x.strip-placement'] !== expectedVariant) {
          throw new Error(`${scenario.name}: invalid payload event ${JSON.stringify(event)}`);
        }
      }
    } else {
      if (result.variant !== 'a3') throw new Error(`${scenario.name}: privacy control did not force A3`);
      if (result.outbound.length) throw new Error(`${scenario.name}: sent ${JSON.stringify(result.outbound)}`);
      if (result.storage && (result.storage.doc.telemetry || result.storage.queue !== null)) {
        throw new Error(`${scenario.name}: wrote analytics state ${JSON.stringify(result.storage)}`);
      }
    }
    console.log(`${scenario.name}: ${names.join(' → ')}; ${scenario.enabled ? 'captured locally' : 'transport silent'}; ${result.variant}`);
  } finally {
    await ws.send('Target.closeTarget', { targetId });
  }
}

async function main() {
  const fixture = await import(pathToFileURL(path.join(ROOT, 'web/test/fixture.js')).href);
  const body = fixture.departuresBody();
  const server = localServer(body);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(HTTP_PORT, '127.0.0.1', resolve);
  });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-analytics-browser-'));
  const chrome = spawn(chromeBinary(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--proxy-server=direct://', '--proxy-bypass-list=*',
    `--host-resolver-rules=MAP ilovetrains.jeremyvun.com 127.0.0.1, MAP analytics.jeremyvun.com 127.0.0.1`,
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });

  let ws;
  try {
    ws = await connect(await debuggerUrl());
    const scenarios = [
      { name: 'enabled-first-open', enabled: true, flush: true, events: ['opened', 'shown_predicted'] },
      { name: 'gpc-ignored', gpc: true, enabled: true, flush: true, events: ['opened', 'shown_predicted'] },
      { name: 'dnt', dnt: '1', events: ['shown_predicted'] },
      { name: 'storage-denied', storageDenied: true, events: ['shown_setup'] }
    ];
    for (const scenario of scenarios) await runScenario(ws, body, scenario);
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill('SIGKILL');
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
}

const { pathToFileURL } = require('url');
main().catch((error) => { console.error(error.message || error); process.exit(1); });
