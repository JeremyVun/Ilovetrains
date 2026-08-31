/* Screenshot instrument.
 *
 * TRAP FOUND THE HARD WAY: `chrome --headless --window-size=390,844 --screenshot`
 * silently clamps the layout viewport to 500 CSS px on macOS and then crops the
 * image to 390@2x. Every "mobile" shot taken that way is a lie — content that
 * overflows 390 looks fine because it was laid out at 500. Always assert
 * document.documentElement.clientWidth after the override.
 *
 * So: drive CDP directly and use Emulation.setDeviceMetricsOverride, which is
 * not clamped. Node's global WebSocket means no npm dependency, and Chrome is
 * killed in a finally so no orphan trees.
 *
 * Usage: node shoot.js                       all comps, all sizes
 *        node shoot.js c-countdown           one concept, all scenarios
 *        node shoot.js c-countdown delayed   one shot
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = '/tmp/trains_comps';
const OUT = path.join(DIR, 'shots');
const PORT = 9333;

const CONCEPTS = ['a-solari', 'b-editorial', 'c-countdown', 'd-river'];
const STRESS = ['delayed', 'cancelled', 'scheduled', 'stale', 'long'];
const MOBILE = { w: 390, h: 844, tag: '390x844', mobile: true };
const DESK = { w: 1280, h: 800, tag: '1280x800', mobile: false };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-prof-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--allow-file-access-from-files', 'about:blank'
  ], { stdio: 'ignore' });

  let ws;
  try {
    const wsUrl = await waitForDevtools();
    ws = await connect(wsUrl);
    const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await ws.send('Target.attachToTarget', { targetId, flatten: true });
    const page = ws.session(sessionId);
    await page.send('Page.enable');

    const jobs = buildJobs();
    for (const j of jobs) await shoot(page, j);
    console.log(`\n${jobs.length} shots -> ${OUT}`);
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill('SIGKILL');
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

function buildJobs() {
  const [argConcept, argScenario] = process.argv.slice(2);
  const concepts = argConcept ? [argConcept] : CONCEPTS;
  const jobs = [];
  if (argScenario) {
    for (const c of concepts) { jobs.push({ c, s: argScenario, v: MOBILE }); jobs.push({ c, s: argScenario, v: DESK }); }
    return jobs;
  }
  for (const c of concepts) { jobs.push({ c, s: 'hero', v: MOBILE }); jobs.push({ c, s: 'hero', v: DESK }); }
  for (const c of concepts) for (const s of STRESS) jobs.push({ c, s, v: MOBILE });
  // desktop reads of the hardest content for the leading pair
  for (const c of ['b-editorial', 'c-countdown']) for (const s of ['delayed', 'long']) jobs.push({ c, s, v: DESK });
  return jobs.filter((j) => !argConcept || j.c === argConcept);
}

async function shoot(page, { c, s, v }) {
  const name = c + '-' + v.tag + (s === 'hero' ? '' : '-' + s);
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: v.w, height: v.h, deviceScaleFactor: 2, mobile: v.mobile
  });
  const url = `file://${DIR}/${c}.html` + (s === 'hero' ? '' : `?s=${s}`);
  await page.send('Page.navigate', { url });
  await sleep(260);

  // Assert the instrument is actually showing the width it claims, and report
  // any horizontal overflow rather than cropping it away silently.
  const probe = await page.send('Runtime.evaluate', {
    expression: `(()=>{const d=document.documentElement;
      let over=0,tag='';
      document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();
        if(r.right>d.clientWidth+0.5&&r.width>0&&getComputedStyle(e).position!=='absolute'){
          if(r.right-d.clientWidth>over){over=Math.round(r.right-d.clientWidth);tag=e.className||e.tagName;}}});
      return JSON.stringify({w:d.clientWidth,over,tag});})()`,
    returnByValue: true
  });
  const r = JSON.parse(probe.result.value);
  if (r.w !== v.w) throw new Error(`VIEWPORT LIE: asked ${v.w}, got ${r.w}`);

  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
  console.log(`  ${name}.png` + (r.over ? `   ⚠ overflow +${r.over}px (${r.tag})` : ''));
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
