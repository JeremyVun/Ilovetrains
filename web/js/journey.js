/* The journey detail view's data model, implementing docs/contracts/ui.md.
   Pure: a journey object from /api/v1/departures plus `now` in, render-ready
   steps out. No DOM, fetch or clock reads.

   Detail promotes the board's own result row and then prints the journey as
   steps: board, one per change, arrive. Two rules bind the arithmetic:
   - Change windows are measured between CLOCK MINUTES (time.js's floor rule),
     so a window can never disagree with the two times printed beside it. The
     real 4-minute change on this corridor — 11:08:42 into Town Hall, 11:12:00
     out — is 3m18s of wall clock and 4 minutes of printed timetable, and 4 is
     what the page must say.
   - The tight-connection treatment states the window and makes NO claim about
     whether you make it. The app has no data that could support such a claim
     and a wrong "you'll miss it" is the worst error this screen can make. */

import { parseIso, clock, minutesUntil } from './time.js';
import { shortName } from './dom.js';

/* A change this short is worth colouring even when realtime did not shrink
   it; short scheduled connections are normal. */
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

function lineCode(leg) {
  return (leg && leg.line && leg.line.name) || '';
}

function behind(ms, nowMs) {
  return ms !== null && minutesUntil(ms, nowMs) < 0;
}

/** The window between two legs, and the two platforms it is crossed between. */
function changeBetween(prev, next, nowMs) {
  const arrMs = effective(prev.arrival);
  const depMs = effective(next.departure);
  const arrScheduled = parseIso((prev.arrival || {}).scheduled);
  const depScheduled = parseIso((next.departure || {}).scheduled);

  const minutes = arrMs === null || depMs === null ? null : minutesUntil(depMs, arrMs);
  const printedMin = arrScheduled === null || depScheduled === null
    ? null : minutesUntil(depScheduled, arrScheduled);

  // A cancelled leg either side is not a tight connection, it is a broken one,
  // and the step says so. Colouring the window as well would be the screen
  // telling the same bad news twice in two different words.
  const broken = prev.cancelled === true || next.cancelled === true;
  const shrunk = minutes !== null && printedMin !== null && minutes < printedMin;

  return {
    station: shortName((prev.to && prev.to.name) || (next.from && next.from.name) || ''),
    fromPlatform: platformOf(prev.to),
    toPlatform: platformOf(next.from),
    minutes,
    printedMin,
    tight: !broken && minutes !== null && (minutes < TIGHT_CHANGE_MIN || shrunk),
    broken,
    done: behind(depMs, nowMs),
    arrTime: arrMs === null ? null : clock(arrMs),
    depTime: depMs === null ? null : clock(depMs)
  };
}

function chip(code, platform) {
  return { code, platform: platform || '—' };
}

function boardLabel(leg) {
  const headsign = leg.headsign || '';
  return ['Board', lineCode(leg)].filter(Boolean).join(' ') + (headsign ? ' · ' + headsign : '');
}

/**
 * The journey in print order: board, one step per change, arrive. A step
 * states a time, a place, the platform you use there and what you do — never
 * a countdown, so a step cannot go stale between refreshes.
 */
function stepsOf(legs, changes, cancelled, nowMs) {
  const first = legs[0] || {};
  const last = legs[legs.length - 1] || {};
  const depMs = effective(first.departure);
  const arrMs = effective(last.arrival);
  const finalCancelled = cancelled[legs.length - 1] === true;

  const steps = [{
    kind: 'board',
    time: depMs === null ? '—' : clock(depMs),
    station: shortName((first.from && first.from.name) || ''),
    chip: chip(lineCode(first), platformOf(first.from)),
    label: boardLabel(first),
    tight: false,
    cancelled: cancelled[0] === true,
    done: behind(depMs, nowMs)
  }];

  changes.forEach((change, index) => {
    const broken = cancelled[index] === true || cancelled[index + 1] === true;
    const tight = change.tight && !broken;
    steps.push({
      kind: 'change',
      time: change.minutes === null ? '—' : change.minutes + ' min',
      station: change.station,
      off: chip(lineCode(legs[index]), change.fromPlatform),
      on: chip(lineCode(legs[index + 1]), change.toPlatform),
      // Ruling 40: the current window is the only one printed.
      label: broken ? 'Cancelled' : tight ? change.minutes + ' min change' : 'Board',
      tight,
      cancelled: broken,
      done: change.done
    });
  });

  steps.push({
    kind: 'arrive',
    time: arrMs === null ? '—' : clock(arrMs),
    station: shortName((last.to && last.to.name) || ''),
    chip: chip(lineCode(last), platformOf(last.to)),
    label: 'Arrive' + (finalCancelled ? ' · Journey cancelled' : ''),
    tight: false,
    cancelled: finalCancelled,
    done: behind(arrMs, nowMs)
  });

  return steps;
}

/* "1 change · arrives 10:08". Journey DURATION is deliberately not here: a
   5-minute delay on the first leg with an unchanged arrival turns a "44 min"
   journey into a "39 min" one, which is arithmetically true and reads as
   though the delay made it faster. */
function summaryOf(changes, arrTime) {
  const count = changes.length;
  const what = count === 0 ? 'Direct' : count + (count === 1 ? ' change' : ' changes');
  return [what, arrTime ? 'arrives ' + arrTime : ''].filter(Boolean).join(' · ');
}

/* The cancellation names the departure it takes away, which is the fact that
   tells the rider whether the train they came for is the one they lost. */
function cancelledSummary(leg) {
  const depMs = effective(leg.departure);
  return 'The ' + (depMs === null ? '—' : clock(depMs))
    + ' from ' + shortName((leg.from && leg.from.name) || '') + ' is cancelled.';
}

/** The whole detail view: the masthead's summary, the steps in travel order,
    the closing line, and the change windows the promoted row shares. */
export function journeyDetail(journey, nowMs, opts = {}) {
  const legs = legsOf(journey, opts);
  const changes = [];
  for (let i = 1; i < legs.length; i++) changes.push(changeBetween(legs[i - 1], legs[i], nowMs));

  // A journey the API cancels without naming a leg is cancelled in all of
  // them, which is what the struck board row already says.
  const named = legs.findIndex((leg) => leg.cancelled === true);
  const wholeJourney = named < 0 && Boolean(journey && journey.cancelled === true);
  const cancelled = legs.map((leg) => wholeJourney || leg.cancelled === true);
  const cancelledLeg = named >= 0 ? named : (wholeJourney ? 0 : -1);

  const first = legs[0] || {};
  const last = legs[legs.length - 1] || {};
  const arrMs = arrivalMs(journey);
  const arrTime = arrMs === null ? null : clock(arrMs);

  return {
    key: journeyKey(journey),
    stale: Boolean(opts.stale),
    from: shortName((first.from && first.from.name) || opts.fromName || ''),
    to: shortName((last.to && last.to.name) || opts.toName || ''),
    summary: cancelledLeg >= 0 ? cancelledSummary(legs[cancelledLeg]) : summaryOf(changes, arrTime),
    summaryWarn: cancelledLeg >= 0,
    steps: stepsOf(legs, changes, cancelled, nowMs),
    changes,
    cancelled: cancelledLeg >= 0,
    cancelledLeg,
    departed: behind(departureMs(journey), nowMs),
    // The journey ends somewhere, and that platform is stated nowhere else on
    // the screen. Read from the leg that actually arrives, every render — a
    // replacement service can land on a different platform.
    arrival: {
      time: arrTime,
      station: shortName((last.to && last.to.name) || opts.toName || ''),
      platform: platformOf(last.to),
      cancelled: cancelled[legs.length - 1] === true
    }
  };
}
