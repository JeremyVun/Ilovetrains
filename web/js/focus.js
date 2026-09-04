/* "I'm on this train" — the focused journey, per
   docs/contracts/client-storage.md. Pure: a storage document, a journey and
   `now` in, a new document or render-ready directions model out.

   The whole point of the snapshot is that a focused journey stays viewable
   after the board has dropped it: rowmodel.js removes departed services and is
   right to, so once you are on the train the durable copy is the one
   in localStorage. On every refresh the client re-matches it in fresh data by
   (first leg's line, timetabled departure) and replaces the snapshot when it
   matches, so live delays keep flowing; when it no longer matches — it has
   departed, or the network is gone — the last snapshot stands. */

import { clock, minutesUntil, countdownFigure } from './time.js';
import { journeyKey, legsOf, arrivalMs, departureMs, effective, TIGHT_CHANGE_MIN } from './journey.js';
import { shortName } from './dom.js';

/* Half an hour past arrival the journey is over and directions are clutter
   (client-storage.md). Clearing is automatic so nobody has to remember to. */
export const FOCUS_CLEAR_MS = 30 * 60_000;

export function focusOf(doc) {
  return (doc && doc.focus) || null;
}

/** At most one focused journey: focusing another replaces it. */
export function setFocus(doc, selection, journey, nowMs) {
  return {
    ...doc,
    focus: {
      tripId: selection.tripId,
      direction: selection.direction,
      focusedAt: new Date(nowMs).toISOString(),
      journey
    }
  };
}

export function clearFocus(doc) {
  const next = { ...doc };
  delete next.focus;
  return next;
}

export function isFocused(doc, journey) {
  const focus = focusOf(doc);
  return Boolean(focus && journeyKey(focus.journey) === journeyKey(journey));
}

/** Past the arrival plus the grace window. A snapshot whose arrival we never
    learned falls back to when it was focused, so nothing can pin directions
    to the screen forever. */
export function focusExpired(focus, nowMs) {
  if (!focus) return false;
  const arrival = arrivalMs(focus.journey);
  const base = arrival === null ? Date.parse(focus.focusedAt) : arrival;
  return Number.isFinite(base) && nowMs > base + FOCUS_CLEAR_MS;
}

export function matchJourney(journeys, snapshot) {
  const key = journeyKey(snapshot);
  return (Array.isArray(journeys) ? journeys : []).find((j) => journeyKey(j) === key) || null;
}

/**
 * Called on every successful refresh: expire the focus if the journey is long
 * over, otherwise refresh its snapshot from the new data when this board is
 * the one carrying it. An unmatched journey keeps the snapshot it has — that
 * is what makes directions survive the journey's own departure.
 */
export function refreshFocus(doc, selection, body, nowMs) {
  const focus = focusOf(doc);
  if (!focus) return doc;
  if (focusExpired(focus, nowMs)) return clearFocus(doc);
  if (!selection || selection.tripId !== focus.tripId || selection.direction !== focus.direction) return doc;
  const match = matchJourney(body && body.journeys, focus.journey);
  if (!match) return doc;
  return { ...doc, focus: { ...focus, journey: match } };
}

/** A cancelled leg cancels the journey (api.md). */
export function journeyCancelled(journey) {
  return Boolean(journey && (journey.cancelled === true
    || legsOf(journey).some((item) => item.cancelled === true)));
}

function departureDelayMinutes(item) {
  const scheduled = Date.parse(((item || {}).departure || {}).scheduled || '');
  const estimated = Date.parse(((item || {}).departure || {}).estimated || '');
  if (!Number.isFinite(scheduled) || !Number.isFinite(estimated)) return null;
  return Math.floor(estimated / 60000) - Math.floor(scheduled / 60000);
}

/* The one status the header's top line and the focused saved row share.
   Late needs fresh data, a realtime estimate on the leg the rider is actually
   waiting on, and a positive delta between printed minutes; cancellation and
   arrival outrank it (ui.md, smart home). */
export function focusStatus(journey, opts = {}) {
  const state = (text, kind, late, leg, delay) => ({ text, kind, late, leg, delay });
  if (opts.over) return state('Trip over', 'complete', false, -1, 0);
  if (journeyCancelled(journey)) return state('Cancelled', 'exception', false, -1, 0);
  const leg = Number.isInteger(opts.activeLeg) && opts.activeLeg >= 0 ? opts.activeLeg : 0;
  const delay = departureDelayMinutes(legsOf(journey)[leg]);
  return !opts.stale && delay !== null && delay > 0
    ? state('Running late', 'late', true, leg, delay)
    : state('Running', 'ordinary', false, leg, delay || 0);
}

/** Smart-header directions state. This is deliberately pure: changing the
    business thresholds never changes the renderer or its percentage axis. */
export function directionsModel(value, nowMs, opts = {}) {
  const journey = value && value.journey ? value.journey : value;
  const legs = legsOf(journey, opts);
  const first = legs[0] || {};
  const last = legs[legs.length - 1] || {};
  const depMs = departureMs(journey);
  const arrMs = arrivalMs(journey);
  const scheduledDep = Date.parse((first.departure || {}).scheduled || '');
  const estimatedDep = Date.parse((first.departure || {}).estimated || '');
  const departureDelay = Number.isFinite(scheduledDep) && Number.isFinite(estimatedDep)
    ? Math.floor(estimatedDep / 60000) - Math.floor(scheduledDep / 60000) : 0;
  const total = depMs === null || arrMs === null
    ? 1 : Math.max(1, Math.floor(arrMs / 60000) - Math.floor(depMs / 60000));
  const elapsed = depMs === null ? 0
    : Math.floor(nowMs / 60000) - Math.floor(depMs / 60000);
  const at = depMs === null ? 0 : Math.max(0, Math.min(1, elapsed / total));
  const stale = Boolean(opts.stale);
  const cancelled = legs.find((leg) => leg.cancelled === true) || (journey && journey.cancelled ? first : null);

  const changes = [];
  for (let i = 1; i < legs.length; i++) {
    const before = legs[i - 1];
    const after = legs[i];
    const arrival = effective(before.arrival);
    const departure = effective(after.departure);
    const scheduledArrival = Date.parse((before.arrival || {}).scheduled || '');
    const scheduledDeparture = Date.parse((after.departure || {}).scheduled || '');
    const minutes = arrival === null || departure === null ? null : minutesUntil(departure, arrival);
    const printed = Number.isFinite(scheduledArrival) && Number.isFinite(scheduledDeparture)
      ? minutesUntil(scheduledDeparture, scheduledArrival) : null;
    changes.push({
      index: i,
      arrival,
      departure,
      minutes,
      printed,
      tight: minutes !== null && (minutes < TIGHT_CHANGE_MIN || (printed !== null && minutes < printed)),
      station: shortName((before.to && before.to.name) || (after.from && after.from.name) || ''),
      fromPlatform: cleanPlatform(before.to && before.to.platform),
      toPlatform: cleanPlatform(after.from && after.from.platform)
    });
  }

  const model = {
    journey,
    from: shortName((first.from && first.from.name) || opts.fromName || ''),
    to: shortName((last.to && last.to.name) || opts.toName || ''),
    depTime: depMs === null ? '—' : clock(depMs),
    arrTime: arrMs === null ? '—' : clock(arrMs),
    figure: '',
    provenance: '',
    instruction: first.headsign || (journey && journey.destinationHeadsign) || '',
    phase: 'pre',
    activeLeg: 0,
    progress: { at, phase: 'pre' },
    showBoardingPlatform: true,
    warn: false,
    // Separate from `warn`: a cancellation warns in words, but its connection
    // is not at risk, and only risk may paint the transfer gap (ui.md).
    tight: false,
    provenanceWarn: false,
    receipt: opts.receipt || '',
    changes
  };

  if (opts.cancelledTime || cancelled) {
    model.warn = true;
    model.figure = depMs === null || stale ? '' : countdownFigure(minutesUntil(depMs, nowMs));
    model.provenance = '';
    model.instruction = `${opts.cancelledTime || model.depTime} CANCELLED · NEXT TRAIN`;
    return model;
  }
  if (depMs === null || arrMs === null) {
    model.provenance = 'SCHEDULED';
    return model;
  }
  if (nowMs < depMs) {
    const minutes = minutesUntil(depMs, nowMs);
    model.figure = stale ? '' : countdownFigure(minutes);
    model.provenance = departureDelay > 0
      ? `${departureDelay} MIN LATE`
      : first.departure && first.departure.estimated ? '' : 'SCHEDULED';
    model.provenanceWarn = departureDelay > 0;
    if (opts.leave) {
      model.instruction = `Leave now for Platform ${cleanPlatform(first.from && first.from.platform) || '—'}`;
      model.receipt = opts.receipt || `You’re ${opts.leave} from ${model.from}.`;
      model.act = true;
    }
    return model;
  }
  if (nowMs >= arrMs) {
    model.phase = 'done';
    model.progress = { at: 1, phase: 'done' };
    model.figure = stale ? '' : countdownFigure(Math.max(0, -minutesUntil(arrMs, nowMs)));
    model.provenance = 'AGO';
    model.instruction = `You arrived at ${model.to}.`;
    model.showBoardingPlatform = false;
    model.act = true;
    return model;
  }

  model.showBoardingPlatform = false;
  model.act = true;
  let phase = 'ride';
  for (let i = 0; i < legs.length; i++) {
    const legArrival = effective(legs[i].arrival);
    const next = changes[i];
    if (legArrival !== null && nowMs < legArrival) {
      const hasChange = Boolean(next);
      model.figure = stale ? '' : countdownFigure(minutesUntil(legArrival, nowMs));
      model.provenance = hasChange ? 'TO CHANGE' : 'TO GO';
      model.instruction = `Get off at ${hasChange ? next.station : model.to}`
        + (cleanPlatform(legs[i].to && legs[i].to.platform)
          ? ` · Platform ${cleanPlatform(legs[i].to.platform)}` : '');
      model.activeLeg = i;
      phase = i === 0 ? 'ride' : 'ride2';
      break;
    }
    if (next && next.departure !== null && nowMs < next.departure) {
      model.figure = stale ? '' : countdownFigure(minutesUntil(next.departure, nowMs));
      model.provenance = 'TO CHANGE';
      // Directions name the station you change at, not only the platform.
      model.instruction = `Change at ${next.station}`
        + (next.toPlatform ? ` · Platform ${next.toPlatform}` : '');
      model.activeLeg = next.index;
      phase = 'dwell';
      break;
    }
  }
  model.phase = phase;
  model.progress = { at, phase };
  const risk = changes.find((change) => change.tight
    && (change.departure === null || nowMs < change.departure));
  if (risk) {
    model.warn = true;
    model.tight = true;
    model.instruction = `Tight change · ${risk.minutes} min`
      + (risk.toPlatform ? ` · Platform ${risk.toPlatform}` : '');
    if (risk.printed !== null && risk.minutes < risk.printed) {
      model.receipt = `Printed change was ${risk.printed} min.`;
    }
  }
  return model;
}

function cleanPlatform(value) {
  return value ? String(value).replace(/^platform\s+/i, '') : '';
}
