import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { journeyBarSpec, journeyBarHtml, journeyDeviceHtml, journeyVars, axisSignature } from '../js/journeybar.js';
import { ferryJourneys, mixedJourneys, transferJourneys } from './fixture.js';

const css = readFileSync(fileURLToPath(new URL('../app.css', import.meta.url)), 'utf8');

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

/* A filled device carries the official line colour, not the darkened token the
   light scheme needs for bare text. */
test('every filled part of the device paints the fill role', () => {
  const spec = journeyBarSpec(transferJourneys()[0]);
  const device = journeyDeviceHtml(transferJourneys()[0], { caps: true, showBoardingPlatform: true });

  assert.equal(journeyVars(spec), '--stem:var(--line-fill-T9);--stem2:var(--line-fill-T4);'
    + '--chipink:var(--ink);--chipink2:var(--ink);');
  assert.match(device.html, /class="sy-r a leg-0"[^>]*><span class="sy-rp"[^>]*background:var\(--line-fill-T9\)/);
  assert.match(device.html, /class="sy-p a"[^>]*background:var\(--line-fill-T9\)/);
  assert.match(device.html, /class="sy-p b"[^>]*background:var\(--line-fill-T4\)/);
  assert.doesNotMatch(device.html, /background:var\(--line-T[0-9]\)/, 'no bare-text token on a fill');
});

test('transfer chips keep their axis anchors without border or shadow masks', () => {
  const shared = /\.sy-bar \.sy-p \{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
  const alight = /\.sy-bar \.sy-p\.a \{([^}]*)\}/.exec(css)?.[1] || '';
  const board = /\.sy-bar \.sy-p\.b \{([^}]*)\}/.exec(css)?.[1] || '';
  const clamped = /\.sy-row \.sy-p\[data-clamped="1"\] \{([^}]*)\}/.exec(css)?.[1] || '';
  const html = journeyBarHtml(journeyBarSpec(transferJourneys()[0]), { caps: true });

  assert.doesNotMatch(shared, /border-left/);
  assert.doesNotMatch(alight, /border-left/);
  assert.doesNotMatch(board, /border-left/);
  assert.doesNotMatch(clamped, /box-shadow/);
  assert.match(html, /class="sy-r a leg-0"[^>]*style="left:0%;width:[^"]+"><span class="sy-rp"/);
  assert.match(html, /class="sy-r b leg-1"[^>]*style="left:[^"]+"><span class="sy-rp"/);
  assert.match(html, /class="sy-p a"[^>]*style="right:/);
  assert.match(html, /class="sy-p b"[^>]*style="left:/);
});

/* A tight change is painted on its own dwell alone; a comfortable second
   change stays a hairline. */
test('a tight change colours its own dwell and no other', () => {
  const spec = journeyBarSpec(transferJourneys()[0]);
  const changes = [{ tight: true, station: 'Town Hall' }, { tight: false, station: 'Central' }];

  const html = journeyBarHtml({ ...spec, dwells: [7, 5], legs: [...spec.legs, spec.legs[1]], total: 51 }, { changes });
  const gaps = [...html.matchAll(/data-transfer-gap="(\d)"( data-tight-gap="true")?/g)];
  assert.deepEqual(gaps.map((m) => Boolean(m[2])), [true, false]);
});

test('transfer labels sit at the dwell midpoint, independently of the boarding chip', () => {
  const journey = transferJourneys()[0];
  const changes = [{ tight: false, station: 'Town Hall' }];
  const attached = journeyDeviceHtml(journey, { caps: true, changes, stations: true });
  const midpoint = (27 + 7 / 2) / 44 * 100;
  const actual = Number(/data-midpoint="([^"]+)"/.exec(attached.html)[1]);
  assert.ok(Math.abs(actual - midpoint) < 1e-10);
  assert.match(attached.html, /<span class="sy-pv">5<\/span><\/span><span class="sy-pstn"/);
  for (const phase of ['pre', 'done', 'ride', 'dwell', 'ride2']) {
    const html = journeyDeviceHtml(journey, { caps: true, changes, stations: true,
      progress: { at: phase === 'pre' ? 0 : 0.5, phase } }).html;
    const active = ['ride', 'dwell', 'ride2'].includes(phase);
    assert.equal(html.includes('sy-mk'), active, phase);
    assert.equal(html.includes('sy-pstn travelling'), active, phase);
  }
});

test('ferry devices keep a full origin and compact transfer side', () => {
  const direct = journeyDeviceHtml(ferryJourneys()[1], { caps: true });
  assert.equal(direct.vars, '--stem:var(--line-fill-FERRY);--stem2:var(--line-fill-FERRY);'
    + '--chipink:var(--bg);--chipink2:var(--bg);');
  assert.match(direct.html, />Wharf 3, Side A<\/span>/);
  assert.match(direct.html, /data-line-code="F1" data-colour-key="FERRY"[^>]*background:var\(--line-fill-FERRY\)/);

  const mixed = journeyDeviceHtml(mixedJourneys()[1], { caps: true });
  assert.match(mixed.html, /data-ferry-location="Wharf 3, Side A" data-role="board" data-stop="Circular Quay"[^>]*>3A<\/span>/);
});

test('a transfer prints each known location when its counterpart is missing', () => {
  const missingBoard = structuredClone(mixedJourneys()[1]);
  missingBoard.legDetail[1].from.platform = null;
  const alight = journeyDeviceHtml(missingBoard, {
    caps: true, changes: [{ station: 'Circular Quay' }], stations: true
  });
  assert.match(alight.html,
    /data-pin="a"[^>]*aria-label="Platform 2 · T8"[^>]*>2<\/span>[\s\S]*<span class="sy-pstn"[^>]*>Circular Quay<\/span>/);
  assert.doesNotMatch(alight.html, /data-pin="b"/);

  const missingAlight = structuredClone(mixedJourneys()[1]);
  missingAlight.legDetail[0].to.platform = null;
  const board = journeyDeviceHtml(missingAlight, {
    caps: true, changes: [{ station: 'Circular Quay' }], stations: true
  });
  assert.doesNotMatch(board.html, /data-pin="a"/);
  assert.match(board.html,
    /data-pin="b"[\s\S]*data-ferry-location="Wharf 3, Side A" data-role="board" data-stop="Circular Quay"/);
  assert.match(board.html, /data-transfer-station[^>]*>Circular Quay<\/span>/);

  missingAlight.legDetail[1].from.platform = null;
  const neither = journeyDeviceHtml(missingAlight, {
    caps: true, changes: [{ station: 'Circular Quay' }], stations: true
  });
  assert.doesNotMatch(neither.html, /data-ferry-location/);
  assert.match(neither.html,
    /data-pin="b"[^>]*aria-label="— · F1"[^>]*><span class="sy-pv">—<\/span><\/span><span class="sy-pstn"[^>]*>Circular Quay<\/span>/);

  const rail = structuredClone(transferJourneys()[0]);
  rail.legDetail[1].from.platform = null;
  const railDevice = journeyDeviceHtml(rail, {
    caps: true, changes: [{ station: 'Town Hall' }], stations: true
  });
  assert.doesNotMatch(railDevice.html, /data-pin=|data-transfer-station/,
    'a partial rail transfer keeps its established no-marker rendering');
});

test('the shared device uses Wharf for unnumbered origins and preserves specific boarding positions', () => {
  const repeated = structuredClone(ferryJourneys()[0]);
  repeated.legDetail[0].from.platform = 'Pyrmont Bay Wharf';
  const originName = '  PYRMONT   bay wharf ';

  assert.match(
    journeyDeviceHtml(repeated, { caps: true, originName }).html,
    /class="sy-cap"[^>]*>Wharf<\/span>/,
    'the first label stays visible for an unnumbered boarding place'
  );
  assert.match(
    journeyDeviceHtml(repeated, { caps: true }).html,
    /class="sy-cap"[^>]*>Wharf<\/span>/,
    'the unnumbered fallback does not depend on origin context'
  );

  const side = journeyDeviceHtml(ferryJourneys()[1], {
    caps: true, originName: 'Circular Quay'
  });
  assert.match(side.html, /class="sy-cap"[^>]*>Wharf 3, Side A<\/span>/);

  const named = structuredClone(ferryJourneys()[0]);
  named.legDetail[0].from.platform = 'Balmain Wharf';
  assert.match(
    journeyDeviceHtml(named, { caps: true, originName: 'Barangaroo Wharf' }).html,
    /class="sy-cap"[^>]*>Wharf<\/span>/
  );

  const missing = structuredClone(ferryJourneys()[0]);
  missing.legDetail[0].from.platform = null;
  assert.doesNotMatch(
    journeyDeviceHtml(missing, { caps: true, originName: 'Circular Quay' }).html,
    /class="sy-cap"/
  );

  assert.match(
    journeyDeviceHtml(transferJourneys()[0], { caps: true, originName: 'Rhodes Station' }).html,
    /class="sy-cap"[^>]*>Platform 1<\/span>/,
    'ordinary rail keeps a specific platform'
  );
});

/* The toy hangs off the bar's coloured leg. `data-seg` and `data-line-code`
   sit on nested spans, so a compound selector silently matches nothing. */
test('the tiny train selector matches the leg the bar actually emits', () => {
  const main = readFileSync(fileURLToPath(new URL('../js/main.js', import.meta.url)), 'utf8');
  const selector = /line\?\.querySelector\('([^']+)'\)/.exec(main);

  assert.ok(selector, 'the controller still looks for a coloured leg');
  const [outer, inner] = selector[1].split(' ');
  const html = journeyBarHtml(journeyBarSpec(transferJourneys()[0]));
  const leg = new RegExp(`<span [^>]*${outer.slice(1, -1)}[^>]*>\\s*<span [^>]*${inner.slice(1, -1)}=`);
  assert.equal(selector[1].includes(' '), true, 'the attributes are on nested elements');
  assert.match(html, leg);
});
