/* Screenshot instrument for /tmp/trains_comps3 (BOARD V2).
 *
 * Inherited from /tmp/trains_comps2/shoot.js. The repo is NOT modified.
 *
 * TRAP 1 (round 1, still live): `chrome --headless --window-size=390,844
 * --screenshot` silently clamps the layout viewport to 500 CSS px on macOS and
 * then crops the PNG, so every "mobile" shot taken that way is a lie. This
 * drives CDP with Emulation.setDeviceMetricsOverride (not clamped) and ASSERTS
 * clientWidth AND clientHeight, refusing to save otherwise.
 * TRAP 2: with mobile:true and no <meta name="viewport">, Chrome lays out at
 * 980px. Every comp carries the viewport meta a real PWA ships.
 * TRAP 3 (round 2): report anything past the FOLD, not just past the right edge.
 * That probe found round 2's biggest result and it is kept.
 * NEW this round, two probes, because this round makes two claims a screenshot
 * cannot check on its own:
 *   - every tap target must clear 44px (complaint 4);
 *   - the scroller's scrollTop and extent, because "the board must never open
 *     scrolled into the past" (complaint 1) is invisible in a PNG.
 *
 * Usage: node shoot.js                      everything
 *        node shoot.js c1-platformtab       one concept
 *        node shoot.js c1-platformtab past  one concept, one scenario
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = '/tmp/trains_comps8';
const OUT = path.join(DIR, 'shots');
const PORT = 9401;

const PHONE = { w: 390, h: 844, tag: '390x844' };
const SHORT = { w: 412, h: 732, tag: '412x732' };

const BOARD = ['board'];
const HOME = ['home'];
const C = BOARD.concat(HOME);

const JOBS = [];
const add = (c, s, v, scheme) => JOBS.push({ c, s, v, scheme: scheme || 'dark' });

for (const c of BOARD) {
  add(c, 'hero', PHONE);
  add(c, 'hero', SHORT);
  add(c, 'past', PHONE);
  /* `landing` is the SAME past-scenario data rendered unscrolled: the only way
     to photograph "the board lands at now and never opens inside the past". */
  add(c, 'landing', PHONE);
  add(c, 'deep', PHONE);
  add(c, 'delayed', PHONE);
  add(c, 'cancelled', PHONE);
  add(c, 'tight', PHONE);
  add(c, 'long', PHONE);
  add(c, 'long', SHORT);
  add(c, 'focused', PHONE);
  add(c, 'riding', PHONE);
  add(c, 'hero', PHONE, 'light');
}
/* the structural pair this round has to decide with pixels */
add('board-nostrip', 'riding', PHONE);
add('board-nostrip', 'focused', PHONE);
add('board-nostrip', 'riding', SHORT);
add('board', 'riding', SHORT);

/* HOME. The `vis` count reports whole TRIP ROWS inside the index (they carry
   `data-svc`), not services: home fetches exactly one live thing, and that one
   thing is the header, which sits outside the scroller on purpose.
   The seven tracking frames are one journey read at seven times of day. */
const LADDER = ['before', 'leave', 'board', 'change', 'final', 'arrive', 'done'];
for (const c of HOME) {
  for (const s of LADDER) add(c, s, PHONE);
  add(c, 'tight', PHONE);
  add(c, 'cxl', PHONE);
  add(c, 'wide', PHONE);
  add(c, 'back', PHONE);
  add(c, 'moved', PHONE);
  add(c, 'nofix', PHONE);
  add(c, 'ask', PHONE);
  add(c, 'many', PHONE);
  add(c, 'add', PHONE);
  add(c, 'save', PHONE);
  add(c, 'change', SHORT);
  add(c, 'before', SHORT);
  add(c, 'many', SHORT);
  add(c, 'add', SHORT);
  add(c, 'change', PHONE, 'light');
  add(c, 'before', PHONE, 'light');
  add(c, 'tight', PHONE, 'light');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const [argC, argS] = process.argv.slice(2);
  const jobs = JOBS.filter((j) => (!argC || j.c === argC) && (!argS || j.s === argS));
  if (!jobs.length) throw new Error('no jobs matched');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tc3-prof-'));
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
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
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
  await sleep(260);

  const probe = await page.send('Runtime.evaluate', {
    expression: `(()=>{const d=document.documentElement;
      let over=0,otag='',under=0,utag='';const small=[];
      document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();
        if(!r.width||!r.height) return;
        if(getComputedStyle(e).position==='absolute') return;
        if(r.right>d.clientWidth+0.5&&r.right-d.clientWidth>over){over=Math.round(r.right-d.clientWidth);otag=e.className||e.tagName;}
        if(r.bottom>d.clientHeight+0.5&&r.bottom-d.clientHeight>under){under=Math.round(r.bottom-d.clientHeight);utag=e.className||e.tagName;}});
      document.querySelectorAll('button,.tripr,.led-row').forEach(e=>{
        const r=e.getBoundingClientRect();
        if(r.height>0&&r.height<44) small.push((e.className||e.tagName)+':'+Math.round(r.height));});
      const sc=document.querySelector('.tl,.rows,.sh,.led');
      /* INSTRUMENT TRAP, found 2026-09-01: the fold probe above compares against
         the VIEWPORT, so a row clipped by an overflow:auto scroller whose bottom
         still falls inside the viewport is invisible to it. Every direction in
         this round puts the services inside a scroller, so the count that matters
         is measured against the SCROLLER's box, not the document's. */
      let vis=0;
      if(sc){const b=sc.getBoundingClientRect();
        document.querySelectorAll('[data-svc]:not([data-past])').forEach(e=>{
          const r=e.getBoundingClientRect();
          if(r.height>4&&r.top>=b.top-0.5&&r.bottom<=b.bottom+0.5) vis++;});}
      return JSON.stringify({w:d.clientWidth,h:d.clientHeight,over,otag,under,utag,
        small:Array.from(new Set(small)).slice(0,4),
        vis,
        top:sc?Math.round(sc.scrollTop):-1, ext:sc?Math.round(sc.scrollHeight-sc.clientHeight):-1});})()`,
    returnByValue: true
  });
  const r = JSON.parse(probe.result.value);
  if (r.w !== v.w) throw new Error(`VIEWPORT LIE: asked ${v.w}, got ${r.w}`);
  if (r.h !== v.h) throw new Error(`VIEWPORT LIE (height): asked ${v.h}, got ${r.h}`);

  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
  console.log('  ' + name + '.png'
    + (r.over ? `   OVERFLOW +${r.over}px (${r.otag})` : '')
    + (r.under ? `   BELOW FOLD +${r.under}px (${r.utag})` : '')
    + (r.small.length ? `   TAP<44 ${r.small.join(' ')}` : '')
    + (r.vis ? `   ${r.vis} whole services in the scroller` : '')
    + (r.ext > 0 ? `   scroll ${r.top}/${r.ext}` : ''));
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
