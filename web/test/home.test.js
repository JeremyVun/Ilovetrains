process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { directionsModel } from '../js/focus.js';
import { fitStationNames } from '../js/dom.js';
import { fitTripNames, homeHtml, homeModel, tripIsOver } from '../js/home.js';
import { emptyDoc } from '../js/storage.js';
import { departureMs, departureKey } from '../js/journey.js';
import {
  cancelLeg, delayLeg, transferBody, transferJourneys, FERRY_NOW, ferryBody
} from './fixture.js';

const at = (time) => Date.parse(`2026-09-01T${time}:00+10:00`);

test('directions follows the closed state ladder on one journey', () => {
  const journey = transferJourneys()[0];
  const before = directionsModel(journey, at('09:21'));
  assert.deepEqual([before.figure, before.provenance, before.phase], ['3', '', 'pre']);
  assert.equal(before.showBoardingPlatform, true);

  const riding = directionsModel(journey, at('09:33'));
  assert.deepEqual([riding.figure, riding.provenance, riding.phase], ['18', 'TO CHANGE', 'ride']);
  assert.match(riding.instruction, /Get off at Town Hall · Platform 3/);

  const change = directionsModel(journey, at('09:53'));
  assert.deepEqual([change.figure, change.provenance, change.phase], ['5', 'TO CHANGE', 'dwell']);
  assert.equal(change.instruction, 'Change at Town Hall · Platform 5');
  assert.ok(Math.abs(change.progress.at - 29 / 44) < 0.02);

  const final = directionsModel(journey, at('10:01'));
  assert.deepEqual([final.figure, final.provenance, final.phase], ['7', 'TO GO', 'ride2']);
  assert.match(final.instruction, /Get off at Bondi Junction · Platform 2/);

  const done = directionsModel(journey, at('10:11'));
  assert.deepEqual([done.figure, done.provenance, done.phase], ['3', 'AGO', 'done']);
  assert.equal(done.showBoardingPlatform, false);
});

test('a trip becomes over at effective arrival, not at an arbitrary UI age', () => {
  const focus = { journey: transferJourneys()[0] };
  assert.equal(tripIsOver(focus, at('10:07')), false);
  assert.equal(tripIsOver(focus, at('10:09')), true);
});

test('a cancelled lead names the cancellation while answering with the next train', () => {
  const journeys = transferJourneys();
  journeys[0].cancelled = true;
  journeys[0].legDetail[0].cancelled = true;
  const trip = {
    id: 't',
    from: { id: '213820', name: 'Rhodes Station' },
    to: { id: '202210', name: 'Bondi Junction Station' },
    createdAt: new Date(0).toISOString()
  };
  const doc = { ...emptyDoc(), trips: [trip] };
  const model = homeModel(doc, { tripId: 't', direction: 'forward' }, {
    generatedAt: '2026-09-01T09:21:00+10:00', journeys
  }, at('09:21'));
  assert.equal(model.directions.depTime, '09:39');
  assert.equal(model.directions.figure, '18');
  assert.equal(model.directions.instruction, '09:24 CANCELLED · NEXT TRAIN');
});

test('a cancellation is not a tight change: the transfer gap stays neutral', () => {
  const cancelled = transferJourneys()[0];
  cancelled.cancelled = true;
  cancelled.legDetail[0].cancelled = true;
  const model = directionsModel(cancelled, at('09:21'));

  assert.equal(model.warn, true, 'the words still warn');
  assert.equal(model.tight, false, 'but nothing about this connection is at risk');
  assert.ok(!homeHtml(headerOnly(model)).includes('sy-g0 warn'));

  const risky = directionsModel(delayLeg(transferJourneys()[0], 0, 5), at('09:53'));
  assert.equal(risky.tight, true);
  assert.ok(homeHtml(headerOnly(risky)).includes('sy-g0 warn'));
});

test('a delayed smart-header train names the delay beside its effective time', () => {
  const journey = transferJourneys()[0];
  delayLeg(journey, 0, 5);
  const model = directionsModel(journey, at('09:21'));
  assert.equal(model.depTime, '09:29');
  assert.equal(model.figure, '8');
  assert.equal(model.provenance, '5 MIN LATE');
  assert.equal(model.provenanceWarn, true);
});

test('every saved-trip row leads with its distance in bold, not just the tracked one', () => {
  const station = (id, name, lat, lon) => ({ id, name, location: { lat, lon } });
  const trip = (id, from, to) => ({ id, from, to, createdAt: new Date(0).toISOString() });
  const doc = {
    ...emptyDoc(),
    trips: [
      trip('t1', station('213820', 'Rhodes Station', -33.8299, 151.0866),
        station('202210', 'Bondi Junction Station', -33.8915, 151.2477)),
      trip('t2', station('200060', 'Central Station', -33.8832, 151.2069),
        station('215020', 'Parramatta Station', -33.8172, 151.0050))
    ]
  };
  const model = homeModel(doc, { tripId: 't1', direction: 'forward' }, null, at('09:21'), {
    fix: { lat: -33.8299, lon: 151.0866 }
  });
  const html = homeHtml(model);

  assert.deepEqual(model.ranked.map((entry) => entry.selected), [true, false]);
  assert.ok(model.ranked[1].distance, 'the unselected row has a distance to print');
  assert.ok(html.includes(`<b>${model.ranked[1].distance}</b>`),
    'the distance is bold on an unselected row');
  // The header's own row leads with SHOWN ABOVE and prints its distance after.
  assert.ok(html.includes(`<b>Shown above</b> · ${model.ranked[0].distance}`));
});


/* homeHtml only reads `directions` and `ranked`; the rest of the model is the
   screen around the header. */
function headerOnly(directions, ranked = []) {
  return {
    directions, ranked, home: null, strip: null, status: null,
    top: { lead: 'Next train', name: '' },
    over: false, freshness: 'Live', dot: 'live', askLocation: false
  };
}


/* ---- the ported smart home ---------------------------------------------- */

const RHODES = { id: '213820', name: 'Rhodes Station', location: { lat: -33.8299, lon: 151.0866 } };
const BONDI = { id: '202210', name: 'Bondi Junction Station', location: { lat: -33.8915, lon: 151.2477 } };
const HOME_TRIP = { id: 't1', from: RHODES, to: BONDI, createdAt: new Date(0).toISOString() };
const HOME_SELECTION = { tripId: 't1', direction: 'forward' };

function homeDoc(focus = null) {
  const doc = { ...emptyDoc(), trips: [HOME_TRIP] };
  if (focus) {
    doc.focus = { tripId: 't1', direction: 'forward', focusedAt: '2026-09-01T09:21:00+10:00', journey: focus };
  }
  return doc;
}

function screen(journeys, time, { focus = null, ...opts } = {}) {
  const model = homeModel(homeDoc(focus), HOME_SELECTION,
    transferBody({ journeys, generatedAt: '2026-09-01T09:53:00+10:00' }), at(time), opts);
  return { model, html: homeHtml(model) };
}

test('the focused status reads the same in the top line and the focused row', () => {
  const late = delayLeg(transferJourneys()[0], 1, 1);
  const { model, html } = screen([late], '09:53', { focus: late });

  assert.deepEqual([model.status.text, model.status.leg, model.status.late], ['Running late', 1, true]);
  assert.equal(html.match(/Running <span class="status-late-word">late<\/span>/g).length, 2);
  assert.ok(html.includes('class="answer-kind status-copy status-late status-late" data-focus-status data-late="true"'));
  assert.ok(html.includes('<span class="answer-line">'), 'the status is one flex item');
  assert.ok(html.includes('class="status-copy status-late status-late" data-row-status data-late="true"'));
  assert.ok(html.includes('class="tripr focused"'));
  assert.ok(html.includes(' active-late"'), 'the header carries the late class for its countdown');

  const onTime = screen([transferJourneys()[0]], '09:53', { focus: transferJourneys()[0] });
  assert.equal(onTime.model.status.text, 'Running');
  assert.equal(onTime.html.match(/>Running</g).length, 2);
  assert.ok(!onTime.html.includes(' active-late"'));
});

test('cancelled and completed statuses reach both placements too', () => {
  const cancelled = cancelLeg(transferJourneys()[0], 1);
  const cx = screen([cancelled], '09:53', { focus: cancelled });
  assert.equal(cx.model.status.text, 'Cancelled');
  assert.equal(cx.html.match(/>Cancelled</g).length, 2);
  assert.ok(cx.html.includes('status-copy status-exception" data-row-status'));

  const over = screen([transferJourneys()[0]], '10:11', { focus: transferJourneys()[0] });
  assert.equal(over.model.status.text, 'Trip over');
  assert.ok(over.html.includes('data-focus-status data-late="false"><span class="answer-line">Trip over<'));
  assert.ok(over.html.includes('data-row-status data-late="false">Trip over<'));
});

test('a focused journey cancelled before it leaves shows the next train', () => {
  const journeys = transferJourneys();
  cancelLeg(journeys[0], 0);
  const { model, html } = screen(journeys, '09:21', { focus: journeys[0] });

  assert.equal(model.directions.depTime, '09:39', 'the header carries the next running service');
  assert.equal(model.directions.instruction, '09:24 CANCELLED · NEXT TRAIN');
  assert.equal(model.status.text, 'Cancelled');
  assert.ok(html.includes('data-row-status'));
});

test('a focused cancellation with nothing left to offer keeps its own journey', () => {
  const journeys = transferJourneys();
  cancelLeg(journeys[0], 1);
  const { model } = screen([journeys[0]], '09:21', { focus: journeys[0] });

  assert.equal(model.directions.depTime, '09:24');
  assert.equal(model.status.text, 'Cancelled');
});

test('the top line answers how far the station is, or names the next train', () => {
  const journeys = transferJourneys();
  const top = (fix) => screen(journeys, '09:21', { fix }).model.top;

  assert.deepEqual(top(null), { lead: 'Next train', name: '' });
  assert.deepEqual(top({ lat: RHODES.location.lat, lon: RHODES.location.lon }), { lead: 'At ', name: 'Rhodes' });
  assert.match(top({ lat: RHODES.location.lat + 0.0025, lon: RHODES.location.lon }).lead, /^2[678]0 m to $/);
  assert.match(top({ lat: BONDI.location.lat, lon: BONDI.location.lon }).lead, /^\d+ km to $/);

  const { html } = screen(journeys, '09:21', { fix: { lat: RHODES.location.lat, lon: RHODES.location.lon } });
  assert.ok(html.includes('At <span data-fit-name="Rhodes">Rhodes</span>'));
  assert.ok(html.includes('data-focus-status data-late="false"'));
});

test('a ferry board drives the home words and every saved-trip colour device', () => {
  const body = ferryBody();
  const trip = {
    id: 'ferry', from: body.from, to: body.to, createdAt: new Date(0).toISOString()
  };
  const doc = { ...emptyDoc(), trips: [trip] };
  const model = homeModel(doc, { tripId: 'ferry', direction: 'forward' }, body, FERRY_NOW);
  const html = homeHtml(model);

  assert.deepEqual(model.top, { lead: 'Next ferry', name: '' });
  assert.deepEqual(model.ranked[0].lines, [{ code: 'MFF', colourKey: 'FERRY' }]);
  assert.match(html, /data-line-code="MFF"[^>]*background:var\(--line-fill-FERRY\);color:var\(--bg\)/);
  assert.match(html, /class="hm-spine"><i style="background:var\(--line-fill-FERRY\)/);
  assert.match(html, />Wharf 2, Side A<\/span>/);
});

test('home retains a full named ferry origin without inventing a wharf number', () => {
  const body = ferryBody();
  body.from.name = 'Pyrmont Bay Wharf';
  body.journeys = [structuredClone(body.journeys[0])];
  body.journeys[0].departure.platform = 'Pyrmont Bay Wharf';
  body.journeys[0].legDetail[0].from.name = 'Pyrmont Bay Wharf';
  body.journeys[0].legDetail[0].from.platform = 'Pyrmont Bay Wharf';
  const trip = { id: 'pyrmont', from: body.from, to: body.to, createdAt: new Date(0).toISOString() };
  const model = homeModel({ ...emptyDoc(), trips: [trip] }, {
    tripId: trip.id, direction: 'forward'
  }, body, FERRY_NOW);
  const html = homeHtml(model);

  assert.match(html, /class="sy-cap"[^>]*>Pyrmont Bay Wharf<\/span>/);
  assert.match(html, /data-role="origin"/);
  assert.match(html, /class="hm-stn"[^>]*>Pyrmont Bay Wharf<\/span>/);
});

test('a saved-trip row opens that trip’s departures and the header is read-only', () => {
  const { html } = screen(transferJourneys(), '09:21');

  assert.ok(html.includes('data-act="open-trip" data-id="t1" data-direction="forward"'));
  assert.ok(html.includes('aria-label="Open Rhodes to Bondi Junction departures"'));
  assert.ok(html.includes('Departures<span class="arrow">›</span>'));
  assert.ok(!html.includes('select-trip'), 'the old home-only selection is gone');
  assert.ok(!html.includes('data-act="board"'), 'and the header is not a control');
  assert.match(html, /<section class="hm-hd[^>]*>/);
  assert.ok(!/<section class="hm-hd[^>]*data-act=/.test(html));
  assert.ok(html.includes('<div class="l">My trips</div>'));
});

/* A receipt names evidence or it does not appear (ui.md, smart home). */

const SECOND_TRIP = {
  id: 't2',
  from: { id: '200060', name: 'Central Station' },
  to: { id: '215020', name: 'Parramatta Station' },
  createdAt: new Date(0).toISOString()
};

const views = (times) => times.map((t) => ({ tripId: 't1', direction: 'forward', t }));

function receiptDoc(history, trips = [HOME_TRIP, SECOND_TRIP]) {
  return { ...emptyDoc(), trips, history };
}

const receiptOf = (doc, nowMs, opts = {}) =>
  homeModel(doc, HOME_SELECTION, transferBody(), nowMs, { predicted: true, ...opts })
    .directions.receipt;

const SATURDAY_0921 = Date.parse('2026-09-05T09:21:00+10:00');

test('a view-history receipt needs three matching views across three days', () => {
  const doc = receiptDoc(views([
    '2026-08-27T09:20:00+10:00', '2026-08-28T09:10:00+10:00', '2026-08-31T09:40:00+10:00'
  ]));
  assert.equal(receiptOf(doc, at('09:21')), 'You check this trip most weekday mornings.');

  const afternoon = receiptDoc(views([
    '2026-08-27T15:20:00+10:00', '2026-08-28T15:10:00+10:00', '2026-08-31T15:40:00+10:00'
  ]));
  assert.equal(receiptOf(afternoon, at('15:21')), 'You often check this trip around now.');

  // Three views, but all on one morning: no weekly habit to claim.
  const oneDay = receiptDoc(views([
    '2026-08-31T09:00:00+10:00', '2026-08-31T09:20:00+10:00', '2026-08-31T09:40:00+10:00'
  ]));
  assert.equal(receiptOf(oneDay, at('09:21')), 'You often check this trip around now.');
});

test('thin or unearned evidence prints no receipt at all', () => {
  const history = views([
    '2026-08-27T09:20:00+10:00', '2026-08-28T09:10:00+10:00', '2026-08-31T09:40:00+10:00'
  ]);
  const doc = receiptDoc(history);

  assert.equal(receiptOf(doc, at('09:21'), { predicted: false }), '', 'an explicit tap needs no receipt');
  assert.equal(receiptOf(receiptDoc(history, [HOME_TRIP]), at('09:21')), '',
    'one saved trip is no leap');
  assert.equal(receiptOf(receiptDoc(history.slice(0, 2)), at('09:21')), '', 'two views are not a habit');
  assert.equal(receiptOf(receiptDoc(views(['2026-08-27T14:20:00+10:00',
    '2026-08-28T14:10:00+10:00', '2026-08-31T14:40:00+10:00'])), at('09:21')), '',
  'views three hours from now are not evidence about now');
});

test('a weekday habit is not a Saturday habit', () => {
  const weekday = receiptDoc(views([
    '2026-08-27T09:20:00+10:00', '2026-08-28T09:10:00+10:00', '2026-08-31T09:40:00+10:00'
  ]));
  assert.equal(receiptOf(weekday, SATURDAY_0921), '');

  const weekend = receiptDoc(views([
    '2026-08-22T09:20:00+10:00', '2026-08-23T09:10:00+10:00', '2026-08-29T09:40:00+10:00'
  ]));
  assert.equal(receiptOf(weekend, SATURDAY_0921), 'You often check this trip around now.');
});

test('a focused journey and a located user keep the receipt slot for their own copy', () => {
  const doc = receiptDoc(views([
    '2026-08-27T09:20:00+10:00', '2026-08-28T09:10:00+10:00', '2026-08-31T09:40:00+10:00'
  ]));
  assert.equal(receiptOf(doc, at('09:21'), { fix: { lat: -33.8299, lon: 151.0866 } }), '');

  const focused = { ...doc, focus: {
    tripId: 't1', direction: 'forward', focusedAt: '2026-09-01T09:21:00+10:00',
    journey: transferJourneys()[0]
  } };
  assert.equal(receiptOf(focused, at('09:21')), '');
});

test('the reverse receipt prints the ride’s Sydney time from any device zone', (t) => {
  const runnerZone = process.env.TZ;
  t.after(() => { process.env.TZ = runnerZone; });

  const doc = {
    ...emptyDoc(),
    trips: [HOME_TRIP],
    rides: [{
      tripId: 't1', direction: 'forward',
      departedAt: '2026-09-01T08:12:00+10:00', arrivedAt: '2026-09-01T08:56:00+10:00',
      from: RHODES, to: BONDI
    }]
  };
  const receipt = () => homeModel(doc, { tripId: 't1', direction: 'reverse' },
    transferBody(), at('17:40'), {}).directions.receipt;

  for (const zone of ['Australia/Sydney', 'Australia/Perth', 'UTC']) {
    process.env.TZ = zone;
    assert.equal(receipt(), 'You rode out at 08:12. Here’s the way back.', zone);
  }
});

test('the first paint claims no provenance it does not have', () => {
  const model = homeModel({ ...emptyDoc(), trips: [HOME_TRIP] }, HOME_SELECTION, null, at('09:21'), {});
  assert.equal(model.directions.provenance, '');
  assert.equal(model.directions.instruction, 'Getting the next trains…');
});

test('a station name is shortened by rule rather than ellipsised', () => {
  const fit = (full, budget) => {
    const node = {
      dataset: { fitName: full }, textContent: full, style: {},
      closest: () => node,
      get scrollWidth() { return node.textContent.length; },
      get clientWidth() { return budget; }
    };
    fitStationNames({ querySelectorAll: () => [node] });
    return node.textContent;
  };

  assert.equal(fit('North Sydney Junction Station', 99), 'North Sydney Junction Station');
  assert.equal(fit('North Sydney Junction Station', 21), 'North Sydney Junction');
  assert.equal(fit('North Sydney Junction Station', 15), 'North Sydney Jn');
  assert.equal(fit('North Sydney Junction Station', 11), 'N Sydney Jn');
});

test('a long saved-trip name shrinks only until it fits', (t) => {
  const prior = globalThis.getComputedStyle;
  t.after(() => { globalThis.getComputedStyle = prior; });
  const node = {
    style: {}, dataset: {}, clientWidth: 318,
    get scrollWidth() {
      return 324 * Number.parseFloat(this.style.fontSize || '19') / 19;
    }
  };
  globalThis.getComputedStyle = () => ({ fontSize: '19px' });

  fitTripNames({ querySelectorAll: () => [node] });

  assert.equal(node.scrollWidth <= node.clientWidth + 1, true);
  assert.equal(node.style.fontSize, '18.5px');
});

test('a long ferry trip keeps both endpoint names at phone width', (t) => {
  const prior = globalThis.getComputedStyle;
  t.after(() => { globalThis.getComputedStyle = prior; });
  const classes = new Set();
  const row = { classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v) } };
  const node = {
    style: {}, dataset: {}, clientWidth: 318,
    closest: () => row,
    get scrollWidth() {
      return this.dataset.wrap ? 318 : 359 * Number.parseFloat(this.style.fontSize || '16') / 16;
    }
  };
  globalThis.getComputedStyle = () => ({ fontSize: '19px' });

  fitTripNames({ querySelectorAll: () => [node] });

  assert.equal(node.scrollWidth <= node.clientWidth + 1, true);
  assert.equal(node.style.fontSize, '16px');
  assert.equal(node.dataset.wrap, 'true');
  assert.equal(classes.has('wrapped'), true);
});

/* Focus is written by `Take this train`, by inferred entry and by the redirect
   that keeps a rider on the same departure — and by nothing else: browsing
   another trip must not move the journey the rider is following
   (client-storage.md, Trip selection and Travel mode). */
test('a saved-trip row tap selects and routes, and leaves focus alone', () => {
  const main = readFileSync(join(import.meta.dirname, '..', 'js', 'main.js'), 'utf8');
  const branch = /if \(action === 'open-trip'\) \{([\s\S]*?)\n  \}/.exec(main);

  assert.ok(branch, 'homeAction still handles the row tap');
  assert.match(branch[1], /state\.selection = \{ tripId: element\.dataset\.id/);
  assert.match(branch[1], /ctx\.go\('#\/board'\)/);
  assert.ok(!/focus/i.test(branch[1]), 'the row tap does not touch focus');
  assert.equal(main.match(/setFocus\(/g).length, 3, 'three writers of focus, no more');
});

/* The record inferred entry reads is written where writes happen, never from a
   render or a tick, and only for an unfocused header (client-storage.md). */
test('the controller records the previous open at two write points only', () => {
  const main = readFileSync(join(import.meta.dirname, '..', 'js', 'main.js'), 'utf8');
  const body = /function noteLastOpen\(\) \{([\s\S]*?)\n\}/.exec(main);

  assert.ok(body, 'the controller still has noteLastOpen');
  assert.match(body[1], /state\.view !== 'home' \|\| focusSelection\(\)/);
  assert.match(body[1], /!journeyCancelled\(item\)/, 'the lead journey is the first running one');
  assert.match(body[1], /spot && spot\.tier === 1 \? spot\.station : null/);
  assert.equal(main.match(/^\s*noteLastOpen\(\);$/gm).length, 2, 'the cache paint and the refresh');
  assert.ok(!/renderHome\(\)[\s\S]{0,40}noteLastOpen/.test(
    /function renderHome[\s\S]*?\n\}/.exec(main)[0]), 'never from a render');
});

/* The correction for a wrong inferred entry is one tap: the sheet opens with the
   origin filled and the departure to re-enter on (design.md, ruling 7). */
test('change destination carries the origin and the departure into the sheet', () => {
  const main = readFileSync(join(import.meta.dirname, '..', 'js', 'main.js'), 'utf8');
  const branch = /if \(action === 'change-destination'\) \{([\s\S]*?)\n  \}/.exec(main);

  assert.ok(branch, 'homeAction handles the strip');
  assert.match(branch[1], /origin: strip\.origin/);
  assert.match(branch[1], /journeyKey: strip\.journeyKey/);
  assert.match(branch[1], /departureMs: strip\.departureMs/);
  assert.match(branch[1], /ctx\.go\('#\/trips\/new'\)/);
});


/* The three wires home needs from the controller: the receipt may only claim a
   prediction, and a declined location ask must outlive the page. */
test('the controller tells home what it predicted, and persists a decline', () => {
  const main = readFileSync(join(import.meta.dirname, '..', 'js', 'main.js'), 'utf8');
  const branch = /if \(action === 'skip-location'\) \{([\s\S]*?)\n  \}/.exec(main);

  assert.match(main, /predicted: state\.predicted/);
  assert.ok(branch, 'homeAction still handles the decline');
  assert.match(branch[1], /ctx\.update\(declineLocation\(state\.doc, now\(\)\)\)/);
});

test('the freshness pill rests while the first board is still in the post', () => {
  const waiting = homeModel(homeDoc(), HOME_SELECTION, null, at('09:21'), { stale: true, offline: false });
  assert.deepEqual([waiting.freshness, waiting.dot], ['', 'idle']);
  const offline = homeModel(homeDoc(), HOME_SELECTION, null, at('09:21'), { stale: true, offline: true });
  assert.deepEqual([offline.freshness, offline.dot], ['Offline', 'stale']);
});


/* ---- home from votes, its receipts, and the two marks the fix earns ----- */

const rhodesVotes = (count) => Array.from({ length: count }, (_, index) => ({
  day: `2026-08-2${4 + index}`, station: RHODES
}));

function leapModel(votes, opts) {
  const doc = { ...emptyDoc(), trips: [HOME_TRIP], homeVotes: rhodesVotes(votes) };
  return homeModel(doc, { tripId: 't1', direction: 'reverse' }, transferBody(), at('17:40'), {
    predicted: true, fix: { lat: BONDI.location.lat, lon: BONDI.location.lon }, ...opts
  });
}

test('the way home names the evidence that chose it, and only when there is a leap', () => {
  assert.equal(leapModel(3, { leap: 'home' }).directions.receipt, 'Your days usually start at Rhodes.');
  assert.equal(leapModel(0, { leap: 'home' }).directions.receipt, 'You usually travel from Rhodes.');
  assert.equal(leapModel(3, { leap: 'usual' }).directions.receipt, '', 'the usual trip explains itself');
  assert.equal(leapModel(3, {}).directions.receipt, '');
  assert.equal(leapModel(3, { leap: 'home', predicted: false }).directions.receipt, '',
    'an explicit tap needs no receipt');
});

test('home is derived from the votes on every read, with no stored copy', () => {
  assert.deepEqual(leapModel(3, {}).home, { station: RHODES, confidence: 3 });
  assert.deepEqual(leapModel(0, {}).home, { station: RHODES, confidence: 0 });
});

test('the trip the app just saved is marked once, on the open that saved it', () => {
  const loadedAt = at('09:20');
  const doc = (createdAt) => ({
    ...emptyDoc(),
    trips: [{ ...HOME_TRIP, createdAt: new Date(createdAt).toISOString() }]
  });
  const mark = (createdAt, opts = {}) => homeHtml(homeModel(doc(createdAt), HOME_SELECTION,
    transferBody(), at('09:21'), { predicted: true, loadedAt, ...opts }));

  assert.match(mark(at('09:20')), /<i class="hm-new">Just added<\/i>/);
  assert.ok(!mark(at('09:20')).includes('<b>Shown above</b>'), 'SHOWN ABOVE gives way for this open');
  assert.ok(mark(at('09:19')).includes('<b>Shown above</b>'), 'a trip saved before this open is not new');
  assert.ok(!mark(at('09:20'), { predicted: false }).includes('hm-new'));
  assert.ok(!mark(at('09:20'), { loadedAt: undefined }).includes('hm-new'));
});

test('the strip is the inferred header\'s receipt, and only its own', () => {
  const journey = transferJourneys()[0];
  const focused = (by) => ({
    ...emptyDoc(),
    trips: [HOME_TRIP],
    focus: { tripId: 't1', direction: 'forward', focusedAt: '2026-09-01T09:21:00+10:00', by, journey }
  });
  const model = homeModel(focused('inferred'), HOME_SELECTION, transferBody(), at('09:33'), {});
  const html = homeHtml(model);

  assert.deepEqual(model.strip, {
    origin: RHODES,
    destination: BONDI,
    departureMs: departureMs(journey),
    journeyKey: departureKey(journey),
    slot: 'below'
  });
  assert.match(html, /<div class="hm-rule"><\/div>\s*<div class="hm-strip" data-strip>/,
    'the strip sits under the heavy rule');
  assert.ok(html.includes('<div class="hm-strip" data-strip><span class="q">Going somewhere else?</span>'
    + '<button data-act="change-destination" data-tap>Change</button></div>'), 'one line, two parts');
  assert.ok(html.indexOf('hm-strip') < html.indexOf('data-t="trip-list"'), 'and above MY TRIPS');

  assert.equal(homeModel(focused('focus'), HOME_SELECTION, transferBody(), at('09:33'), {}).strip, null);
  assert.ok(!homeHtml(homeModel(focused('focus'), HOME_SELECTION, transferBody(), at('09:33'), {}))
    .includes('hm-strip'));
  assert.equal(homeModel({ ...emptyDoc(), trips: [HOME_TRIP] }, HOME_SELECTION,
    transferBody(), at('09:33'), {}).strip, null);
});

test('A2 moves the inferred correction into the receipt slot', () => {
  const journey = transferJourneys()[0];
  const doc = {
    ...emptyDoc(),
    trips: [HOME_TRIP],
    focus: {
      tripId: 't1', direction: 'forward', focusedAt: '2026-09-01T09:21:00+10:00',
      by: 'inferred', journey
    }
  };
  const a2 = homeModel(doc, HOME_SELECTION, transferBody(), at('09:33'), { stripVariant: 'a2' });
  const html = homeHtml(a2);

  assert.equal(a2.strip.slot, 'receipt');
  assert.ok(html.includes('<span class="hm-rec hm-rec-strip" data-strip>'
    + '<span class="q">Going somewhere else?</span>'
    + '<button data-act="change-destination" data-tap>Change</button></span>'));
  assert.doesNotMatch(html, /<div class="hm-rule"><\/div>\s*<div class="hm-strip"/,
    'A2 leaves nothing below the heavy rule');
  assert.ok(html.indexOf('hm-rec-strip') < html.indexOf('hm-rule'));
});

test('a fix at the destination ends the trip before its timetable does', () => {
  const journey = transferJourneys()[0];
  const doc = {
    ...emptyDoc(),
    trips: [HOME_TRIP],
    focus: { tripId: 't1', direction: 'forward', focusedAt: '2026-09-01T09:21:00+10:00', by: 'inferred', journey }
  };
  const model = (opts) => homeModel(doc, HOME_SELECTION, transferBody(), at('10:03'), opts);

  assert.equal(model({}).over, false);
  assert.equal(model({ arrived: true }).over, true);
  assert.equal(model({ arrived: true }).status.text, 'Trip over');
  assert.ok(homeHtml(model({ arrived: true })).includes('Show the way back'));
});
