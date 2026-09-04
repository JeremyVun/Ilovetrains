import test from 'node:test';
import assert from 'node:assert/strict';

import { journeyBarSpec, journeyBarHtml, journeyDeviceHtml, journeyVars, axisSignature } from '../js/journeybar.js';
import { transferJourneys } from './fixture.js';

test('the journey bar is one exact percentage time axis', () => {
  const spec = journeyBarSpec(transferJourneys()[0]);
  assert.equal(axisSignature(spec), '27/7/10');
  assert.equal(spec.total, 44);

  const leg1End = spec.legs[0].minutes / spec.total * 100;
  const leg2Start = (spec.legs[0].minutes + spec.dwells[0]) / spec.total * 100;
  assert.equal(leg1End, 27 / 44 * 100);
  assert.equal(leg2Start, 34 / 44 * 100);

  const html = journeyBarHtml(spec, { caps: true });
  assert.match(html, new RegExp(`width:${leg1End}%`));
  assert.match(html, new RegExp(`left:${leg2Start}%`));
  assert.match(html, />3<\/span>.*>5<\/span>/);
});

test('progress paints before transfer numerals so it cannot obscure them', () => {
  const spec = journeyBarSpec(transferJourneys()[0]);
  const html = journeyBarHtml(spec, {
    caps: true,
    progress: { at: 0.76, phase: 'ride2' }
  });
  assert.ok(html.indexOf('sy-mk') < html.indexOf('sy-p a'));
  assert.ok(html.indexOf('sy-dim') < html.indexOf('sy-p a'));
});

test('a real return journey keeps its own platform numbers in ride order', () => {
  const outbound = transferJourneys()[0];
  const reverse = structuredClone(outbound);
  reverse.legDetail = [
    {
      ...reverse.legDetail[1],
      line: { name: 'T4', mode: 'train' },
      from: { name: 'Bondi Junction', platform: 'Platform 2' },
      to: { name: 'Town Hall', platform: 'Platform 4' }
    },
    {
      ...reverse.legDetail[0],
      line: { name: 'T9', mode: 'train' },
      from: { name: 'Town Hall', platform: 'Platform 1' },
      to: { name: 'Rhodes', platform: 'Platform 1' }
    }
  ];
  const spec = journeyBarSpec(reverse);
  const html = journeyBarHtml(spec, { caps: true });
  assert.equal(spec.legs[0].code, 'T4');
  assert.equal(spec.legs[1].code, 'T9');
  assert.match(html, />4<\/span>.*>1<\/span>/);
});

/* Ruling 37: a filled device carries the official line colour, not the darkened
   token the light scheme needs for bare text. */
test('every filled part of the device paints the fill role', () => {
  const spec = journeyBarSpec(transferJourneys()[0]);
  const device = journeyDeviceHtml(transferJourneys()[0], { caps: true, showBoardingPlatform: true });

  assert.equal(journeyVars(spec), '--stem:var(--line-fill-T9);--stem2:var(--line-fill-T4);'
    + '--chipink:var(--ink);--chipink2:var(--ink);');
  assert.match(device.html, /class="sy-r a leg-0"[^>]*background:var\(--line-fill-T9\)/);
  assert.match(device.html, /class="sy-p a"[^>]*background:var\(--line-fill-T9\)/);
  assert.match(device.html, /class="sy-p b"[^>]*background:var\(--line-fill-T4\)/);
  assert.doesNotMatch(device.html, /background:var\(--line-T[0-9]\)/, 'no bare-text token on a fill');
});

/* B4: a tight change is painted on its own dwell alone; a comfortable second
   change stays a hairline. */
test('a tight change colours its own dwell and no other', () => {
  const spec = journeyBarSpec(transferJourneys()[0]);
  const changes = [{ tight: true, station: 'Town Hall' }, { tight: false, station: 'Central' }];

  const html = journeyBarHtml({ ...spec, dwells: [7, 5], legs: [...spec.legs, spec.legs[1]], total: 51 }, { changes });
  const gaps = [...html.matchAll(/data-transfer-gap="(\d)"( data-tight-gap="true")?/g)];
  assert.deepEqual(gaps.map((m) => Boolean(m[2])), [true, false]);
});

test('the station a change happens at hangs off the platform it is boarded from', () => {
  const journey = transferJourneys()[0];
  const changes = [{ tight: false, station: 'Town Hall' }];
  const attached = journeyDeviceHtml(journey, { caps: true, changes, stations: true });

  assert.match(attached.html,
    /class="sy-p b"[^>]*data-transfer-index="0"[^>]*><span class="sy-pv">5<\/span><span class="sy-pstn" data-transfer-station data-transfer-index="0">Town Hall</);

  // The smart header's own call, unchanged: no station labels, one tight flag.
  const header = journeyDeviceHtml(journey, {
    caps: true, progress: { at: 0.2, phase: 'ride' }, tight: true, showBoardingPlatform: true
  });
  assert.doesNotMatch(header.html, /sy-pstn/);
  assert.match(header.html, /class="sy-g0 warn"/);
});
