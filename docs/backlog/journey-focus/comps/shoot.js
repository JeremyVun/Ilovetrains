/* Screenshot instrument for /tmp/trains_comps2.
 *
 * Technique lifted from the repo's tools/screenshot.js + the first comps
 * round's shoot.js. The repo was NOT modified.
 *
 * TRAP (found the hard way in the first round, still true):
 * `chrome --headless --window-size=390,844 --screenshot` silently clamps the
 * layout viewport to 500 CSS px on macOS and then crops the PNG to 390@2x, so
 * every "mobile" shot taken that way is a lie. This drives CDP and uses
 * Emulation.setDeviceMetricsOverride (not clamped), then ASSERTS
 * document.documentElement.clientWidth === the requested width and refuses to
 * save otherwise. It also reports any element whose right edge overflows, and
 * any element whose bottom edge falls past the fold.
 *
 * TRAP 2: with mobile:true and no <meta name="viewport">, Chrome lays out at
 * 980px. Every comp carries the viewport meta a real PWA ships anyway.
 *
 * Light mode is Emulation.setEmulatedMedia prefers-color-scheme:light, so the
 * comps run the same @media block the product ships — no CSS fork.
 *
 * Usage: node shoot.js                  everything
 *        node shoot.js a1-ledger        one comp, all its shots
 *        node shoot.js a1-ledger tight  one comp, one scenario
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = '/tmp/trains_comps2';
const OUT = path.join(DIR, 'shots');
const PORT = 9344;

const PHONE = { w: 390, h: 844, tag: '390x844' };
const SHORT = { w: 412, h: 732, tag: '412x732' };

/* Surface A: journey detail. Surface B: focused strip + on-the-train. */
const A = ['a1-ledger', 'a2-spine', 'a3-changefirst'];
const B = ['b1-standfirst', 'b2-footerrail', 'b3-lead'];

const JOBS = [];
const add = (c, s, v, scheme) => JOBS.push({ c, s, v, scheme: scheme || 'dark' });

for (const c of A) {
  for (const s of ['hero', 'tight', 'cancelled', 'long']) add(c, s, PHONE);
  add(c, 'long', SHORT);
  add(c, 'hero', SHORT);
  add(c, 'hero', PHONE, 'light');
}
for (const c of B) {
  for (const s of ['board', 'boarddeparted', 'onboard']) add(c, s, PHONE);
  add(c, 'onboard', SHORT);
  add(c, 'board', SHORT);
  add(c, 'board', PHONE, 'light');
  add(c, 'onboard', PHONE, 'light');
}
/* Stress sweep for the strip concepts too: a focused journey whose connection
   went tight, and one whose second leg was cancelled, still has to be glanced. */
for (const c of B) { add(c, 'tight', PHONE); add(c, 'cancelled', PHONE); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const [argC, argS] = process.argv.slice(2);
  const jobs = JOBS.filter((j) => (!argC || j.c === argC) && (!argS || j.s === argS));
  if (!jobs.length) throw new Error('no jobs matched');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tc2-prof-'));
  const chrome = spawn(CHROME, [
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
    for (const j of jobs) await shoot(page, j);
    console.log(`\n${jobs.length} shots -> ${OUT}`);
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill('SIGKILL');
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

async function shoot(page, { c, s, v, scheme }) {
  const name = [c, v.tag, s, scheme === 'light' ? 'light' : ''].filter(Boolean).join('-');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: v.w, height: v.h, deviceScaleFactor: 2, mobile: true
  });
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }]
  });
  await page.send('Page.navigate', { url: `file://${DIR}/${c}.html?s=${s}` });
  await sleep(240);

  const probe = await page.send('Runtime.evaluate', {
    expression: `(()=>{const d=document.documentElement;
      let over=0,otag='',under=0,utag='';
      document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();
        if(!r.width||!r.height) return;
        if(getComputedStyle(e).position==='absolute') return;
        if(r.right>d.clientWidth+0.5&&r.right-d.clientWidth>over){over=Math.round(r.right-d.clientWidth);otag=e.className||e.tagName;}
        if(r.bottom>d.clientHeight+0.5&&r.bottom-d.clientHeight>under){under=Math.round(r.bottom-d.clientHeight);utag=e.className||e.tagName;}});
      return JSON.stringify({w:d.clientWidth,h:d.clientHeight,over,otag,under,utag});})()`,
    returnByValue: true
  });
  const r = JSON.parse(probe.result.value);
  if (r.w !== v.w) throw new Error(`VIEWPORT LIE: asked ${v.w}, got ${r.w}`);
  if (r.h !== v.h) throw new Error(`VIEWPORT LIE (height): asked ${v.h}, got ${r.h}`);

  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
  console.log('  ' + name + '.png'
    + (r.over ? `   OVERFLOW +${r.over}px (${r.otag})` : '')
    + (r.under ? `   BELOW FOLD +${r.under}px (${r.utag})` : ''));
}

async function waitForDevtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await res.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(100);
  }
  throw new Error('Chrome devtools endpoint never came up');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id); pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
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
      close: () => sock.close()
    });
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
