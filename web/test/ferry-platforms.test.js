process.env.TZ = 'Australia/Sydney';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { detailHtml } from '../js/detail.js';
import { directionsModel } from '../js/focus.js';
import { boardingLabel, journeyDetail, platformChip } from '../js/journey.js';
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
});

test('side-only and named wharves stay visible while their chips use a dash', () => {
  const [, , island] = exceptionalFerryJourneys();
  const model = journeyDetail(island, Date.parse('2026-09-05T16:10:00+10:00'));
  assert.equal(model.steps[1].boardingPlace, 'Side A');
  assert.equal(model.steps[1].on.platform, '—');
  assert.equal(model.arrival.label, 'Balmain Wharf');
  assert.equal(model.steps.at(-1).chip.platform, '—');

  const html = detailHtml({
    ...model,
    row: promotedRow(island, Date.parse('2026-09-05T16:10:00+10:00')),
    focused: false,
    footer: { dot: 'live', text: 'Live' }
  });
  assert.match(html, /Board · <span class="dside">Side A<\/span>/);
  assert.match(html, /<span class="lbl p">Balmain Wharf<\/span>/);
  assert.doesNotMatch(html, /Wharf Side A|Wharf Balmain Wharf/);

  const sideOrigin = structuredClone(island);
  sideOrigin.departure.platform = 'Side A';
  sideOrigin.legDetail[0].from.platform = 'Side A';
  assert.match(journeyDeviceHtml(sideOrigin, { caps: true }).html,
    /class="sy-cap" data-line-code="F3">Side A<\/span>/);
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
});
