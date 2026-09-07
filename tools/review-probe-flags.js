#!/usr/bin/env node
/* Review probe for the unified flags fetch: counts every /api/v1/flags request
 * the real web client makes per open, foreground return and 30 s tick, and
 * checks the tiny train only ever follows an answer fetched in this process.
 * node tools/review-probe-flags.js --url http://localhost:8198
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { withPage, frame, evaluate, sleep } = require('./comps/chrome');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const option = (key, fallback) => argv.includes(key) ? argv[argv.indexOf(key) + 1] : fallback;
const url = option('--url', 'http://localhost:8198');

async function ready(page) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(page, '!!window.__trains && !!document.querySelector(".hm-rule")')) return;
    await sleep(50);
  }
  throw Error('Home did not load');
}

const toyShown = (page) => evaluate(page, '!!document.querySelector(".tiny-train-trigger")');
const calls = (page) => evaluate(page, 'window.__flags.calls');
const aborted = (page) => evaluate(page, 'window.__flags.aborted');
const answer = (page, value) => evaluate(page, `void (window.__flags.answer = ${JSON.stringify(value)})`);
const hidden = (page, value) => evaluate(page, `window.__setHidden(${value})`);
const tick = (page) => evaluate(page, 'window.__tick()');
const storedFlags = (page) => evaluate(page, 'JSON.stringify(window.__trains.state.doc.flags)');

async function run() {
  const { departuresBody, NOW } = await import(pathToFileURL(path.join(ROOT, 'web/test/fixture.js')));
  const body = departuresBody();
  const trip = { id: 'flags-probe', from: body.from, to: body.to, createdAt: body.generatedAt };
  const doc = {
    schemaVersion: 1, trips: [trip], history: [], rides: [],
    preferences: { useLocation: false },
    flags: { tiny_train: true, transferLimit: true },
    cache: { [`${trip.from.id}-${trip.to.id}`]: { fetchedAt: body.generatedAt, body } }
  };
  const seed = `
    localStorage.setItem('trains.v1', ${JSON.stringify(JSON.stringify(doc))});
    Date.now = () => ${NOW};
    window.__flags = { calls: 0, aborted: 0, answer: 'fail' };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const target = String(input);
      if (target.includes('/api/v1/flags')) {
        window.__flags.calls++;
        const a = window.__flags.answer;
        return new Promise((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            window.__flags.aborted++;
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
          if (a === 'fail') reject(new TypeError('failed to fetch'));
          else if (a === 'pending') return;
          else if (a === 503) resolve(new Response('{"error":{"code":"down"}}', { status: 503, headers: { 'Content-Type': 'application/json' } }));
          else resolve(new Response(JSON.stringify(a), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        });
      }
      if (target.includes('/api/')) return new Promise(() => {});
      return originalFetch(input, init);
    };
    const nativeInterval = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...rest) => { if (ms === 30000) window.__tick = fn; return nativeInterval(fn, ms, ...rest); };
    let hiddenNow = false;
    Object.defineProperty(document, 'hidden', { get: () => hiddenNow, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => hiddenNow ? 'hidden' : 'visible', configurable: true });
    window.__setHidden = (value) => { hiddenNow = value; document.dispatchEvent(new Event('visibilitychange')); };
  `;
  const results = [];
  const step = (name, ok) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`); assert.ok(ok, name); };

  await withPage(async (page) => {
    await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Australia/Sydney' });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
    await frame(page, { url, width: 390, height: 844, scheme: 'dark', settle: 400 });
    await ready(page);
    await sleep(300);
    step('I1 open: exactly one flags request', await calls(page) === 1);
    step('I2 stored tiny_train:true + failed fetch: toy stays off', !(await toyShown(page)));
    step('I2 failed fetch keeps the stored cap answer', await storedFlags(page) === '{"tiny_train":true,"transferLimit":true}');

    await answer(page, { tiny_train: true, transferLimit: true });
    await hidden(page, true);
    await hidden(page, false);
    await sleep(300);
    step('I1 foreground return: one request', await calls(page) === 2);
    step('I4 answer true appears on the very next fetch', await toyShown(page));

    await answer(page, { tiny_train: false, transferLimit: true });
    await tick(page);
    await sleep(300);
    step('I1 tick: one request', await calls(page) === 3);
    step('I4 answer false disappears within one tick', !(await toyShown(page)));

    await hidden(page, true);
    await tick(page);
    await sleep(100);
    step('I1 no request while hidden', await calls(page) === 3);
    await hidden(page, false);
    await sleep(300);
    step('I1 return after hidden tick: one request', await calls(page) === 4);

    await answer(page, 'pending');
    await tick(page);
    await sleep(100);
    step('in-flight request started', await calls(page) === 5);
    await hidden(page, true);
    await sleep(100);
    step('hidden aborts the in-flight request', await aborted(page) === 1);
    await answer(page, { tiny_train: true, transferLimit: true });
    await hidden(page, false);
    await sleep(300);
    step('flagsRequest is not stuck after an abort: return fetches again', await calls(page) === 6);
    step('the fresh answer after an abort still applies', await toyShown(page));

    await answer(page, 'pending');
    await tick(page);
    await sleep(100);
    step('pending request started', await calls(page) === 7);
    await tick(page);
    await sleep(100);
    step('a second tick while one is in flight is dropped', await calls(page) === 7);
    await sleep(3400);
    step('3 s timeout aborts', await aborted(page) === 2);
    step('timeout counts as failure: toy off', !(await toyShown(page)));
    await answer(page, { tiny_train: true, transferLimit: true });
    await tick(page);
    await sleep(300);
    step('not stuck after timeout: tick fetches again', await calls(page) === 8);
    step('toy back after a good answer', await toyShown(page));

    await answer(page, 503);
    await tick(page);
    await sleep(300);
    step('I2 503 turns the toy off', !(await toyShown(page)));
    step('I2 503 keeps the stored cap answer', await storedFlags(page) === '{"tiny_train":true,"transferLimit":true}');

    await answer(page, { tiny_train: 'true', transferLimit: true });
    await tick(page);
    await sleep(300);
    step('I2 string "true" never enables the toy', !(await toyShown(page)));
    step('a malformed toy value still updates the stored answer for the cap', await storedFlags(page) === '{"transferLimit":true}');
  });

  await withPage(async (page) => {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
    await frame(page, { url: url + '/?tinyTrain=1', width: 390, height: 844, scheme: 'dark', settle: 400 });
    await ready(page);
    await sleep(300);
    step('I3 preview on: toy shows despite a failed fetch', await toyShown(page));
    step('I3 preview does not change the cadence: still one request per open', await calls(page) === 1);
    await answer(page, { tiny_train: false, transferLimit: true });
    await tick(page);
    await sleep(300);
    step('I3 preview on beats a server false', await toyShown(page) && await calls(page) === 2);
    step('I3 preview does not touch other flags', await storedFlags(page) === '{"tiny_train":false,"transferLimit":true}');
  });

  await withPage(async (page) => {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
    await frame(page, { url: url + '/?tinyTrain=0', width: 390, height: 844, scheme: 'dark', settle: 400 });
    await ready(page);
    await answer(page, { tiny_train: true, transferLimit: true });
    await tick(page);
    await sleep(300);
    step('I3 preview off beats a server true', !(await toyShown(page)) && await calls(page) === 2);
  });

  console.log(results.join('\n'));
}

run().catch((error) => { console.error(error); process.exit(1); });
