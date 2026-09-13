// node tools/check-habit-learning.mjs [--out /tmp/path]; private server, synthetic API, no credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { withPage, frame, evaluate, screenshot, sleep } = require('./comps/chrome.js');
const root = path.resolve(import.meta.dirname, '..');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/conformance/prediction.json')));
const outFlag = process.argv.indexOf('--out');
const out = outFlag >= 0 ? process.argv[outFlag + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'trains-habits-'));
fs.mkdirSync(out, { recursive: true });
let scenario;
const iso = value => new Date(value).toISOString();
function body(fromId, toId) {
  const now = Date.parse(scenario.now);
  const from = scenario.stations.find(s => s.id === fromId), to = scenario.stations.find(s => s.id === toId);
  assert.ok(from && to, 'request must use a known saved endpoint');
  const journey = {
    line: {name: 'T9', mode: 'train'}, legs: 1, destinationHeadsign: to.name,
    departure: {scheduled: iso(now + 600000), estimated: iso(now + 600000), platform: '1'},
    arrival: {scheduled: iso(now + 1800000), estimated: iso(now + 1800000)}
  };
  journey.legDetail = [{line: journey.line, from: {...from, platform:'1'}, to: {...to, platform:'2'}, departure:journey.departure, arrival:journey.arrival}];
  return { from, to, generatedAt: iso(now), journeys:[journey] };
}
const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  res.setHeader('Cache-Control','no-store');
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(url.pathname.endsWith('/departures') ? body(url.searchParams.get('from'),url.searchParams.get('to')) : {}));
    return;
  }
  const file = path.resolve(root, 'web', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  if(!file.startsWith(path.join(root,'web')+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
async function until(page, expression, label) {
  for(let i=0;i<100;i++){if(await evaluate(page,expression))return;await sleep(50);}
  throw Error(label);
}
function install(doc, now) {
  const OriginalDate = Date;
  window.Date = class extends OriginalDate { constructor(...args){super(...(args.length ? args : [now]));} static now(){return now;} };
  if(!sessionStorage.getItem('habit-seeded')){
    localStorage.setItem('trains.v1',JSON.stringify(doc));
    sessionStorage.setItem('habit-seeded','1');
  }
}
await new Promise(resolve => server.listen(0,'localhost',resolve));
try {
  for (const index of [0,1,2,3]) {
    scenario = cases[index];
    for(const [width,height] of [[390,844],[412,732]]) for(const scheme of ['dark','light']) {
      await withPage(async page => {
        await page.send('Emulation.setTimezoneOverride',{timezoneId:'Australia/Sydney'});
        const doc = {...scenario.doc, preferences:{...scenario.doc.preferences,useLocation:false}, cache:{}};
        for(const trip of doc.trips) for(const [from,to] of [[trip.from,trip.to],[trip.to,trip.from]]) {
          doc.cache[`${from.id}-${to.id}`] = {fetchedAt:scenario.now, body:body(from.id,to.id)};
        }
        await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`(${install})(${JSON.stringify(doc)},${Date.parse(scenario.now)})`});
        await frame(page,{url:`http://localhost:${server.address().port}/`,width,height,scheme,settle:400});
        const expected = scenario.wanted;
        await until(page,`window.__trains?.state.selection?.tripId === ${JSON.stringify(expected[0])} && !!document.querySelector('.hm-hd')`,'predicted Home did not settle');
        const snapshot = await evaluate(page,`(() => {
          const t=window.__trains, rows=[...document.querySelectorAll('[data-act="open-trip"]')];
          return {selected:t.state.selection, rows:rows.map(r=>({id:r.dataset.id,height:r.getBoundingClientRect().height})),
            scheme:matchMedia('(prefers-color-scheme: light)').matches?'light':'dark', receipt:document.querySelector('.hm-rec')?.textContent || '', width:document.documentElement.clientWidth,
            overflow:document.documentElement.scrollWidth>innerWidth, history:t.state.doc.history.length};
        })()`);
        assert.equal(snapshot.selected.direction,expected[1]?'reverse':'forward');
        assert.equal(snapshot.rows[0].id,expected[0]);
        assert.equal(snapshot.rows.length,2);
        assert.ok(snapshot.rows.every(r=>r.height>=44));
        assert.equal(snapshot.overflow,false);
        assert.equal(snapshot.width,width);
        assert.equal(snapshot.scheme,scheme);
        assert.equal(snapshot.history,doc.history.length,'opening Home must not teach itself');
        if(index===0)assert.match(snapshot.receipt,/weekday mornings/);
        else assert.equal(snapshot.receipt,'','thin evidence must not earn a receipt');
        fs.writeFileSync(path.join(out,`case-${index}-${width}x${height}-${scheme}.png`),await screenshot(page));
        await page.send('Page.reload',{});
        await until(page,`window.__trains?.state.selection?.tripId === ${JSON.stringify(expected[0])} && !!document.querySelector('.hm-hd')`,'reload lost learned selection');
        const other=expected[0]==='a'?'b':'a';
        await evaluate(page,`document.querySelector('[data-act="open-trip"][data-id="${other}"]').click()`);
        await until(page,`window.__trains?.state.selection?.tripId === '${other}' && location.hash.includes('board')`,'explicit trip correction was overridden');
      });
    }
  }
  console.log(JSON.stringify({cases:4,frames:16,reload:true,explicitCorrection:true,out}));
} finally { await new Promise(resolve=>server.close(resolve)); }
