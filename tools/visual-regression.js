#!/usr/bin/env node
/* Visual regression across the three clients in one command: shoot every
 * screen the web, Android and iOS shooters can reproduce, compare each frame
 * pixel for pixel with the committed baseline, and write a report whose diff
 * composites show exactly which pixels moved.
 *
 * Usage
 *   node tools/visual-regression.js [--platform web,android,ios] [--screens a,b]
 *          [--out DIR] [--compare DIR] [--accept] [--threshold N] [--fuzz N] [--list]
 *
 * Every platform is required unless `--platform` narrows the run; a platform
 * whose device is missing or whose shooter fails is reported, not skipped
 * silently. `--out` defaults to a fresh /tmp/trains-visual-<stamp>. `--compare`
 * re-runs the comparison on a capture directory without shooting. `--accept`
 * writes every captured frame into tools/baselines/ after the comparison and
 * records the capturing device in its manifest.
 *
 * A frame passes when no pixel differs by more than `--fuzz` (default 1: the
 * emulator's rasteriser flips a lone pixel by one level between runs, which no
 * screen can show) in any channel, and the count of pixels over that never
 * exceeds `--threshold` (default 0). The report lists the count, the worst channel delta and the
 * bands of the frame that moved, and writes baseline | current | diff
 * composites, so a small difference can be justified by looking rather than
 * by widening the threshold. iOS frames ignore the simulator status bar,
 * whose glyphs shift a channel level between launches.
 *
 * Exit status is non-zero when any requested frame differs, is missing, or
 * has no baseline yet (accept it).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const chrome = require('./comps/chrome.js');
const { bands, describeBands } = require('./comps/diff.js');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(ROOT, 'tools/baselines');
const PLATFORMS = ['web', 'android', 'ios'];
const ADB = path.join(process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk'), 'platform-tools/adb');

/* One row per screen: the platform-native state that shows it, or null where a
   platform has no equivalent. Web entries are shoot-states names with optional
   `@light` and `@WxH`; `settings:<frame>` names a check-settings-browser frame. */
const SCREENS = [
  ['home', 'home-before', 'home', 'home'],
  ['home-light', 'home-before@light', 'home-light', 'home-light'],
  ['home-412', 'mascot-before@412x732', null, null],
  ['home-pinned', 'mascot-pinned-before', null, 'home-pinned'],
  ['home-active', 'mascot-active', 'home-active-pinned', 'home-active'],
  ['home-active-light', 'mascot-active@light', 'home-active-pinned-light', null],
  ['home-inferred', 'home-inferred', 'home-active-inferred', 'home-inferred'],
  ['home-change', 'home-change', null, null],
  ['home-late', 'home-late', null, null],
  ['home-cancelled', 'home-cancelled', null, null],
  ['home-focused-cancelled', 'home-focused-cancelled', null, null],
  ['home-just-added', 'home-here-pair', null, null],
  ['home-services-filtered', 'settings:home-390x844-services-filtered.png', null, null],
  ['home-completed', null, 'home-completed', null],
  ['home-long-names', null, 'home-long-names', null],
  ['home-now', null, 'home-now', null],
  ['home-now-light', null, 'home-now-light', null],
  ['home-offline-retained', null, 'home-offline-retained-t9', null],
  ['home-offline', null, null, 'home-offline'],
  ['home-deleting', null, 'home-deleting', null],
  ['home-deleted', null, 'home-deleted', 'home-deleted'],
  ['board', 'on-time', 'board', 'board'],
  ['board-light', 'on-time@light', 'board-light', 'board-light'],
  ['board-412', 'short-on-time', null, null],
  ['board-412-end', 'short-on-time-scrolled', null, null],
  ['board-delayed', 'delayed', 'board-delayed', 'board-delayed'],
  ['board-cancelled', 'cancelled', null, null],
  ['board-past', 'past-register-scrolled', null, null],
  ['board-long-names', 'long-names', null, null],
  ['board-two-change', 'board-two-change', null, null],
  ['board-ferry', 'ferry-pyrmont', null, null],
  ['board-end', null, 'board-end', null],
  ['board-transfer', null, 'board-transfer', null],
  ['board-transfer-light', null, 'board-transfer-light', null],
  ['board-now', null, 'board-now', null],
  ['board-now-light', null, 'board-now-light', null],
  ['board-offline-retained', null, 'board-offline-retained-t9', null],
  ['board-offline', null, null, 'board-offline'],
  ['detail', 'detail-hero', 'detail', 'detail'],
  ['detail-light', 'detail-hero@light', null, 'detail-light'],
  ['detail-412', 'detail-hero@412x732', null, null],
  ['detail-cancelled', 'detail-cancelled', 'detail-cancelled', 'detail-cancelled'],
  ['detail-two-change', null, 'detail-two-changes', 'detail-two-change'],
  ['detail-direct', 'detail-direct', null, null],
  ['detail-tight', 'detail-tight', null, null],
  ['detail-long', 'detail-long', null, null],
  ['detail-departed', 'detail-departed', null, null],
  ['detail-focused', 'detail-focused', null, null],
  ['detail-ferry', 'ferry-pyrmont-detail', 'detail-pyrmont-double-bay', 'ferry'],
  ['detail-ferry-manly', 'ferry-numeric-detail', 'detail-f1-manly', null],
  ['detail-offline', null, null, 'detail-offline'],
  ['setup', 'setup-origin', 'setup', 'setup'],
  ['settings', 'settings:settings-390x844.png', 'settings', 'settings'],
  ['settings-light', 'settings:settings-390x844-light.png', 'settings-light', 'settings-light'],
  ['settings-412', 'settings:settings-412x732.png', null, null],
  ['settings-transfer-limit', 'settings:settings-390x844-transfer-limit.png', 'settings-transfer-limit', 'settings-transfer-limit'],
  ['settings-transfer-limit-any', 'settings:settings-390x844-transfer-limit-any.png', null, 'settings-transfer-limit-no-limit'],
  ['settings-transfer-limit-light', 'settings:settings-390x844-transfer-limit-light.png', 'settings-transfer-limit-light', 'settings-transfer-limit-light'],
  ['settings-transfer-limit-412', 'settings:settings-412x732-transfer-limit.png', null, null]
].map(([screen, web, android, ios]) => ({ screen, web, android, ios }));

const MASKS = { ios: [{ top: 190 }, { bottom: 60 }] };
const WEB_JOBS = Number(process.env.VISUAL_WEB_JOBS || 10);
const WEB_CHUNK = Number(process.env.VISUAL_WEB_CHUNK || 4);

const run = (cmd, args, env = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) return resolve(output);
    const lines = output.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    reject(new Error(lines.find((l) => /^(\w*Error: |EVAL FAILED)/.test(l)) || lines[lines.length - 1] || `exit ${code}`));
  });
});

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

const portFree = (port) => new Promise((resolve) => {
  const probe = net.createServer();
  probe.once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});

/** check-settings-browser drives CDP_PORT through CDP_PORT+3 at once. */
async function freePortRun(count) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const base = await freePort();
    const checks = await Promise.all(Array.from({ length: count }, (_, i) => portFree(base + i)));
    if (checks.every(Boolean)) return base;
  }
  throw new Error(`no run of ${count} free ports`);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.txt': 'text/plain'
};

/* The client's test seams exist only on the hostname `localhost`; 127.0.0.1
   photographs an app with no reset seam and the sweep fails on its first state. */
function serveWeb() {
  const root = path.join(ROOT, 'web');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = path.normalize(path.join(root, pathname));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', () => resolve({ url: `http://localhost:${server.address().port}/`, close: () => server.close() }));
  });
}

async function parallel(jobs, limit) {
  const queue = jobs.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  });
  await Promise.all(workers);
}

function parseWeb(spec) {
  if (spec.startsWith('settings:')) return { kind: 'settings', file: spec.slice('settings:'.length) };
  const [state, ...options] = spec.split('@');
  const light = options.includes('light');
  const size = options.find((o) => /^\d+x\d+$/.test(o)) || null;
  return { kind: 'state', state, light, size };
}

async function shootWeb(screens, out, log) {
  const dir = path.join(out, 'web');
  fs.mkdirSync(dir, { recursive: true });
  const missing = {};
  const groups = new Map();
  const settings = [];
  for (const screen of screens) {
    const spec = parseWeb(screen.web);
    if (spec.kind === 'settings') { settings.push({ screen, spec }); continue; }
    const key = `${spec.light ? 'light' : 'dark'}|${spec.size || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ screen, spec });
  }
  const jobs = [];
  const server = await serveWeb();
  for (const [key, list] of groups) {
    const [scheme, size] = key.split('|');
    const chunks = [];
    for (let i = 0; i < list.length; i += WEB_CHUNK) chunks.push(list.slice(i, i + WEB_CHUNK));
    for (const chunk of chunks) {
      jobs.push(async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-visual-web-'));
        const prefix = scheme === 'light' ? 'light-' : '';
        const args = [path.join(ROOT, 'tools/shoot-states.js'), ...chunk.map((c) => c.spec.state), '--url', server.url, '--out', tmp];
        if (scheme === 'light') args.push('--media', 'prefers-color-scheme:light', '--prefix', prefix);
        if (size) args.push('--size', size);
        try {
          await run(process.execPath, args, { CDP_PORT: String(await freePort()) });
          for (const { screen, spec } of chunk) {
            const shot = fs.readdirSync(tmp).find((f) => f.startsWith(`${prefix}${spec.state}-`) && f.endsWith('.png'));
            if (shot) fs.copyFileSync(path.join(tmp, shot), path.join(dir, `${screen.screen}.png`));
            else missing[screen.screen] = `shoot-states wrote no frame for ${spec.state}`;
          }
        } catch (e) {
          for (const { screen } of chunk) missing[screen.screen] = `shoot-states: ${e.message}`;
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
        log(`web: ${chunk.length} ${scheme}${size ? ` ${size}` : ''} frames`);
      });
    }
  }
  if (settings.length) {
    jobs.push(async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-visual-settings-'));
      try {
        await run(process.execPath, [path.join(ROOT, 'tools/check-settings-browser.js'), '--url', server.url, '--frames', tmp],
          { CDP_PORT: String(await freePortRun(4)) });
        for (const { screen, spec } of settings) {
          const shot = path.join(tmp, spec.file);
          if (fs.existsSync(shot)) fs.copyFileSync(shot, path.join(dir, `${screen.screen}.png`));
          else missing[screen.screen] = `check-settings-browser wrote no ${spec.file}`;
        }
      } catch (e) {
        for (const { screen } of settings) missing[screen.screen] = `check-settings-browser: ${e.message}`;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      log(`web: ${settings.length} settings frames`);
    });
  }
  try {
    await parallel(jobs, WEB_JOBS);
  } finally {
    server.close();
  }
  let device = 'Chromium';
  try { device = execFileSync(chrome.chromeBinary(), ['--version']).toString().trim(); } catch (_) { /* the frames were still shot */ }
  return { device: `${device}, 390x844 css @2x`, missing };
}

async function shootAndroid(screens, out, log) {
  const dir = path.join(out, 'android');
  fs.mkdirSync(dir, { recursive: true });
  let state = '';
  try { state = execFileSync(ADB, ['get-state'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) { /* no adb or device */ }
  if (state !== 'device') throw new Error('one booted Android emulator is required (adb get-state)');
  await waitForPeer('shoot-android.sh|am instrument', 'android', log);
  const tmp = path.join(os.tmpdir(), `trains-visual-android-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  const missing = {};
  let metrics = '';
  try {
    await run('bash', [path.join(ROOT, 'tools/shoot-android.sh'), '390x844'],
      { OUT: tmp, INSTRUMENT_CLASS: 'com.ilovetrains.app.UiCalibrationTest#captureCanonicalScreens' });
    metrics = fs.readFileSync(path.join(tmp, 'metrics.txt'), 'utf8').trim().replace(/\n/g, ' ');
    for (const screen of screens) {
      const shot = path.join(tmp, `${screen.android}.png`);
      if (fs.existsSync(shot)) fs.copyFileSync(shot, path.join(dir, `${screen.screen}.png`));
      else missing[screen.screen] = `UiCalibrationTest wrote no ${screen.android}.png`;
    }
  } catch (e) {
    for (const screen of screens) missing[screen.screen] = `shoot-android: ${e.message}`;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const prop = (name) => { try { return execFileSync(ADB, ['shell', 'getprop', name]).toString().trim(); } catch (_) { return '?'; } };
  log(`android: ${screens.length - Object.keys(missing).length} frames`);
  return { device: `${prop('ro.product.model')} API ${prop('ro.build.version.sdk')}, ${metrics}`, missing };
}

async function shootIos(screens, out, log) {
  const dir = path.join(out, 'ios');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(os.tmpdir(), `trains-visual-ios-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  const missing = {};
  let metrics = '';
  let simulatorName = '';
  try {
    const simulator = bootedIphone();
    await waitForPeer('shoot-ios.sh', 'ios', log);
    await run('bash', [path.join(ROOT, 'tools/shoot-ios.sh'), ...screens.map((s) => s.ios)],
      { OUT: tmp, ILOVETRAINS_SIMULATOR_ID: simulator, SETTLE_SECONDS: process.env.SETTLE_SECONDS || '2' });
    const fields = Object.fromEntries(fs.readFileSync(path.join(tmp, 'metrics.txt'), 'utf8').trim().split('\n').map((l) => l.split('=')));
    metrics = `${fields.device} ${fields.capture_pixels}px, content size ${fields.content_size}`;
    simulatorName = fields.device;
    for (const screen of screens) {
      const shot = path.join(tmp, `${screen.ios}.png`);
      if (fs.existsSync(shot)) fs.copyFileSync(shot, path.join(dir, `${screen.screen}.png`));
      else missing[screen.screen] = `shoot-ios wrote no ${screen.ios}.png`;
    }
  } catch (e) {
    for (const screen of screens) missing[screen.screen] = `shoot-ios: ${e.message}`;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  log(`ios: ${screens.length - Object.keys(missing).length} frames`);
  return { device: metrics, simulator: simulatorName, missing };
}

const SHOOT = { web: shootWeb, android: shootAndroid, ios: shootIos };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* One emulator and one simulator serve every session on this machine; a peer's
   drive mid-flight would put its frames, or its display size, into ours. */
async function waitForPeer(pattern, label, log) {
  const busy = () => { try { return execFileSync('pgrep', ['-f', pattern]).toString().trim() !== ''; } catch (_) { return false; } };
  if (!busy()) return;
  log(`${label}: waiting for a peer's drive to finish`);
  const deadline = Date.now() + 10 * 60 * 1000;
  while (busy()) {
    if (Date.now() > deadline) throw new Error(`a peer's drive (${pattern}) held the device for ten minutes`);
    await sleep(3000);
  }
}

function bootedIphone() {
  if (process.env.ILOVETRAINS_SIMULATOR_ID) return process.env.ILOVETRAINS_SIMULATOR_ID;
  const listing = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']).toString());
  const booted = Object.values(listing.devices).flat().filter((d) => d.name.includes('iPhone'));
  if (booted.length === 1) return booted[0].udid;
  if (!booted.length) throw new Error('no booted iPhone simulator');
  const manifestFile = path.join(BASELINE, 'manifest.json');
  const wanted = fs.existsSync(manifestFile) ? (JSON.parse(fs.readFileSync(manifestFile, 'utf8')).ios || {}).simulator : null;
  const match = booted.find((d) => d.name === wanted);
  if (match) return match.udid;
  throw new Error(`several iPhone simulators are booted (${booted.map((d) => d.name).join(', ')}); set ILOVETRAINS_SIMULATOR_ID`);
}

/* Both PNGs are decoded by Chrome and compared through getImageData; the same
   decoder the web frames came from. Differing pixels are painted in the house
   accent over a dimmed copy of the current frame, beside baseline and current. */
const COMPARE = `(async (a, b, fuzz, masks) => {
  const load = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode a frame'));
    img.src = src;
  });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  if (ia.width !== ib.width || ia.height !== ib.height) {
    return { sizeMismatch: true, size: [ia.width, ia.height, ib.width, ib.height] };
  }
  const w = ia.width, h = ia.height;
  const canvas = (width, height) => {
    const c = new OffscreenCanvas(width, height);
    return [c, c.getContext('2d', { willReadFrequently: true })];
  };
  const pixels = (img) => { const [, x] = canvas(w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
  const pa = pixels(ia), pb = pixels(ib);
  const maskedRow = (y) => masks.some((m) => (m.top && y < m.top) || (m.bottom && y >= h - m.bottom));
  const rows = [];
  let differs = 0, worst = 0;
  const hits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    if (maskedRow(y)) continue;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i+1] - pb[i+1]),
                         Math.abs(pa[i+2] - pb[i+2]), Math.abs(pa[i+3] - pb[i+3]));
      if (d <= fuzz) continue;
      differs++;
      hits[y * w + x] = 1;
      if (d > worst) worst = d;
      const row = rows[y] || (rows[y] = { y, px: 0, x0: x, x1: x });
      row.px++;
      if (x < row.x0) row.x0 = x;
      if (x > row.x1) row.x1 = x;
    }
  }
  const result = { sizeMismatch: false, differs, total: w * h, worst, size: [w, h], rows: rows.filter(Boolean) };
  if (!differs) return result;
  const gap = 24;
  const [c, x] = canvas(w * 3 + gap * 2, h);
  x.fillStyle = '#0A0B0D'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(ia, 0, 0);
  x.drawImage(ib, w + gap, 0);
  x.globalAlpha = 0.22; x.drawImage(ib, (w + gap) * 2, 0); x.globalAlpha = 1;
  const panel = x.getImageData((w + gap) * 2, 0, w, h);
  for (let p = 0; p < hits.length; p++) {
    if (!hits[p]) continue;
    panel.data[p * 4] = 255; panel.data[p * 4 + 1] = 122; panel.data[p * 4 + 2] = 92; panel.data[p * 4 + 3] = 255;
  }
  x.putImageData(panel, (w + gap) * 2, 0);
  const blob = await c.convertToBlob({ type: 'image/png' });
  result.png = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
  return result;
})`;

const dataUrl = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

async function compareAll(pairs, { fuzz }) {
  if (!pairs.length) return [];
  return chrome.withPage(async (page) => {
    await chrome.frame(page, { url: 'about:blank', width: 390, height: 844, dsf: 1, settle: 40 })
      .catch(() => { /* about:blank ships no viewport meta; the diff never lays out */ });
    const results = [];
    for (const pair of pairs) {
      const masks = MASKS[pair.platform] || [];
      const expression = `${COMPARE}(${JSON.stringify(dataUrl(pair.baseline))}, ${JSON.stringify(dataUrl(pair.current))}, ${fuzz}, ${JSON.stringify(masks)})`;
      results.push({ ...pair, ...await chrome.evaluate(page, expression) });
    }
    return results;
  });
}

function classify(results, threshold) {
  for (const r of results) {
    if (r.status) continue;
    r.status = r.sizeMismatch || r.differs > threshold ? 'DIFF' : 'same';
    if (r.sizeMismatch) r.detail = `size ${r.size[0]}x${r.size[1]} vs ${r.size[2]}x${r.size[3]}`;
    else if (r.differs) r.detail = `${r.differs} px, worst channel ${r.worst}`;
    else r.detail = '';
  }
}

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0A0B0D; color: #F4F5F7;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  header { padding: 34px 34px 8px; }
  h1 { font-size: 26px; font-weight: 300; letter-spacing: -.02em; margin: 0 0 12px; }
  h2 { font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; margin: 40px 0 4px; padding: 0 34px; }
  p { color: rgba(244,245,247,.72); margin: 0 0 8px; max-width: 84ch; }
  table { border-collapse: collapse; margin: 10px 34px 4px; font-size: 13px; }
  th, td { text-align: left; padding: 5px 16px 5px 0; border-bottom: 1px solid rgba(244,245,247,.10); color: rgba(244,245,247,.72); vertical-align: top; }
  th { font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: #F4F5F7; }
  td.k { color: #F4F5F7; white-space: nowrap; }
  .DIFF, .MISSING { color: #FF7A5C; } .NEW { color: #F5C451; } .same { color: rgba(244,245,247,.46); }
  .row { display: flex; gap: 18px; overflow-x: auto; padding: 14px 34px 8px; align-items: flex-start; }
  figure { margin: 0; flex: none; width: 250px; }
  figure img { width: 250px; display: block; border: 1px solid rgba(244,245,247,.16); }
  figure.DIFF img { border-color: #FF7A5C; } figure.NEW img { border-color: #F5C451; }
  figure.composite { width: 100%; } figure.composite img { width: 100%; max-width: 1400px; }
  figcaption { font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
    color: rgba(244,245,247,.46); padding-top: 8px; line-height: 1.6; }
  figcaption b { color: #F4F5F7; }
  code { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #F4F5F7; }
`;

function writeReport(out, results, platforms, capture, options) {
  const byScreen = new Map();
  for (const r of results) {
    if (!byScreen.has(r.screen)) byScreen.set(r.screen, {});
    byScreen.get(r.screen)[r.platform] = r;
  }
  const bad = results.filter((r) => r.status !== 'same');
  const rel = (file) => path.relative(out, file);
  let html = `<!doctype html><meta charset="utf-8"><title>Visual regression</title><style>${STYLE}</style>`;
  html += `<header><h1>Visual regression · ${escape(new Date().toISOString().slice(0, 16).replace('T', ' '))}</h1>`;
  html += `<p>${bad.length ? `<b>${bad.length}</b> of ${results.length} frames need a look` : `All ${results.length} frames match their baseline`}`
    + ` · fuzz ${options.fuzz} · threshold ${options.threshold} px.</p>`;
  for (const platform of platforms) {
    html += `<p><code>${platform}</code> ${escape(capture[platform] && capture[platform].device || 'not captured')}</p>`;
  }
  html += '</header>';
  html += '<h2>Frames</h2><table><tr><th>Screen</th>' + platforms.map((p) => `<th>${p}</th>`).join('') + '</tr>';
  for (const [screen, row] of byScreen) {
    html += `<tr><td class="k">${escape(screen)}</td>` + platforms.map((p) => {
      const r = row[p];
      if (!r) return '<td>·</td>';
      return `<td class="${r.status}">${r.status}${r.detail ? ` <small>${escape(r.detail)}</small>` : ''}</td>`;
    }).join('') + '</tr>';
  }
  html += '</table>';
  for (const [screen, row] of byScreen) {
    html += `<h2>${escape(screen)}</h2><div class="row">`;
    for (const platform of platforms) {
      const r = row[platform];
      if (!r) continue;
      const src = r.current || r.baseline;
      html += `<figure class="${r.status}">${src ? `<img src="${escape(rel(src))}" loading="lazy">` : ''}`
        + `<figcaption><b>${platform}</b> · ${r.status}${r.detail ? ` · ${escape(r.detail)}` : ''}</figcaption></figure>`;
    }
    html += '</div>';
    for (const platform of platforms) {
      const r = row[platform];
      if (!r || !r.composite) continue;
      html += `<div class="row"><figure class="composite"><img src="${escape(rel(r.composite))}" loading="lazy">`
        + `<figcaption><b>${platform}</b> · baseline · current · diff${r.bands ? ` · ${escape(r.bands.replace(/\n\s+/g, ' / '))}` : ''}</figcaption></figure></div>`;
    }
  }
  fs.writeFileSync(path.join(out, 'report.html'), html);
}

function accept(results, capture) {
  const manifestFile = path.join(BASELINE, 'manifest.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  let commit = 'unknown';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch (_) { /* outside git */ }
  const touched = new Set();
  for (const r of results) {
    if (!r.current || r.status === 'same') continue;
    fs.mkdirSync(path.join(BASELINE, r.platform), { recursive: true });
    fs.copyFileSync(r.current, path.join(BASELINE, r.platform, `${r.screen}.png`));
    r.status = 'accepted';
    r.detail = `was ${r.detail}`;
    touched.add(r.platform);
  }
  for (const platform of touched) {
    const previous = manifest[platform] || {};
    const shot = capture[platform] || {};
    manifest[platform] = { commit, date: new Date().toISOString().slice(0, 10), device: shot.device || previous.device || '' };
    if (shot.simulator || previous.simulator) manifest[platform].simulator = shot.simulator || previous.simulator;
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return touched;
}

function parseArgs(argv) {
  const options = { platforms: PLATFORMS, screens: null, out: null, compare: null, accept: false, threshold: 0, fuzz: 1, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform') options.platforms = argv[++i].split(',');
    else if (a === '--screens') options.screens = argv[++i].split(',');
    else if (a === '--out') options.out = path.resolve(argv[++i]);
    else if (a === '--compare') options.compare = path.resolve(argv[++i]);
    else if (a === '--accept') options.accept = true;
    else if (a === '--threshold') options.threshold = Number(argv[++i]);
    else if (a === '--fuzz') options.fuzz = Number(argv[++i]);
    else if (a === '--list') options.list = true;
    else throw new Error(`unknown argument ${a}`);
  }
  const unknownPlatform = options.platforms.find((p) => !PLATFORMS.includes(p));
  if (unknownPlatform) throw new Error(`unknown platform ${unknownPlatform}; use ${PLATFORMS.join(', ')}`);
  if (options.screens) {
    const unknown = options.screens.find((s) => !SCREENS.some((row) => row.screen === s));
    if (unknown) throw new Error(`unknown screen ${unknown}; --list names them`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    console.log(['screen'.padEnd(24), ...PLATFORMS.map((p) => p.padEnd(30))].join(''));
    for (const row of SCREENS) console.log([row.screen.padEnd(24), ...PLATFORMS.map((p) => (row[p] || '·').padEnd(30))].join(''));
    return;
  }
  const chosen = options.screens ? SCREENS.filter((row) => options.screens.includes(row.screen)) : SCREENS;
  const out = options.compare || options.out || path.join(os.tmpdir(), `trains-visual-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
  fs.mkdirSync(out, { recursive: true });
  const log = (line) => console.log(`  ${line}`);

  let capture = {};
  if (options.compare) {
    const captureFile = path.join(out, 'capture.json');
    if (fs.existsSync(captureFile)) capture = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
    else for (const platform of options.platforms) capture[platform] = { device: '', missing: {} };
  } else {
    console.log(`shooting ${options.platforms.join(', ')} into ${out}`);
    await Promise.all(options.platforms.map(async (platform) => {
      const screens = chosen.filter((row) => row[platform]);
      try {
        capture[platform] = await SHOOT[platform](screens, out, log);
      } catch (e) {
        capture[platform] = { device: '', missing: Object.fromEntries(screens.map((s) => [s.screen, e.message])) };
        log(`${platform}: ${e.message}`);
      }
      capture[platform].screens = screens.map((s) => s.screen);
    }));
    fs.writeFileSync(path.join(out, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');
  }

  const results = [];
  const pairs = [];
  const platforms = options.platforms.filter((p) => capture[p]);
  for (const platform of platforms) {
    for (const row of chosen) {
      if (!row[platform] || (capture[platform].screens && !capture[platform].screens.includes(row.screen))) continue;
      const current = path.join(out, platform, `${row.screen}.png`);
      const baseline = path.join(BASELINE, platform, `${row.screen}.png`);
      const missing = capture[platform] && capture[platform].missing && capture[platform].missing[row.screen];
      const entry = { platform, screen: row.screen, current: fs.existsSync(current) ? current : null, baseline: fs.existsSync(baseline) ? baseline : null };
      if (!entry.current) { entry.status = 'MISSING'; entry.detail = missing || 'no frame captured'; }
      else if (!entry.baseline) { entry.status = 'NEW'; entry.detail = 'no baseline'; }
      else pairs.push(entry);
      results.push(entry);
    }
  }

  const compared = await compareAll(pairs, options);
  for (const r of compared) Object.assign(pairs.find((p) => p.platform === r.platform && p.screen === r.screen), r);
  classify(results, options.threshold);
  const diffDir = path.join(out, 'diff');
  for (const r of results) {
    if (!r.png) continue;
    fs.mkdirSync(path.join(diffDir, r.platform), { recursive: true });
    r.composite = path.join(diffDir, r.platform, `${r.screen}.png`);
    fs.writeFileSync(r.composite, Buffer.from(r.png, 'base64'));
    delete r.png;
    const dsf = r.platform === 'web' ? 2 : r.platform === 'ios' ? 3 : Math.round(r.size[0] / 390);
    r.bands = describeBands(bands(r.rows), dsf);
  }

  let touched = new Set();
  if (options.accept) touched = accept(results, capture);
  writeReport(out, results, platforms, capture, options);

  for (const r of results) {
    console.log(`${r.platform.padEnd(8)} ${r.screen.padEnd(24)} ${r.status.padEnd(9)} ${r.detail || ''}`);
    if (r.bands && r.status === 'DIFF') console.log(`${' '.repeat(42)}${r.bands.replace(/\n\s+/g, `\n${' '.repeat(42)}`)}`);
  }
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log(`\n${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')} · report ${path.join(out, 'report.html')}`);
  if (touched.size) console.log(`baselines accepted for ${[...touched].join(', ')} in ${BASELINE}`);
  if (results.some((r) => r.status !== 'same' && r.status !== 'accepted')) process.exit(1);
}

if (require.main === module) main().catch((e) => { console.error(e.message || e); process.exit(1); });

module.exports = { SCREENS, parseWeb };
