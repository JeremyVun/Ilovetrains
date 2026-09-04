/* The departure board's data model. Pure: an API body plus `now` in, a
   render-ready board out. No DOM, no fetch, no clock reads.

   THE RULE (docs/contracts/ui.md, binding): the slot under the figure reserves
   room for interpretation-changing provenance — DEPARTING / SCHEDULED /
   N MIN LATE / CANCELLED — and every row body is exactly three lines in every
   state, so no delay, cancellation or missing feed can push the sixth service
   past the fold. `rowLines()` is that invariant, written down. */

import { parseIso, clock, minutesUntil, ageLabel, countdownFigure } from './time.js';
import { lineColour, lineFill } from './lines.js';
import { journeyDetail, journeyKey } from './journey.js';

/* 30s refresh cadence plus margin: past this, a countdown is a claim the data
   cannot support. */
export const STALE_MS = 90_000;
const LIVE_DOT_MS = 45_000;

/* The contract copy fits the full label idiom at every supported width. */
export const CANCELLED_LEAD_NOTE = (time) => time + ' cancelled · next train';

export function boardModel(body, nowMs, opts = {}) {
  const staleMs = opts.staleMs ?? STALE_MS;
  const generatedAt = parseIso(body && body.generatedAt);
  const ageMs = generatedAt === null ? null : Math.max(0, nowMs - generatedAt);
  const stale = Boolean(opts.forceStale) || ageMs === null || ageMs > staleMs;
  const ageSec = ageMs === null ? 0 : ageMs / 1000;

  const liveJourneys = Array.isArray(body && body.journeys) ? body.journeys : [];
  const liveKeys = new Set(liveJourneys.map(journeyKey));
  const futureRows = liveJourneys
    .map((j) => journeyRow(j, nowMs, stale, { ...opts, pastSource: false }))
    .filter((r) => r !== null && !r.past);

  const pastRows = (Array.isArray(opts.pastBodies) ? opts.pastBodies : [])
    .flatMap((page) => Array.isArray(page && page.journeys) ? page.journeys : [])
    // A live answer is newer than a settled past page. It wins even when the
    // past cache still carries an older estimate for the same service.
    .filter((journey) => !liveKeys.has(journeyKey(journey)))
    .map((j) => journeyRow(j, nowMs, false, { ...opts, pastSource: true }))
    .filter((r) => r !== null && r.past);

  const uniquePast = [...new Map(pastRows.map((row) => [row.matchKey, row])).values()]
    .sort((a, b) => a.effectiveMs - b.effectiveMs);

  markLeadAndCancelledLead(futureRows);

  // A board that was never loaded has no age. Reporting one ("last updated 0s
  // ago") would date a board that does not exist, and on a cold open with no
  // cache it flashed OFFLINE at a client that was merely still asking.
  const hasData = generatedAt !== null;
  const waiting = !hasData && !opts.forceStale;

  return {
    stale,
    ageSec,
    rows: futureRows,
    futureRows,
    pastRows: uniquePast,
    empty: futureRows.length === 0 && uniquePast.length === 0,
    sparse: futureRows.length > 0 && futureRows.length < 6,
    footer: {
      text: hasData ? ageLabel(ageSec, stale) : (waiting ? '' : 'Offline'),
      // `degraded` is the server's X-Data-Stale header: the data is fresh
      // enough to count down, but nobody should see a confident green dot.
      // `idle` is not a colour: it leaves the dot its resting grey while the
      // first answer is still in the post.
      dot: waiting ? 'idle'
        : stale || opts.degraded || ageSec * 1000 > LIVE_DOT_MS ? 'stale' : 'live'
    }
  };
}

/** The figure in the big slot: a dash for a cancellation, nothing at all off
    stale data (a countdown from an old cache is a lie), "Now" for
    the minute a service is leaving in, minutes up to 99, and rounded hours
    beyond that — the unit changes so the figure stays one
    glance wide. */
export const CANCELLED_FIGURE = '—';

function figureFor(cancelled, stale, mins) {
  if (cancelled) return CANCELLED_FIGURE;
  if (stale) return '';
  return countdownFigure(mins);
}

function journeyRow(journey, nowMs, stale, opts) {
  const dep = journey && journey.departure ? journey.departure : {};
  const scheduled = parseIso(dep.scheduled);
  const estimated = parseIso(dep.estimated);
  if (scheduled === null && estimated === null) return null;

  const candidateEffective = estimated === null ? scheduled : estimated;
  const candidateMins = minutesUntil(candidateEffective, nowMs);
  const past = candidateMins < 0;
  if (past && !opts.pastSource) return null;

  const cancelled = journey.cancelled === true;
  const realtime = estimated !== null;
  const firstLeg = Array.isArray(journey.legDetail) && journey.legDetail.length
    ? journey.legDetail[0] : null;
  // A past page's estimate is an actual only while upstream still carries the
  // realtime record. Row age and position never manufacture that claim.
  const actual = past && opts.pastSource && realtime
    && (!firstLeg || parseIso((firstLeg.departure || {}).estimated) !== null);
  const effective = past && !actual && scheduled !== null ? scheduled : candidateEffective;
  const mins = minutesUntil(effective, nowMs);
  // Delay is measured between the minutes actually displayed, so the label can
  // never disagree with the two clock times beside it.
  const delayMin = realtime && scheduled !== null
    ? Math.floor(estimated / 60000) - Math.floor(scheduled / 60000)
    : 0;

  const arrival = journey.arrival || {};
  const arrivalMs = past && !actual
    ? parseIso(arrival.scheduled)
    : parseIso(arrival.estimated) ?? parseIso(arrival.scheduled);

  let kind, provenance;
  if (past && !actual) { kind = 'sched'; provenance = 'TIMETABLE ONLY'; }
  else if (cancelled) { kind = 'cx'; provenance = 'CANCELLED'; }
  else if (delayMin > 0) { kind = 'late'; provenance = past ? 'AGO' : delayMin + ' MIN LATE'; }
  else if (past) { kind = 'live'; provenance = 'AGO'; }
  else if (!realtime || stale) { kind = 'sched'; provenance = 'SCHEDULED'; }
  // "Now" is not a count of minutes, so the slot under it names what is
  // happening instead of its unit (docs/contracts/ui.md).
  else { kind = 'live'; provenance = mins <= 0 ? 'DEPARTING' : ''; }

  const figure = past
    ? (actual && !cancelled ? countdownFigure(Math.max(0, -mins)) : (cancelled ? CANCELLED_FIGURE : ''))
    : figureFor(cancelled, stale, mins);

  const lineCode = (journey.line && journey.line.name) || '';

  return {
    key: (dep.scheduled || dep.estimated) + '|' + lineCode + '|' + (dep.platform || ''),
    // The identity the detail view and the focus snapshot re-match on
    // (client-storage.md). The row key above also carries the platform, which
    // upstream can revise; this one is the pair that cannot move.
    matchKey: journeyKey(journey),
    effectiveMs: effective,
    journey,
    first: false,
    // "Now" and a rounded "10H" are the two reachable three-character figures;
    // the stylesheet sizes them down rather than let them leave the column.
    wide: figure.length >= 3,
    cancelled,
    past,
    actual,
    pastKind: past ? (actual ? 'actual' : 'timetable') : null,
    scheduledOnly: !realtime || (past && !actual),
    delayMin,
    mins,
    kind,
    figure,
    provenance,
    provenanceWarn: cancelled || (!past && delayMin > 0),
    depTime: clock(effective),
    // A timetable-only row may carry a stale delta in malformed/cached input;
    // neither number is allowed to become a punctuality claim without actuals.
    schedTime: delayMin > 0 && scheduled !== null && (!past || actual) ? clock(scheduled) : null,
    // A cancelled row keeps its arrival: it is what the next train is judged against.
    arrTime: arrivalMs === null ? null : clock(arrivalMs),
    platform: dep.platform ? String(dep.platform).replace(/^platform\s+/i, '') : null,
    lineCode,
    lineColour: lineColour(lineCode),
    lineFill: lineFill(lineCode),
    headsign: journey.destinationHeadsign || opts.fallbackHeadsign || '',
    transfers: typeof journey.legs === 'number' && journey.legs > 1,
    changes: changesOf(journey, nowMs, cancelled),
    note: null
  };
}

/** The one row journey detail promotes. Unlike a board row it survives its own
    departure: the board drops a departed service, detail is still showing the
    journey the rider is on. */
export function promotedRow(journey, nowMs, opts = {}) {
  return journeyRow(journey, nowMs, Boolean(opts.stale), { ...opts, pastSource: true });
}

/* Read through `journeyDetail` so a row and the detail view can never disagree
   about a window. A cancelled service is broken, not tight: colouring its dwell
   would be the board telling the same bad news twice in two different words. */
function changesOf(journey, nowMs, cancelled) {
  return journeyDetail(journey, nowMs).changes.map((change) => ({
    station: change.station,
    fromPlatform: change.fromPlatform,
    toPlatform: change.toPlatform,
    minutes: change.minutes,
    printed: change.printedMin,
    tight: change.tight && !cancelled,
    broken: change.broken || cancelled
  }));
}

/* The lead row carries the colour stem. When the lead is cancelled the board
   says so in the same breath as the replacement (transplant from concept C):
   the next running service states what happened to the one you came for. */
function markLeadAndCancelledLead(rows) {
  if (!rows.length) return;
  rows[0].first = true;
  if (!rows[0].cancelled) return;
  const next = rows.find((r) => !r.cancelled);
  if (next) next.note = CANCELLED_LEAD_NOTE(rows[0].depTime);
}

/**
 * The three lines of a row's body, in order. Every entry is non-empty in every
 * state — that is the invariant the whole board rests on.
 */
export function rowLines(row) {
  const line1 = [
    row.depTime,
    row.schedTime ? '(was ' + row.schedTime + ')' : '',
    row.arrTime ? 'arrives ' + row.arrTime : ''
  ].filter(Boolean).join(' ');

  const line2 = ['Platform ' + (row.platform || '—'), row.lineCode || '—'].join(' · ');

  const line3 = row.note || row.headsign || '—';

  return [line1, line2, line3];
}
