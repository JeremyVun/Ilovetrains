/* The journey detail view's data model — a port of comps/a1-ledger.html
   (docs/backlog/journey-focus/comps/shots/a1-ledger-390x844-hero.png, the
   exemplar) with the transplants docs/STYLES.md ruled in. Pure: a journey
   object from /api/v1/departures plus `now` in, render-ready blocks out. No
   DOM, no fetch, no clock reads.

   The detail view is the board's own row grammar, three blocks deep: leg,
   change, leg. It is EXEMPT from the board's three-line invariant (owner
   ruling 2026-09-01) — a journey has two legs, not six, so the third line may
   wrap rather than truncate. What it is not exempt from is the rule the
   invariant serves: every figure states its provenance, and the vocabulary is
   closed (MIN / DEPARTING / SCHEDULED / N MIN LATE / CANCELLED / TO CHANGE /
   ON BOARD / MIN TO GO).

   Two rules from the comps round bind the arithmetic here:
   - Change windows are measured between CLOCK MINUTES (time.js's floor rule),
     so the change figure can never disagree with the two times printed beside
     it. The real 4-minute change on this corridor — 11:08:42 into Town Hall,
     11:12:00 out — is 3m18s of wall clock and 4 minutes of printed timetable,
     and 4 is what the page must say.
   - The tight-connection treatment states two times and two windows and makes
     NO claim about whether you make it. The app has no data that could support
     such a claim and a wrong "you'll miss it" is the worst error this screen
     can make. */

import { parseIso, clock, minutesUntil, countdownFigure } from './time.js';
import { lineColour } from './lines.js';
import { shortName } from './dom.js';

/* A change window this short is worth colouring even when nothing has gone
   wrong: tight connections are normal on this corridor (DESIGN.md), so the
   treatment is not an edge case. */
export const TIGHT_CHANGE_MIN = 5;

/** The time a leg actually happens at: the estimate when the leg is realtime
    controlled, the timetable otherwise (api.md — `estimated` is null unless
    THAT leg is monitored, so one journey can mix the two). */
export function effective(times) {
  if (!times) return null;
  const estimated = parseIso(times.estimated);
  return estimated === null ? parseIso(times.scheduled) : estimated;
}

/** The service legs, in order. A body cached before the server shipped
    `legDetail` still has to render, so a journey without one is read as the
    single leg it describes. */
export function legsOf(journey, opts = {}) {
  if (!journey) return [];
  const detail = journey.legDetail;
  if (Array.isArray(detail) && detail.length) return detail;
  return [{
    line: journey.line || {},
    headsign: journey.destinationHeadsign || '',
    from: { name: opts.fromName || '', platform: (journey.departure || {}).platform || null },
    to: { name: opts.toName || '', platform: null },
    departure: journey.departure || {},
    arrival: journey.arrival || {},
    cancelled: journey.cancelled === true
  }];
}

/** The identity a focused journey is re-matched by across refreshes
    (docs/contracts/client-storage.md): the first leg's line and its
    TIMETABLED departure — the one field a delay cannot move. */
export function journeyKey(journey) {
  const first = legsOf(journey)[0] || {};
  const line = (first.line && first.line.name)
    || (journey && journey.line && journey.line.name) || '';
  const scheduled = (first.departure && first.departure.scheduled)
    || (journey && journey.departure && journey.departure.scheduled) || '';
  return line + '|' + scheduled;
}

export function arrivalMs(journey) {
  const fromJourney = journey ? effective(journey.arrival) : null;
  if (fromJourney !== null) return fromJourney;
  const legs = legsOf(journey);
  const last = legs[legs.length - 1];
  return last ? effective(last.arrival) : null;
}

export function departureMs(journey) {
  const first = legsOf(journey)[0];
  const fromLeg = first ? effective(first.departure) : null;
  if (fromLeg !== null) return fromLeg;
  return journey ? effective(journey.departure) : null;
}

function platformOf(place) {
  const raw = place && place.platform;
  return raw ? String(raw).replace(/^platform\s+/i, '') : null;
}

/**
 * One service leg, in the board's row grammar.
 *
 * Four states the board does not have, and one it does:
 * - WAITING: the board's own row, figure counting to departure.
 * - ON BOARD (transplant from A2, owner ruling): you are riding it, so the
 *   figure counts to the moment you step OFF and the platform printed is the
 *   one you step onto — "4 MIN" under a train you are already on would be a
 *   count of the wrong thing.
 * - DONE: the leg is behind you. The figure slot empties and keeps its height,
 *   exactly as the stale board's does, because a countdown to something that
 *   has already happened is not a number anyone can use.
 * - CANCELLED: the board's struck-through idiom, per leg — journey-level
 *   `cancelled` says a journey is broken, `legDetail[].cancelled` says which
 *   leg broke it.
 */
function legRow(leg, index, nowMs, stale) {
  const dep = leg.departure || {};
  const arr = leg.arrival || {};
  const depScheduled = parseIso(dep.scheduled);
  const depEstimated = parseIso(dep.estimated);
  const depMs = depEstimated === null ? depScheduled : depEstimated;
  const arrMs = effective(arr);

  const realtime = depEstimated !== null;
  const cancelled = leg.cancelled === true;
  // Measured between the minutes actually displayed, so the label can never
  // disagree with the two clock times beside it.
  const delayMin = realtime && depScheduled !== null
    ? Math.floor(depEstimated / 60000) - Math.floor(depScheduled / 60000)
    : 0;

  const toDeparture = depMs === null ? null : minutesUntil(depMs, nowMs);
  const toArrival = arrMs === null ? null : minutesUntil(arrMs, nowMs);
  const done = !cancelled && toArrival !== null && toArrival <= 0;
  const onBoard = !cancelled && !done && toDeparture !== null && toDeparture < 0;

  let kind, provenance, figure;
  if (cancelled) {
    kind = 'cx'; provenance = 'CANCELLED'; figure = '–';
  } else if (done) {
    kind = 'done'; provenance = ''; figure = '';
  } else if (onBoard) {
    kind = realtime ? 'live' : 'sched';
    provenance = 'ON BOARD';
    figure = stale || toArrival === null ? '' : countdownFigure(toArrival);
  } else {
    if (delayMin > 0) { kind = 'late'; provenance = delayMin + ' MIN LATE'; }
    else if (!realtime || stale) { kind = 'sched'; provenance = 'SCHEDULED'; }
    else { kind = 'live'; provenance = toDeparture <= 0 ? 'DEPARTING' : 'MIN'; }
    figure = stale || toDeparture === null ? '' : countdownFigure(toDeparture);
  }

  const lineCode = (leg.line && leg.line.name) || '';
  const offAt = shortName((leg.to && leg.to.name) || '');

  return {
    type: 'leg',
    index,
    first: index === 0,
    kind,
    figure,
    wide: figure.length >= 3,
    provenance,
    provenanceWarn: cancelled || delayMin > 0,
    cancelled,
    scheduledOnly: !realtime,
    onBoard,
    done,
    delayMin,
    // The headline pair: the time you act on, the timetable it moved from, and
    // what happens at it.
    time: depMs === null ? '' : clock(depMs),
    struck: delayMin > 0 && depScheduled !== null ? clock(depScheduled) : null,
    tail: arrMs === null || cancelled ? null : 'arrives ' + clock(arrMs),
    platform: platformOf(leg.from),
    arrPlatform: platformOf(leg.to),
    lineCode,
    lineColour: lineColour(lineCode),
    headsign: leg.headsign || '',
    arrTime: arrMs === null ? null : clock(arrMs),
    offAt
  };
}

/** The ON BOARD leg prints the arrival, not the departure: the fact you need
    on a train you are already on is when to stand up and where you land — and
    the platform that matters is the one you step ONTO, not the one you
    boarded from (A2, transplanted). */
function ridingHeadline(row) {
  return {
    ...row,
    time: row.arrTime || row.time,
    struck: null,
    tail: 'off at ' + row.offAt,
    platform: row.arrPlatform
  };
}

/**
 * The change between two legs: the station once, the platform pair, both
 * times, and the window — bracketed by the masthead's own heavy rule.
 */
function changeBlock(prev, next, nowMs, stale) {
  const arrMs = effective(prev.arrival);
  const depMs = effective(next.departure);
  const arrScheduled = parseIso((prev.arrival || {}).scheduled);
  const depScheduled = parseIso((next.departure || {}).scheduled);

  const minutes = arrMs === null || depMs === null ? null : minutesUntil(depMs, arrMs);
  const printedMin = arrScheduled === null || depScheduled === null
    ? null : minutesUntil(depScheduled, arrScheduled);

  // A cancelled leg either side is not a tight connection, it is a broken one,
  // and the leg row says so. Colouring the window as well would be the screen
  // telling the same bad news twice in two different words.
  const broken = prev.cancelled === true || next.cancelled === true;
  const shrunk = minutes !== null && printedMin !== null && minutes < printedMin;
  const tight = !broken && minutes !== null && (minutes < TIGHT_CHANGE_MIN || shrunk);
  const done = depMs !== null && minutesUntil(depMs, nowMs) < 0;

  const figure = stale || done || minutes === null ? '' : String(minutes);

  return {
    type: 'change',
    station: shortName((prev.to && prev.to.name) || (next.from && next.from.name) || ''),
    fromPlatform: platformOf(prev.to),
    toPlatform: platformOf(next.from),
    minutes,
    printedMin,
    figure,
    wide: figure.length >= 3,
    provenance: figure ? 'TO CHANGE' : '',
    tight,
    shrunk,
    broken,
    done,
    arrTime: arrMs === null ? null : clock(arrMs),
    // Both times, the timetabled one struck (A3, verbatim). Only when the
    // window actually shrank: printing "was 4 min" beside a 4-minute change
    // would be the page arguing with itself.
    arrStruck: shrunk && arrScheduled !== null ? clock(arrScheduled) : null,
    depTime: depMs === null ? null : clock(depMs),
    warnline: shrunk && printedMin !== null ? 'Printed change was ' + printedMin + ' min' : null
  };
}

/* "1 change at Town Hall · arrives 10:08". Journey DURATION is deliberately
   not here: a 5-minute delay on the first leg with an unchanged arrival turns
   a "44 min" journey into a "39 min" one, which is arithmetically true and
   reads as though the delay made it faster. */
function ledeFor(changes, arrTime) {
  const arrives = arrTime ? 'arrives ' + arrTime : '';
  let what;
  if (!changes.length) what = 'Direct';
  else if (changes.length === 1) what = '1 change at ' + changes[0].station;
  else if (changes.length === 2) what = '2 changes at ' + changes[0].station + ' and ' + changes[1].station;
  else what = changes.length + ' changes';
  return [what, arrives].filter(Boolean).join(' · ');
}

/**
 * The whole detail view. `blocks` is the ledger in print order — leg, change,
 * leg — and everything else is the masthead and the closing line.
 */
export function journeyDetail(journey, nowMs, opts = {}) {
  const stale = Boolean(opts.stale);
  const legs = legsOf(journey, opts);
  const rows = legs.map((leg, i) => {
    const row = legRow(leg, i, nowMs, stale);
    return row.onBoard ? ridingHeadline(row) : row;
  });
  const changes = [];
  const blocks = [];
  legs.forEach((leg, i) => {
    if (i > 0) {
      const change = changeBlock(legs[i - 1], leg, nowMs, stale);
      changes.push(change);
      blocks.push(change);
    }
    blocks.push(rows[i]);
  });

  const first = legs[0] || {};
  const last = legs[legs.length - 1] || {};
  const depMs = departureMs(journey);
  const arrMs = arrivalMs(journey);
  const departed = depMs !== null && minutesUntil(depMs, nowMs) < 0;
  const toGo = arrMs === null ? null : minutesUntil(arrMs, nowMs);
  const arrTime = arrMs === null ? null : clock(arrMs);
  const cancelledLeg = rows.findIndex((r) => r.cancelled);

  return {
    key: journeyKey(journey),
    stale,
    blocks,
    legs: rows,
    changes,
    from: shortName((first.from && first.from.name) || opts.fromName || ''),
    to: shortName((last.to && last.to.name) || opts.toName || ''),
    departed,
    toGo,
    cancelled: cancelledLeg >= 0,
    cancelledLeg,
    lede: ledeFor(changes, arrTime),
    // The journey ends somewhere, and that platform is stated nowhere else on
    // the screen. Read from the leg that actually arrives, every render — a
    // replacement service can land on a different platform (DESIGN.md).
    arrival: {
      time: arrTime,
      station: shortName((last.to && last.to.name) || opts.toName || ''),
      platform: platformOf(last.to),
      cancelled: last.cancelled === true
    }
  };
}
