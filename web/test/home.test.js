process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { directionsModel } from '../js/focus.js';
import { fitStationNames } from '../js/dom.js';
import { homeHtml, homeModel, inferHome, tripIsOver } from '../js/home.js';
import { emptyDoc } from '../js/storage.js';
import { cancelLeg, delayLeg, transferBody, transferJourneys } from './fixture.js';

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

test('home inference uses three device-only morning/evening votes', () => {
  const doc = emptyDoc();
  const rhodes = { id: '213820', name: 'Rhodes' };
  const city = { id: '200060', name: 'Central' };
  doc.trips = [{ id: 't', from: rhodes, to: city, createdAt: new Date(0).toISOString() }];
  doc.rides = [0, 1, 2].map((day) => ({
    tripId: 't',
    direction: 'reverse',
    departedAt: `2026-08-${28 + day}T17:00:00+10:00`,
    arrivedAt: `2026-08-${28 + day}T17:30:00+10:00`,
    from: city,
    to: rhodes
  }));
  const result = inferHome(doc, at('20:00'));
  assert.equal(result.inferred.station.id, rhodes.id);
  assert.equal(result.inferred.confidence, 3);
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
    to: { id: '200080', name: 'Bondi Junction Station' },
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
        station('200080', 'Bondi Junction Station', -33.8915, 151.2477)),
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
    directions, ranked, home: { home: null, moved: null }, status: null,
    top: { lead: 'Next train', name: '' },
    over: false, freshness: 'Live', dot: 'live', askLocation: false
  };
}


/* ---- the ported smart home ---------------------------------------------- */

const RHODES = { id: '213820', name: 'Rhodes Station', location: { lat: -33.8299, lon: 151.0866 } };
const BONDI = { id: '200080', name: 'Bondi Junction Station', location: { lat: -33.8915, lon: 151.2477 } };
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

test('view-history receipts say check, not ride', () => {
  const doc = { ...homeDoc(), history: [{ tripId: 't1', direction: 'forward', t: '2026-08-28T09:20:00+10:00' }] };
  const morning = homeModel(doc, HOME_SELECTION, transferBody(), at('09:21'), {});
  const afternoon = homeModel(doc, HOME_SELECTION, transferBody(), at('15:21'), {});

  assert.equal(morning.directions.receipt, 'You check this trip most weekday mornings.');
  assert.equal(afternoon.directions.receipt, 'You often check this trip around now.');
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

/* Focus is written by `Take this train` and cleared by the return offer or the
   30-minute expiry, and by nothing else: browsing another trip must not move
   the journey the rider is following (ruling 18, selection precedence). */
test('a saved-trip row tap selects and routes, and leaves focus alone', () => {
  const main = readFileSync(join(import.meta.dirname, '..', 'js', 'main.js'), 'utf8');
  const branch = /if \(action === 'open-trip'\) \{([\s\S]*?)\n  \}/.exec(main);

  assert.ok(branch, 'homeAction still handles the row tap');
  assert.match(branch[1], /state\.selection = \{ tripId: element\.dataset\.id/);
  assert.match(branch[1], /ctx\.go\('#\/board'\)/);
  assert.ok(!/focus/i.test(branch[1]), 'the row tap does not touch focus');
  assert.equal(main.match(/setFocus\(/g).length, 1, 'only journey detail writes focus');
});
