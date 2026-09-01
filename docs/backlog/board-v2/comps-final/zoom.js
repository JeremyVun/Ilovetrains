/* Magnifier. `shoot.js` prints whole frames; some of this round's decisions live
 * in 20 CSS pixels (the transfer numeral at the head of a 29px leg), and a 2x
 * phone shot cannot be judged on them. This renders the same page at the same
 * viewport and captures a CLIP at 4x, so what you look at is the real cascade
 * magnified, never a resampled PNG.
 *
 * Usage: node zoom.js <file> <scenario> <x> <y> <w> <h> [out] [scheme]
 *        node zoom.js synth-a hero 236 352 160 40 bar
 */
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = '/tmp/trains_comps8'; const PORT = 9405;
const [file, sc, x, y, w, h, out, scheme] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function connect(url){return new Promise((res,rej)=>{const s=new WebSocket(url);let id=0;const p=new Map();
 s.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){const{r,j}=p.get(m.id);p.delete(m.id);m.error?j(new Error(JSON.stringify(m.error))):r(m.result);}};
 s.onerror=rej;const raw=(me,pa,si)=>new Promise((r,j)=>{const g={id:++id,method:me,params:pa||{}};if(si)g.sessionId=si;p.set(g.id,{r,j});s.send(JSON.stringify(g));});
 s.onopen=()=>res({send:(m,q)=>raw(m,q),session:sid=>({send:(m,q)=>raw(m,q,sid)}),close:()=>s.close()});});}
(async () => {
  const prof = '/tmp/tc8-zoom';
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',
    '--no-default-browser-check',`--remote-debugging-port=${PORT}`,`--user-data-dir=${prof}`,
    '--allow-file-access-from-files','about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let u; for (let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/version`);u=(await r.json()).webSocketDebuggerUrl;if(u)break;}catch(_){} await sleep(100);}
    ws = await connect(u);
    const { targetId } = await ws.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await ws.send('Target.attachToTarget', { targetId, flatten: true });
    const page = ws.session(sessionId); await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme || 'dark' }] });
    await page.send('Page.navigate', { url: `file://${DIR}/${file}.html?s=${sc}` });
    await sleep(280);
    const shot = await page.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: +x, y: +y, width: +w, height: +h, scale: 4 }
    });
    const name = path.join(DIR, 'shots', 'zoom-' + (out || `${file}-${sc}`) + '.png');
    fs.writeFileSync(name, Buffer.from(shot.data, 'base64'));
    console.log(name);
  } finally { if (ws) try { ws.close(); } catch (_) {} ch.kill('SIGKILL'); }
})();
