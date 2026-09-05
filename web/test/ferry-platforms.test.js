process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { detailHtml } from '../js/detail.js';
import { directionsModel } from '../js/focus.js';
import { boardingLabel, journeyDetail, platformChip, transferPlatformChip } from '../js/journey.js';
import { journeyDeviceHtml } from '../js/journeybar.js';
import { promotedRow } from '../js/rowmodel.js';
import { exceptionalFerryJourneys } from './fixture.js';

function upstreamPlatforms(name) {
  const path = fileURLToPath(new URL(`../../tools/fixtures/${name}`, import.meta.url));
  const body = JSON.parse(readFileSync(path, 'utf8'));
  return body.journeys.flatMap((journey) => journey.legs || [])
    .flatMap((leg) => [leg.origin?.properties?.platformName, leg.destination?.properties?.platformName])
    .filter(Boolean);
}

function mappedBody(name) {
  const path = fileURLToPath(new URL(`../../tools/fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('ferry boarding labels preserve the exceptional values in captured probes', () => {
  const balmainEast = upstreamPlatforms('trip_circularquay_balmaineast.json');
  const balmain = upstreamPlatforms('trip_barangaroo_balmain.json');
  assert.ok(balmainEast.includes('Side A'));
  assert.ok(balmain.includes('Balmain Wharf'));

  assert.equal(boardingLabel('Wharf 3, Side A', 'ferry'), 'Wharf 3, Side A');
  assert.equal(boardingLabel('Side A', 'ferry'), 'Side A');
  assert.equal(boardingLabel('Balmain Wharf', 'ferry'), 'Balmain Wharf');
  assert.deepEqual([
    platformChip('Wharf 3, Side A'), platformChip('Side A'),
    platformChip('Balmain Wharf'), platformChip('Barangaroo Wharf 2')
  ], ['3', '', '', '2']);
  assert.deepEqual([
    transferPlatformChip('Wharf 3, Side A', 'ferry'), transferPlatformChip('Side A', 'ferry'),
    transferPlatformChip('Balmain Wharf', 'ferry'), transferPlatformChip('Barangaroo Wharf 2', 'ferry')
  ], ['3A', 'A', '', '2']);
});

test('side-only and named wharves stay visible without invented numbers', () => {
  const [, , island] = exceptionalFerryJourneys();
  const model = journeyDetail(island, Date.parse('2026-09-05T16:10:00+10:00'));
  assert.equal(model.steps[1].boardingPlace, 'Side A');
  assert.equal(model.steps[1].on.platform, 'A');
  assert.equal(model.arrival.label, 'Balmain Wharf');
  assert.equal(model.steps.at(-1).chip.platform, '—');

  const html = detailHtml({
    ...model,
    row: promotedRow(island, Date.parse('2026-09-05T16:10:00+10:00')),
    focused: false,
    footer: { dot: 'live', text: 'Live' }
  });
  assert.match(html, /data-ferry-location="Side A" data-role="board" data-stop="Cockatoo Island Wharf"[^>]*>A<\/b>/);
  assert.match(html, /Board F8 · Balmain · <span data-boarding-location="Side A"><span class="dside">Side A<\/span><\/span>/);
  assert.match(html, /<span class="lbl p">Balmain Wharf<\/span>/);
  assert.doesNotMatch(html, /Wharf Side A|Wharf Balmain Wharf/);

  const sideOrigin = structuredClone(island);
  sideOrigin.departure.platform = 'Side A';
  sideOrigin.legDetail[0].from.platform = 'Side A';
  assert.match(journeyDeviceHtml(sideOrigin, { caps: true }).html,
    /class="sy-cap" data-line-code="F3" data-ferry-location="Side A" data-role="origin"[^>]*>Side A<\/span>/);
});

test('a walk between hubs names both endpoints and boards at the second', () => {
  const [, walkChange] = exceptionalFerryJourneys();
  const detail = journeyDetail(walkChange, Date.parse('2026-09-05T16:10:00+10:00'));
  assert.deepEqual([
    detail.changes[0].station,
    detail.changes[0].fromStation,
    detail.changes[0].toStation
  ], ['Wynyard → Barangaroo Wharf', 'Wynyard', 'Barangaroo Wharf']);
  assert.equal(detail.steps[1].boardingPlace, 'Wharf 2, Side B');

  const riding = directionsModel(walkChange, Date.parse('2026-09-05T16:04:00+10:00'));
  assert.equal(riding.instruction, 'Get off at Wynyard · Platform 5');
  const dwelling = directionsModel(walkChange, Date.parse('2026-09-05T16:10:00+10:00'));
  assert.equal(dwelling.instruction, 'Change at Barangaroo Wharf · Wharf 2, Side B');

  const device = journeyDeviceHtml(walkChange, { caps: true, changes: detail.changes, stations: true });
  assert.match(device.html, />Wynyard → Barangaroo Wharf<\/span>/);

  const html = detailHtml({
    ...detail,
    row: promotedRow(walkChange, Date.parse('2026-09-05T16:10:00+10:00')),
    focused: false,
    footer: { dot: 'live', text: 'Live' }
  });
  assert.match(html, /class="sy-row change distinct-stop [^"]*promoted"/);
  assert.match(html, /data-ferry-location="Wharf 2, Side B" data-role="board" data-stop="Barangaroo Wharf"[^>]*>2B<\/b>/);
  assert.match(html, /Board F4 · Balmain East · <span data-boarding-location="Wharf 2, Side B">Wharf 2, <span class="dside">Side B<\/span><\/span>/);
});

test('captured Pyrmont transfers keep each real side in compact green chips', () => {
  const forward = mappedBody('departures_pyrmont_doublebay.json');
  const forwardJourney = forward.journeys[1];
  const forwardDetail = journeyDetail(forwardJourney, Date.parse(forward.generatedAt));
  const forwardDevice = journeyDeviceHtml(forwardJourney, {
    caps: true, originName: forward.from.name, changes: forwardDetail.changes, stations: true
  });

  assert.match(forwardDevice.html, /data-role="origin"[^>]*>Pyrmont Bay Wharf<\/span>/,
    'the first label uses the named boarding location without inventing a number');
  assert.match(forwardDevice.html,
    /data-ferry-location="Wharf 5, Side B" data-role="alight" data-stop="Circular Quay"[^>]*>5B<\/span>/);
  assert.match(forwardDevice.html,
    /data-ferry-location="Wharf 4, Side B" data-role="board" data-stop="Circular Quay"[^>]*>4B<\/span>/);
  assert.equal(forwardDevice.spec.total,
    forwardDevice.spec.legs.reduce((sum, leg) => sum + leg.minutes, 0) + forwardDevice.spec.dwell);

  const reverse = mappedBody('departures_doublebay_pyrmont.json');
  const reverseJourney = reverse.journeys[0];
  const reverseDevice = journeyDeviceHtml(reverseJourney, {
    caps: true, originName: reverse.from.name
  });
  assert.match(reverseDevice.html,
    /data-ferry-location="Wharf 5, Side B" data-role="alight" data-stop="Circular Quay"[^>]*>5B<\/span>/);
  assert.match(reverseDevice.html,
    /data-ferry-location="Wharf 5, Side A" data-role="board" data-stop="Circular Quay"[^>]*>5A<\/span>/);

  const control = mappedBody('departures_circularquay_manly.json');
  const controlDevice = journeyDeviceHtml(control.journeys[0], {
    caps: true, originName: control.from.name
  });
  assert.match(controlDevice.html,
    /data-ferry-location="Wharf 4, Side A" data-role="origin" data-stop="Circular Quay"[^>]*>Wharf 4, Side A<\/span>/);

  const model = journeyDetail(forwardJourney, Date.parse(forward.generatedAt));
  const html = detailHtml({
    ...model,
    row: promotedRow(forwardJourney, Date.parse(forward.generatedAt)),
    focused: false,
    footer: { dot: 'live', text: 'Live' }
  });
  assert.match(html,
    /data-ferry-location="Pyrmont Bay Wharf" data-role="origin" data-stop="Pyrmont Bay Wharf"[^>]*>Pyrmont Bay Wharf<\/b>/);
  assert.match(html,
    /data-ferry-location="Wharf 5, Side B" data-role="alight" data-stop="Circular Quay"[^>]*>5B<\/b>/);
  assert.match(html,
    /data-ferry-location="Wharf 4, Side B" data-role="board" data-stop="Circular Quay"[^>]*>4B<\/b>/);
  assert.match(html,
    /data-boarding-location="Wharf 4, Side B">Wharf 4, <span class="dside">Side B<\/span>/);
});
