process.env.TZ = 'Australia/Sydney'; // every clock string the page prints is device-local

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { detailHtml } from '../js/detail.js';
import { journeyDetail } from '../js/journey.js';
import { promotedRow } from '../js/rowmodel.js';
import {
  TRANSFER_NOW, TRANSFER_DEPARTED_NOW, transferJourneys, delayLeg, cancelLeg,
  FERRY_NOW, ferryJourneys, mixedJourneys
} from './fixture.js';

const ENDS = { fromName: 'Rhodes Station', toName: 'Bondi Junction Station' };

function render(journey, { now = TRANSFER_NOW, focused = false, pinned = false } = {}) {
  const model = journeyDetail(journey, now, ENDS);
  return detailHtml({
    ...model,
    row: promotedRow(journey, now, { ...ENDS, fallbackHeadsign: ENDS.toName }),
    focused, pinned,
    footer: { dot: 'live', text: 'Updated 0s ago' }
  });
}

test('the masthead names the station the board is for, and goes back to it', () => {
  const html = render(transferJourneys()[0]);

  assert.match(html, /<button class="sy-home" data-act="board"><span class="g">←<\/span>Rhodes departures<\/button>/);
  assert.match(html, /<div class="detail-kicker lbl">Journey<\/div>/);
  assert.match(html, /<h1 class="detail-title">Rhodes <em>→<\/em> Bondi Junction<\/h1>/);
  assert.match(html, /<div class="detail-summary" data-summary>1 change · arrives 10:08<\/div>/);
});

test('the promoted row is the board’s row, and is not a tap target', () => {
  const html = render(transferJourneys()[0]);
  const row = /<div class="([^"]*sy-row[^"]*)"([^>]*)>/.exec(html);

  assert.ok(row, 'detail renders the board row');
  assert.match(row[1], /\bpromoted\b/);
  assert.doesNotMatch(row[2], /data-act|role="button"|tabindex/);
  assert.match(html, /<div class="detail-scroll" data-scroller>/);
});

test('every step states a platform chip in its own line colour', () => {
  const html = render(transferJourneys()[0]);
  const chips = [...html.matchAll(/<b class="dchip" data-line-code="([^"]+)"(?: aria-label="[^"]+")? style="background:([^;]+);color:([^"]+)">([^<]+)<\/b>/g)]
    .map((m) => [m[1], m[2], m[3], m[4]]);

  assert.deepEqual(chips, [
    ['T9', 'var(--line-fill-T9)', 'var(--ink)', '1'],
    ['T9', 'var(--line-fill-T9)', 'var(--ink)', '3'],
    ['T4', 'var(--line-fill-T4)', 'var(--ink)', '5'],
    ['T4', 'var(--line-fill-T4)', 'var(--ink)', '2']
  ]);
  assert.match(html, /Board T9 · Gordon via Lindfield/);
  assert.match(html, /class="dact-unit"><b[^>]*>3<\/b><span>Get off<\/span><\/span>/);
  assert.match(html, /class="darrow">→<\/span>/);
  assert.match(html, /class="dact-unit board"><b[^>]*>5<\/b><span class="dact-copy"><span>Board T4 · Bondi Junction · Platform 5<\/span>/);
});

test('ferry detail keeps a full origin and compact transfer chip with full directions', () => {
  const journey = ferryJourneys()[1];
  const model = journeyDetail(journey, FERRY_NOW);
  const html = detailHtml({
    ...model,
    row: promotedRow(journey, FERRY_NOW),
    focused: false,
    footer: { dot: 'live', text: 'Live' }
  });

  assert.match(html, /data-ferry-location="Wharf 3, Side A" data-role="origin" data-stop="Circular Quay"[^>]*aria-label="Wharf 3, Side A · F1"[^>]*>Wharf 3, Side A<\/b>/);
  assert.match(html, /<span class="lbl p">Wharf 1<\/span>/);
  assert.match(html, />Pin this ferry<\/button>/);

  const mixed = mixedJourneys()[1];
  const mixedHtml = detailHtml({
    ...journeyDetail(mixed, FERRY_NOW),
    row: promotedRow(mixed, FERRY_NOW),
    focused: false,
    footer: { dot: 'live', text: 'Live' }
  });
  assert.match(mixedHtml, /class="sy-row change [^"]*ferry-change[^"]*promoted"/);
  assert.match(mixedHtml, /class="dact-unit board"><b[^>]*data-ferry-location="Wharf 3, Side A" data-role="board" data-stop="Circular Quay"[^>]*>3A<\/b><span class="dact-copy"><span>Board F1 · Manly · <span data-boarding-location="Wharf 3, Side A">Wharf 3, <span class="dside">Side A<\/span><\/span>/);

  const cancelled = cancelLeg(mixedJourneys()[1], 1);
  const cancelledHtml = render(cancelled);
  assert.match(cancelledHtml, /class="dchange-note">Cancelled<\/span>/);
  assert.match(cancelledHtml,
    /data-boarding-location="Wharf 3, Side A">Wharf 3, <span class="dside">Side A<\/span>/);
});

test('a tight change is the only step that carries the warning', () => {
  const html = render(delayLeg(transferJourneys()[0], 0, 5));

  const steps = [...html.matchAll(/<div class="(dstep[^"]*)"/g)].map((m) => m[1]);

  assert.deepEqual(steps, ['dstep', 'dstep change tight', 'dstep']);
  assert.match(html, /<span class="dtime">2 min<\/span>/);
  assert.match(html, /2 min change/);
});

test('a cancelled journey warns in the summary, strikes its steps and offers no rail', () => {
  const html = render(cancelLeg(transferJourneys()[0], 1));

  assert.match(html, /<div class="detail-summary warn" data-summary>The 09:58 from Town Hall is cancelled\.<\/div>/);
  assert.match(html, /<div class="dstep change cancelled"/);
  assert.match(html, /Arrive · Journey cancelled/);
  assert.match(html, /<div class="detail-tail cx">/);
  assert.match(html, /<span class="lbl p warn">Journey cancelled<\/span>/);
  assert.doesNotMatch(html, /data-footer-rail|Pin this train/);
});

/* Inferred travel has no pin to release; explicit pins do. */
test('the journey already being followed has no action rail either', () => {
  const journey = transferJourneys()[0];

  assert.match(render(journey), /<div class="hm-bar detail-rail" data-footer-rail><button data-act="focus">Pin this train<\/button><\/div>/);
  assert.doesNotMatch(render(journey, { focused: true }), /data-footer-rail|Pin this train/);
  assert.doesNotMatch(render(journey, { focused: true }), /Unfocus/);
  assert.match(render(journey, { focused: true, pinned: true }), /data-act="unpin">Unpin this train/);
  assert.match(render({ ...journey, cancelled: true }, { focused: true, pinned: true }), /data-act="unpin">Unpin this train/);
});

test('the tail owns the destination, its time and its platform', () => {
  const html = render(transferJourneys()[0]);

  assert.match(html, /<span class="t">10:08<\/span><span class="n">Bondi Junction<\/span><span class="lbl p">Platform 2<\/span>/);
  assert.match(html, /<div class="detail-fresh" data-t="footer"><span class="pulse live"><\/span>Updated 0s ago<\/div>/);
});

/* After departure the steps behind the rider go quiet rather than disappear,
   and nothing on them is struck — a step that happened is not a step that was
   cancelled. */
test('a step behind the rider is quiet, not struck', () => {
  const html = render(transferJourneys()[0], { now: TRANSFER_DEPARTED_NOW });

  assert.match(html, /<div class="dstep done"[^>]*data-step="board"/);
  assert.doesNotMatch(html, /dstep[^"]*cancelled/);
});

/* client-storage.md, Focused journey: `Pin this train` is the only writer of
   focus on this screen, and detail never clears it. */
test('the detail view writes focus once and never clears it', () => {
  const main = readFileSync(fileURLToPath(new URL('../js/main.js', import.meta.url)), 'utf8');
  const action = /function detailAction\(action\) \{[\s\S]*?\n\}/.exec(main);

  assert.ok(action, 'main.js has a detailAction');
  assert.equal((action[0].match(/setFocus\(/g) || []).length, 1);
  assert.doesNotMatch(action[0], /clearFocus\(/);
  assert.match(action[0], /action === 'board'\) return ctx\.go\('#\/board'\)/);
  assert.match(action[0], /ctx\.go\('#\/'\)/);
});
