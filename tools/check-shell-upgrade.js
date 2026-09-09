#!/usr/bin/env node
// node tools/check-shell-upgrade.js --previous-ref <commit> [--previous-patch <file>]; local assets and synthetic API only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { withPage, frame, evaluate, sleep } = require('./comps/chrome');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const reference = args[args.indexOf('--previous-ref') + 1];
if (!args.includes('--previous-ref') || !reference || reference.startsWith('-')) throw Error('--previous-ref must name the previous shell commit');
const previous = fs.mkdtempSync(path.join(os.tmpdir(), 'commute-previous-shell-'));
const archive = execFileSync('git', ['archive', reference, 'web'], { cwd: root, maxBuffer: 50 * 1024 * 1024 });
execFileSync('tar', ['-x', '-C', previous], { input: archive });
if (args.includes('--previous-patch')) {
  const patch = args[args.indexOf('--previous-patch') + 1];
  if (!patch || patch.startsWith('-')) throw Error('--previous-patch needs a local diff file');
  execFileSync('git', ['apply', '--include=web/**', path.resolve(patch)], {cwd: previous});
}
const current = path.join(root, 'web');
const oldRoot = path.join(previous, 'web');
const version = folder => fs.readFileSync(path.join(folder, 'sw.js'), 'utf8').match(/const VERSION = '([^']+)'/)[1];
const oldVersion = version(oldRoot), newVersion = version(current);
assert.notEqual(newVersion, oldVersion, 'upgrade must install a different shell version');
let activeRoot = oldRoot;
let offline = false;
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
const server = http.createServer((req, res) => {
  if (offline) { req.socket.destroy(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const flags = url.pathname.endsWith('/flags');
    res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify(flags ? {transferLimit:true} : {generatedAt:new Date().toISOString(),journeys:[]})); return;
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const filename = path.resolve(activeRoot, rel);
  if (!filename.startsWith(activeRoot + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {res.writeHead(404);res.end();return;}
  res.writeHead(200, {'Content-Type':types[path.extname(filename)] || 'application/octet-stream','Cache-Control':'no-store'});
  fs.createReadStream(filename).pipe(res);
});
async function until(page, expression, label) {
  for (let i=0; i<160; i++) { if(await evaluate(page, expression)) return; await sleep(50); }
  throw Error(label);
}
(async () => {
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  const url = `http://localhost:${server.address().port}`;
  try {
    await withPage(async page => {
      await frame(page,{url,width:390,height:844,settle:300});
      await until(page,'!!navigator.serviceWorker.controller','previous worker never controlled page');
      await until(page,`caches.has('shell-${oldVersion}')`,'previous shell missing');
      activeRoot = current;
      await evaluate(page,`(async()=>{ const registration=await navigator.serviceWorker.getRegistration(); await registration.update(); })()`);
      await until(page,`caches.has('shell-${newVersion}')`,'new shell failed installation');
      await until(page,`caches.keys().then(keys=>!keys.includes('shell-${oldVersion}'))`,'old shell was not retired');
      const persisted = await evaluate(page,`(() => {
        const when=Date.now(), iso=x=>new Date(x).toISOString();
        const from={id:'213820',name:'Rhodes Station'},to={id:'202210',name:'Bondi Junction Station'};
        const leg=(name,d,a)=>({line:{name,mode:'train'},from,to,departure:{scheduled:iso(d)},arrival:{scheduled:iso(a)}});
        const first=leg('T9',when+600000,when+1200000),second=leg('T4',when+1500000,when+2100000);
        const incompatible={legs:2,legDetail:[first,second],departure:first.departure,arrival:second.arrival,line:first.line};
        const doc={schemaVersion:1,trips:[{id:'upgrade',from,to,createdAt:iso(when)}],history:[],rides:[],
          preferences:{useLocation:false,transferLimit:'direct'},flags:{transferLimit:true},
          cache:{'213820-202210':{fetchedAt:iso(when),body:{from,to,generatedAt:iso(when),journeys:[incompatible]}}}};
        localStorage.setItem('trains.v1',JSON.stringify(doc)); return doc.trips[0].id;
      })()`);
      assert.equal(persisted,'upgrade');
      offline = true;
      await page.send('Page.reload',{});
      await until(page,'!!window.__trains','upgraded shell did not boot offline');
      await until(page,`window.__trains.state.doc.preferences.transferLimit === 'direct'`,'direct choice lost on offline reload');
      const checks = await evaluate(page,`(async()=>{
        const t=window.__trains;
        const modules=await Promise.all(['/js/arrival.js','/js/recommendation.js'].map(async path=>!!(await caches.match(path))));
        return {modules, trips:t.state.doc.trips.length, choice:t.state.doc.preferences.transferLimit,
          incompatible:(t.state.body?.journeys||[]).some(j=>(j.legs||j.legDetail?.length||1)>1),
          recommended:t.state.recommendation?.journey?.legs || 0};
      })()`);
      assert.deepEqual(checks.modules,[true,true],'new imports were not precached');
      assert.equal(checks.trips,1,'saved trip lost');
      assert.equal(checks.choice,'direct');
      assert.equal(checks.incompatible,false,'incompatible cache rows survived first paint');
      assert.ok(checks.recommended <= 1,'incompatible candidate survived offline reload');
      console.log(JSON.stringify({previous:oldVersion,current:newVersion,offline:true,directOnly:true,savedTripPreserved:true}));
    });
  } finally { await new Promise(resolve=>server.close(resolve)); fs.rmSync(previous,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
