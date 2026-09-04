/* Screenshot instrument — CDP, no npm dependencies.
 *
 * Usage
 *   node tools/screenshot.js <url> <out.png> [options]
 *
 *   --size WxH        viewport in CSS px (default 390x844)
 *   --dsf N           device scale factor (default 2)
 *   --desktop         emulate a desktop (mobile:false); default is mobile:true
 *   --wait MS         settle time after load before the shot (default 500)
 *   --seed FILE.json  write FILE's JSON into localStorage under `trains.v1`
 *                     before the page boots, then load the app
 *   --key NAME        localStorage key for --seed (default trains.v1)
 *   --eval "JS"       evaluate JS after load, before the shot
 *   --media K:V       emulate a media feature, repeatable
 *                     (e.g. --media prefers-reduced-motion:reduce)
 *   --profile DIR     reuse (and keep) a browser profile directory instead of
 *                     a throwaway one — the only way to measure a genuinely
 *                     WARM open: run once to install the service worker and
 *                     fill its caches, then again against the same profile
 *                     (optionally with the server stopped, which is the real
 *                     offline test rather than a simulated one)
 *   --manifest        print the web app manifest AS CHROME PARSED IT, with its
 *                     parse errors — the installability check that a fetch of
 *                     the JSON cannot make
 *   --full            capture beyond the viewport (whole scroll height)
 *   --quiet           suppress page console errors
 *
 * TRAPS — every one was paid for in lost review passes; do not "simplify" them.
 *
 * 1. VIEWPORT LIE. `chrome --headless --window-size=390,844 --screenshot`
 *    silently clamps the layout viewport to 500 CSS px on macOS and then crops
 *    the PNG to 390@2x. Every "mobile" shot taken that way is a lie: content
 *    that overflows a real 390px phone lays out comfortably at 500 and the
 *    overflow is cropped away. This tool drives CDP and uses
 *    Emulation.setDeviceMetricsOverride (not clamped), then ASSERTS
 *    document.documentElement.clientWidth === the requested width and refuses
 *    to save otherwise. If it throws VIEWPORT LIE, believe it and fix the
 *    instrument, not the CSS.
 *
 * 2. MISSING VIEWPORT META. With mobile:true and no <meta name="viewport">,
 *    Chrome lays out at 980px and scales down. The page under test must ship
 *    the meta tag (a real PWA does anyway). This is caught by trap 1.
 *
 * 3. SILENT OVERFLOW. A single nowrap string can push content past the
 *    viewport clip, which looks like missing content rather than overflow.
 *    Every shot reports the worst right-edge overflow and the element's class.
 *
 * 4. ORPHAN CHROME. Chrome is killed in a `finally` with SIGKILL and its temp
 *    profile removed, so a killed agent never leaves a browser tree behind.
 *
 * 5. STORAGE LOST ON KILL. Chrome flushes localStorage lazily; SIGKILL alone
 *    discards it. With --profile that turns the second run into a cold app
 *    with warm service-worker caches. The browser is asked to close first and
 *    given a moment to flush, with SIGKILL still the backstop (trap 4).
 *
 * 6. SILENT --eval FAILURE. Runtime.evaluate returns a rejected promise in its
 *    RESULT rather than raising Runtime.exceptionThrown, so a driving script
 *    that throws used to skip everything after it and still shoot, print
 *    nothing and exit 0 — a convincing photograph of the wrong screen. The
 *    result's exceptionDetails is read; a failed --eval prints EVAL FAILED
 *    with the message and exits non-zero, saving nothing.
 *
 * Seeding note: localStorage is origin-scoped, so --seed navigates to the URL
 * once to acquire the origin, writes the key, then navigates again. Anything
 * the app wrote during the first load is cleared before seeding.
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

const PORT = Number(process.env.CDP_PORT || 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const positional = [];
  const opt = {
    size: '390x844', dsf: 2, mobile: true, wait: 500,
    seed: null, key: 'trains.v1', evalJs: null, full: false, quiet: false,
    media: [], profile: null, manifest: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--size') opt.size = argv[++i];
    else if (a === '--dsf') opt.dsf = Number(argv[++i]);
    else if (a === '--desktop') opt.mobile = false;
    else if (a === '--wait') opt.wait = Number(argv[++i]);
    else if (a === '--seed') opt.seed = argv[++i];
    else if (a === '--key') opt.key = argv[++i];
    else if (a === '--eval') opt.evalJs = argv[++i];
    else if (a === '--media') {
      const [name, value] = String(argv[++i]).split(':');
      if (!name || value === undefined) throw new Error('bad --media, want name:value');
      opt.media.push({ name, value });
    }
    else if (a === '--profile') opt.profile = path.resolve(argv[++i]);
    else if (a === '--manifest') opt.manifest = true;
    else if (a === '--full') opt.full = true;
    else if (a === '--quiet') opt.quiet = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else positional.push(a);
  }
  const [url, out] = positional;
  if (!url || !out) throw new Error('usage: node tools/screenshot.js <url> <out.png> [options]');
  const m = /^(\d+)x(\d+)$/.exec(opt.size);
  if (!m) throw new Error(`bad --size ${opt.size}, want WxH`);
  return { url, out: path.resolve(out), w: +m[1], h: +m[2], ...opt };
}

function chromeBinary() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('no Chrome found; set CHROME=/path/to/chrome');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const keepProfile = Boolean(args.profile);
  const profile = args.profile || fs.mkdtempSync(path.join(os.tmpdir(), 'shot-prof-'));
  if (keepProfile) fs.mkdirSync(profile, { recursive: true });
  const chrome = spawn(chromeBinary(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--allow-file-access-from-files', 'about:blank'
  ], { stdio: 'ignore' });

  let ws;
  try {
    ws = await connect(await waitForDevtools());
    const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await ws.send('Target.attachToTarget', { targetId, flatten: true });
    const page = ws.session(sessionId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');

    const problems = [];
    ws.on('Runtime.consoleAPICalled', (p) => {
      if (p.type !== 'error' && p.type !== 'warning') return;
      problems.push(p.type + ': ' + (p.args || []).map(describe).join(' '));
    });
    ws.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {};
      problems.push('exception: ' + (d.exception && d.exception.description || d.text));
    });

    await page.send('Emulation.setDeviceMetricsOverride', {
      width: args.w, height: args.h, deviceScaleFactor: args.dsf, mobile: args.mobile
    });

    // A media query you cannot emulate is a media query you cannot verify:
    // prefers-reduced-motion was in the CSS long before anything proved it
    // applied. Features must be set before the page evaluates its styles.
    if (args.media.length) {
      await page.send('Emulation.setEmulatedMedia', { media: '', features: args.media });
    }

    if (args.seed) {
      const doc = fs.readFileSync(args.seed, 'utf8');
      JSON.parse(doc); // fail loudly here, not inside the page
      await navigate(page, args.url);
      await page.send('Runtime.evaluate', {
        expression: `localStorage.clear();localStorage.setItem(${JSON.stringify(args.key)},${JSON.stringify(doc)})`
      });
    }

    await navigate(page, args.url);
    await sleep(args.wait);
    if (args.evalJs) {
      // TRAP 6: a rejected --eval promise comes back in the RESULT, so an
      // unread exceptionDetails shoots whatever the page was showing, exit 0.
      const ev = await page.send('Runtime.evaluate', { expression: args.evalJs, awaitPromise: true });
      if (ev.exceptionDetails) {
        const d = ev.exceptionDetails;
        throw new Error('EVAL FAILED: ' + ((d.exception && d.exception.description) || d.text));
      }
      await sleep(120);
    }

    if (args.manifest) {
      const m = await page.send('Page.getAppManifest');
      console.log('  manifest ' + JSON.stringify({
        url: m.url,
        errors: (m.errors || []).map((e) => e.message),
        parsed: m.parsed || null
      }));
    }

    const probe = JSON.parse((await page.send('Runtime.evaluate', {
      expression: `(()=>{const d=document.documentElement;let over=0,tag='';
        document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();
          if(r.right>d.clientWidth+0.5&&r.width>0&&getComputedStyle(e).position!=='absolute'){
            if(r.right-d.clientWidth>over){over=Math.round(r.right-d.clientWidth);tag=e.className||e.tagName;}}});
        return JSON.stringify({w:d.clientWidth,h:d.clientHeight,scroll:d.scrollHeight,over,tag});})()`,
      returnByValue: true
    })).result.value);

    if (probe.w !== args.w) {
      throw new Error(`VIEWPORT LIE: asked ${args.w}, page reports ${probe.w} — fix the instrument, not the CSS`);
    }

    const shot = await page.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: args.full
    });
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, Buffer.from(shot.data, 'base64'));

    console.log(`${args.out}  ${probe.w}x${probe.h} css @${args.dsf}x` +
      (probe.scroll > probe.h ? `  (scrollHeight ${probe.scroll})` : '') +
      (probe.over ? `  OVERFLOW +${probe.over}px (${probe.tag})` : ''));
    if (!args.quiet) for (const p of problems) console.log('  page ' + p);
  } finally {
    // TRAP 5: SIGKILL alone loses localStorage. Chrome writes it lazily, so a
    // killed browser takes the page's storage with it and the NEXT run against
    // a --profile directory opens on an empty app while its service-worker
    // caches (written eagerly) are still there — a warm open that looks cold
    // for no visible reason. Ask the browser to close first, wait briefly for
    // it to flush, and keep SIGKILL as the backstop that guarantees no orphan.
    if (ws) {
      try {
        const exited = new Promise((r) => chrome.once('exit', r));
        await ws.send('Browser.close');
        await Promise.race([exited, sleep(2500)]);
      } catch (_) { /* closing is best-effort; the kill below is not */ }
      try { ws.close(); } catch (_) {}
    }
    chrome.kill('SIGKILL');
    // A dying Chrome writes into its profile while the directory is being
    // walked, so the remove can lose a race and throw ENOTEMPTY — which would
    // fail the process AFTER a perfectly good screenshot was written. A temp
    // profile left in /tmp is not worth a false red in a scripted loop.
    try {
      if (!keepProfile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    } catch (e) {
      console.error('  (left temp profile behind: ' + e.code + ' ' + profile + ')');
    }
  }
}

function describe(a) {
  if (a.value !== undefined) return String(a.value);
  return a.description || a.type;
}

async function navigate(page, url) {
  await page.send('Page.navigate', { url });
  await sleep(300);
}

async function waitForDevtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch (_) { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('Chrome devtools endpoint never came up');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    const pending = new Map();
    const listeners = new Map();
    let id = 0;
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method && listeners.has(m.method)) {
        for (const cb of listeners.get(m.method)) cb(m.params || {});
      }
    };
    sock.onerror = reject;
    const raw = (method, params, sessionId) => new Promise((res, rej) => {
      const msg = { id: ++id, method, params: params || {} };
      if (sessionId) msg.sessionId = sessionId;
      pending.set(msg.id, { res, rej });
      sock.send(JSON.stringify(msg));
    });
    sock.onopen = () => resolve({
      send: (m, p) => raw(m, p),
      session: (sid) => ({ send: (m, p) => raw(m, p, sid) }),
      on: (method, cb) => {
        if (!listeners.has(method)) listeners.set(method, []);
        listeners.get(method).push(cb);
      },
      close: () => sock.close()
    });
  });
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
