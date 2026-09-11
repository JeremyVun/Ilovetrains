/* Real-stack regression for transfer recovery, invariant 4: one recovery
   request per refresh, every refresh, while a change is lost.

   Run from the repository root with the fixture stub and the server already
   up (web/test/recovery-stack.sh does that and calls this):

     SERVER_PORT=8431 node web/test/recovery-stack-probe.mjs

   The stub must answer Town Hall → Bondi Junction so the recovery request is
   a 200; the probe seeds a followed journey with a lost change at real clock
   time, drives three refresh cycles through window.__trains.refresh(), and
   prints how many departures requests each pair received. Not part of
   `npm test`; it needs a browser (the playwright install under ~/projects/playtest). */

import { chromium } from '/Users/jeremy/projects/playtest/node_modules/playwright/index.mjs';

const port = process.env.SERVER_PORT;
if (!port) throw new Error('SERVER_PORT is required');

const TRIP = {
  id: 'trip-rhodes-bondi',
  from: { id: '213820', name: 'Rhodes Station' },
  to: { id: '202210', name: 'Bondi Junction Station' },
  createdAt: '2026-08-01T08:00:00+10:00'
};
const now = Date.now();
const iso = (minutes) => new Date(now + minutes * 60_000).toISOString();
const leg = (line, from, to, dep, arr, depEst, arrEst) => ({
  line: { name: line, mode: 'train' },
  headsign: line === 'T9' ? 'Gordon via Lindfield' : 'Bondi Junction',
  from, to,
  departure: { scheduled: iso(dep), estimated: depEst === null ? null : iso(depEst) },
  arrival: { scheduled: iso(arr), estimated: arrEst === null ? null : iso(arrEst) },
  cancelled: false
});
// Left Rhodes half an hour ago, five minutes late into Town Hall; the T4 left
// three minutes ago, so the change is lost and the rider is dwelling.
const legDetail = [
  leg('T9', { id: '213820', name: 'Rhodes Station', platform: 'Platform 1' },
    { id: '200070', name: 'Town Hall Station', platform: 'Platform 3' }, -30, -6, -30, -1),
  leg('T4', { id: '200070', name: 'Town Hall Station', platform: 'Platform 5' },
    { id: '202210', name: 'Bondi Junction Station', platform: 'Platform 1' }, -3, 9, -3, 9)
];
const journey = {
  departure: { ...legDetail[0].departure, platform: 'Platform 1' },
  arrival: { ...legDetail[1].arrival },
  line: legDetail[0].line, destinationHeadsign: 'Gordon via Lindfield',
  stopsAway: null, cancelled: false, legs: 2, legDetail
};
const seed = {
  schemaVersion: 1, trips: [TRIP], history: [],
  lastViewed: { tripId: TRIP.id, direction: 'forward' }, cache: {},
  focus: { tripId: TRIP.id, direction: 'forward', focusedAt: iso(-30), by: 'focus', journey }
};

const browser = await chromium.launch();
const page = await browser.newPage();
const departures = [];
page.on('request', (request) => {
  const url = request.url();
  if (url.includes('/api/v1/departures')) departures.push(url);
});
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('/api/v1/departures')) console.log(`response ${response.status()} ${new URL(url).search}`);
});
page.on('console', (message) => { if (message.type() === 'error') console.log('console error:', message.text()); });

await page.goto(`http://localhost:${port}/#/`);
await page.waitForFunction(() => window.__trains && window.__trains.state);
await page.evaluate((doc) => {
  const t = window.__trains;
  t.state.doc = doc;
  localStorage.setItem('trains.v1', JSON.stringify(doc));
  t.state.selection = null;
  t.state.body = null;
  t.state.focusBody = null;
  t.state.focusIdentity = null;
  t.state.journey = null;
  t.route();
}, seed);
await page.waitForTimeout(1500);

const cycles = [];
for (let cycle = 1; cycle <= 3; cycle++) {
  const before = departures.length;
  await page.evaluate(() => window.__trains.refresh());
  await page.waitForTimeout(2000);
  const made = departures.slice(before).map((url) => new URL(url).searchParams.get('from'));
  const held = await page.evaluate(() => {
    const t = window.__trains;
    return {
      key: t.state.recovery ? t.state.recovery.key : null,
      journeys: t.state.recovery ? t.state.recovery.journeys.length : null,
      status: document.querySelector('[data-focus-status]')?.textContent.trim() || null,
      stored: Boolean(JSON.parse(localStorage.getItem('trains.v1')).focus?.recovery)
    };
  });
  cycles.push({ cycle, requestsFrom: made, ...held });
}

const recovery = departures.filter((url) => new URL(url).searchParams.get('from') === '200070');
const report = {
  cycles,
  followedRequests: departures.filter((url) => new URL(url).searchParams.get('from') === '213820').length,
  recoveryRequests: recovery.length,
  recoveryQueries: recovery.map((url) => new URL(url).search)
};
console.log(JSON.stringify(report, null, 1));
await browser.close();

const wrong = cycles.filter((cycle) => cycle.requestsFrom.filter((from) => from === '200070').length !== 1);
if (wrong.length) {
  console.error(`FAIL: three refreshes made ${recovery.length} recovery requests, one per refresh expected`);
  process.exit(1);
}
console.log('PASS: one recovery request per refresh');
