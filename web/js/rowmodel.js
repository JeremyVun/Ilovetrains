/* The departure board's data model. Pure: an API body plus `now` in, a
   render-ready board out. No DOM, no fetch, no clock reads.

   THE RULE (docs/STYLES.md, binding): the slot under the figure always states
   that figure's provenance — MIN / SCHEDULED / N MIN LATE / CANCELLED — and
   every row is exactly three lines in every state, so no delay, cancellation
   or missing feed can push the sixth service past the fold. `rowLines()` is
   that invariant, written down. */

import { parseIso, clock, minutesUntil, ageLabel } from './time.js';
import { lineColour } from './lines.js';

/* 30s refresh cadence plus margin: past this, a countdown is a claim the data
   cannot support (owner ruling 2026-08-31). */
export const STALE_MS = 90_000;
const LIVE_DOT_MS = 45_000;

export const CANCELLED_LEAD_NOTE = (time) => time + ' cancelled · next running service';

export function boardModel(body, nowMs, opts = {}) {
  const staleMs = opts.staleMs ?? STALE_MS;
  const generatedAt = parseIso(body && body.generatedAt);
  const ageMs = generatedAt === null ? null : Math.max(0, nowMs - generatedAt);
  const stale = Boolean(opts.forceStale) || ageMs === null || ageMs > staleMs;
  const ageSec = ageMs === null ? 0 : ageMs / 1000;

  const journeys = Array.isArray(body && body.journeys) ? body.journeys : [];
  const rows = journeys
    .map((j) => journeyRow(j, nowMs, stale, opts))
    .filter((r) => r !== null);

  markLeadAndCancelledLead(rows);

  // A board that was never loaded has no age. Reporting one ("last updated 0s
  // ago") would date a board that does not exist, and on a cold open with no
  // cache it flashed OFFLINE at a client that was merely still asking.
  const hasData = generatedAt !== null;
  const waiting = !hasData && !opts.forceStale;

  return {
    stale,
    ageSec,
    rows,
    empty: rows.length === 0,
    sparse: rows.length > 0 && rows.length < 6,
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
    stale data (owner ruling: a countdown from an old cache is a lie), else the
    minutes — or "Now" for the minute a service is leaving in. */
function figureFor(cancelled, stale, mins) {
  if (cancelled) return '–';
  if (stale) return '';
  return mins <= 0 ? 'Now' : String(mins);
}

function journeyRow(journey, nowMs, stale, opts) {
  const dep = journey && journey.departure ? journey.departure : {};
  const scheduled = parseIso(dep.scheduled);
  const estimated = parseIso(dep.estimated);
  if (scheduled === null && estimated === null) return null;

  const effective = estimated === null ? scheduled : estimated;
  const mins = minutesUntil(effective, nowMs);
  if (mins < 0) return null; // departed: the list closes upward

  const cancelled = journey.cancelled === true;
  const realtime = estimated !== null;
  // Delay is measured between the minutes actually displayed, so the label can
  // never disagree with the two clock times beside it.
  const delayMin = realtime && scheduled !== null
    ? Math.floor(estimated / 60000) - Math.floor(scheduled / 60000)
    : 0;

  const arrival = journey.arrival || {};
  const arrivalMs = parseIso(arrival.estimated) ?? parseIso(arrival.scheduled);

  let kind, provenance;
  if (cancelled) { kind = 'cx'; provenance = 'CANCELLED'; }
  else if (delayMin > 0) { kind = 'late'; provenance = delayMin + ' MIN LATE'; }
  else if (!realtime || stale) { kind = 'sched'; provenance = 'SCHEDULED'; }
  else { kind = 'live'; provenance = 'MIN'; }

  const figure = figureFor(cancelled, stale, mins);

  const lineCode = (journey.line && journey.line.name) || '';

  return {
    key: (dep.scheduled || dep.estimated) + '|' + lineCode + '|' + (dep.platform || ''),
    first: false,
    // Three characters ("187", "Now") do not fit the figure column at the
    // board's headline size — measured 129px in an 86px column, which put the
    // hero figure through the departure time on the late-night board. The row
    // says so and the stylesheet sizes it down; nothing is ever clipped.
    wide: figure.length >= 3,
    cancelled,
    scheduledOnly: !realtime,
    delayMin,
    mins,
    kind,
    figure,
    provenance,
    provenanceWarn: cancelled || delayMin > 0,
    depTime: clock(effective),
    schedTime: delayMin > 0 && scheduled !== null ? clock(scheduled) : null,
    arrTime: cancelled || arrivalMs === null ? null : clock(arrivalMs),
    platform: dep.platform ? String(dep.platform).replace(/^platform\s+/i, '') : null,
    lineCode,
    lineColour: lineColour(lineCode),
    headsign: journey.destinationHeadsign || opts.fallbackHeadsign || '',
    transfers: typeof journey.legs === 'number' && journey.legs > 1,
    note: null
  };
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
