import test from 'node:test';
import assert from 'node:assert/strict';

import { journeyBarSpec, journeyBarHtml, axisSignature } from '../js/journeybar.js';
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
