/* Headless Chrome over CDP for the comps harness. Node built-ins only; the
 * repo has no npm dependencies and keeps it that way.
 *
 * TRAP — VIEWPORT LIE. `chrome --headless --window-size=390,844 --screenshot`
 * silently clamps the layout viewport to 500 CSS px on macOS and crops the PNG,
 * so every "mobile" shot taken that way is a lie. `frame()` drives
 * Emulation.setDeviceMetricsOverride and asserts BOTH clientWidth and
 * clientHeight; callers must refuse to save on a mismatch.
 * TRAP — VIEWPORT META. With mobile:true and no <meta name="viewport"> Chrome
 * lays out at 980px. `frame()` reports whether the page ships the meta tag.
 * TRAP — LOCKED PROFILE. A profile directory left behind by an orphaned
 * headless tree makes the next Chrome exit before the devtools endpoint opens,
 * which surfaces as an unrelated "Invalid URL" from the WebSocket. Every run
 * gets its own mkdtemp profile, removed in the finally.
 * TRAP — PORT COLLISION. Two rounds in one checkout on one fixed port produce
 * the same failure. Chrome is asked for port 0 and reports the port it got in
 * DevToolsActivePort, so no comps tool ever collides with another, with
 * tools/screenshot.js (9333) or with a stale tree.
 * TRAP — ORPHAN CHROME. SIGKILL in a finally, so a killed agent leaves no
 * browser tree behind.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromeBinary() {
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error('no Chrome found; set CHROME=/path/to/chrome');
  return found;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      const waiter = m.id && pending.get(m.id);
      if (!waiter) return;
      pending.delete(m.id);
      m.error ? waiter.reject(new Error(JSON.stringify(m.error))) : waiter.resolve(m.result);
    };
    sock.onerror = reject;
    const raw = (method, params, sessionId) => new Promise((res, rej) => {
      const msg = { id: ++id, method, params: params || {} };
      if (sessionId) msg.sessionId = sessionId;
      pending.set(msg.id, { resolve: res, reject: rej });
      sock.send(JSON.stringify(msg));
    });
    sock.onopen = () => resolve({
      send: raw,
      session: (sid) => ({ send: (m, p) => raw(m, p, sid) }),
      close: () => sock.close()
    });
  });
}

function activePort(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  if (!fs.existsSync(file)) return null;
  const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
  return Number.isFinite(port) && port > 0 ? port : null;
}

async function debuggerUrl(profile) {
  for (let i = 0; i < 120; i++) {
    const port = activePort(profile);
    if (port) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        const j = await res.json();
        if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
      } catch (_) { /* endpoint not listening yet */ }
    }
    await sleep(100);
  }
  throw new Error('Chrome devtools endpoint never came up (see the locked-profile trap)');
}

/** Launch Chrome, hand `fn` a page speaking CDP, and always clean up after it. */
async function withPage(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-comps-chrome-'));
  const chrome = spawn(chromeBinary(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--allow-file-access-from-files', 'about:blank'
  ], { stdio: 'ignore' });

  const backstop = () => chrome.kill('SIGKILL');
  process.once('exit', backstop);

  let ws;
  try {
    ws = await connect(await debuggerUrl(profile));
    const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await ws.send('Target.attachToTarget', { targetId, flatten: true });
    const page = ws.session(sessionId);
    await page.send('Page.enable');
    return await fn(page);
  } finally {
    if (ws) try { ws.close(); } catch (_) { /* the browser is about to die anyway */ }
    process.off('exit', backstop);
    chrome.kill('SIGKILL');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* same */ }
  }
}

/** withPage for a caller that cannot wrap its whole life in one callback, such
    as a test file. It must call close(); process exit is still the backstop. */
async function open() {
  let close;
  const closed = new Promise((resolve) => { close = resolve; });
  const page = await new Promise((resolve, reject) => {
    withPage(async (p) => { resolve(p); await closed; }).catch(reject);
  });
  return { page, close };
}

/** Put the page at a real device viewport and scheme, and prove it got there. */
async function frame(page, { url, width, height, scheme = 'dark', dsf = 2, settle = 260 }) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile: true });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await page.send('Page.navigate', { url });
  await sleep(settle);

  const got = await evaluate(page, `({
    w: document.documentElement.clientWidth,
    h: document.documentElement.clientHeight,
    meta: !!document.querySelector('meta[name="viewport"]')
  })`);
  if (got.w !== width) throw new Error(`VIEWPORT LIE: asked ${width}, got ${got.w} — fix the instrument, not the CSS`);
  if (got.h !== height) throw new Error(`VIEWPORT LIE (height): asked ${height}, got ${got.h}`);
  if (!got.meta) throw new Error(`${url} ships no <meta name="viewport">; Chrome laid it out at desktop width`);
  return got;
}

async function evaluate(page, expression) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression: `(() => (${expression}))()`, returnByValue: true, awaitPromise: true
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception ? exceptionDetails.exception.description : exceptionDetails.text);
  return result.value;
}

async function screenshot(page, clip) {
  const shot = await page.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
  return Buffer.from(shot.data, 'base64');
}

module.exports = { withPage, open, frame, evaluate, screenshot, chromeBinary, sleep };
