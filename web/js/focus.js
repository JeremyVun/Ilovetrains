/* The pinned or inferred service, per
   docs/contracts/client-storage.md. Pure: a storage document, a journey and
   `now` in, a new document or render-ready directions model out.

   The whole point of the snapshot is that a focused journey stays viewable
   after the board has dropped it: rowmodel.js removes departed services and is
   right to, so once you are on the train the durable copy is the one
   in localStorage. On every refresh the client re-matches it in fresh data by
   each leg's line and timetabled departure and replaces the snapshot when it
   matches, so live delays keep flowing; when it no longer matches — it has
   departed, or the network is gone — the last snapshot stands. */

import { clock, minutesUntil, countdownFigure } from './time.js';
import {
  boardingLabel, journeyDetail, journeyKey, legsOf, arrivalMs, departureMs, effective, modeWords
} from './journey.js';
import { shortName } from './dom.js';
import { distanceKm } from './stations.js';
import { findTrip, leg } from './storage.js';
import { journeyAllowed, preferencesOf, tripAllowed } from './preferences.js';

/* Half an hour past arrival the journey is over and directions are clutter
   (client-storage.md). Clearing is automatic so nobody has to remember to. */
export const FOCUS_CLEAR_MS = 30 * 60_000;

/* Inferred entry (client-storage.md, Travel mode). The journey must be under
   way, the previous open must have been on its platform shortly before it
   left, and the phone must have moved the way the train goes. */
export const TRAVEL_LATE_MS = 30 * 60_000;
export const TRAVEL_SEEN_MS = 15 * 60_000;
export const TRAVEL_MOVED_KM = 1;
export const TRAVEL_SPEED_MS = 8;
export const TRAVEL_SPEED_MOVED_KM = 0.2;
/* Exit: at the destination, the trip is over as the rider steps off. */
export const ARRIVED_KM = 0.2;
export const ARRIVED_EARLY_MS = 5 * 60_000;

export function focusOf(doc) {
  return (doc && doc.focus) || null;
}

/* Stored focus and displayed focus have separate lifetimes. Filtering hides
   an incompatible journey without discarding the rider's saved snapshot. */
export function visibleFocus(doc, nowMs, stations) {
  const focus = focusOf(doc);
  const modes = preferencesOf(doc).enabledModes;
  const trip = focus && findTrip(doc, focus.tripId);
  return focus && !focusExpired(focus, nowMs)
    && tripAllowed(trip, modes, stations) && journeyAllowed(focus.journey, modes)
    ? focus : null;
}

/** At most one focused journey: focusing another replaces it. */
export function setFocus(doc, selection, journey, nowMs, by = 'focus') {
  return {
    ...doc,
    focus: {
      tripId: selection.tripId,
      direction: selection.direction,
      focusedAt: new Date(nowMs).toISOString(),
      by,
      journey
    }
  };
}

/**
 * Travel mode entered from the fix alone: the focus object to set, or null.
 * Condition 3 (moved toward the destination) is what stops a walk back home
 * for a forgotten laptop from reading as a ride.
 */
export function inferTravel(doc, nowMs, fix) {
  const last = doc && doc.lastOpen;
  if (!last || !fix) return null;
  const trip = findTrip(doc, last.tripId);
  if (!trip) return null;
  const ends = leg(trip, last.direction);
  const origin = ends.from.location;
  const destination = ends.to.location;
  if (!origin || !destination) return null;

  const departure = departureMs(last.journey);
  const arrival = arrivalMs(last.journey);
  const seenAt = Date.parse(last.at);
  if (departure === null || arrival === null || !Number.isFinite(seenAt)) return null;
  if (nowMs < departure || nowMs > arrival + TRAVEL_LATE_MS) return null;
  if (!last.station || last.station.id !== ends.from.id) return null;
  if (departure - seenAt > TRAVEL_SEEN_MS) return null;

  const left = distanceKm(fix, origin);
  if (left === null) return null;
  const toward = left >= TRAVEL_MOVED_KM
    && distanceKm(fix, destination) <= distanceKm(origin, destination) - TRAVEL_MOVED_KM;
  const fast = Number.isFinite(fix.speed) && fix.speed >= TRAVEL_SPEED_MS
    && left >= TRAVEL_SPEED_MOVED_KM;
  if (!toward && !fast) return null;

  return {
    tripId: last.tripId,
    direction: last.direction,
    focusedAt: new Date(nowMs).toISOString(),
    by: 'inferred',
    journey: last.journey
  };
}

/** The journey snapshot carries no coordinates, so the destination station
    comes from the saved trip. */
export function arrived(focus, destination, fix, nowMs) {
  if (!focus || !destination || !fix) return false;
  const arrival = arrivalMs(focus.journey);
  if (arrival === null || nowMs < arrival - ARRIVED_EARLY_MS) return false;
  const km = distanceKm(fix, destination.location);
  return km !== null && km <= ARRIVED_KM;
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
  const firstWords = modeWords(first.line && first.line.mode);
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
  const cancelledIndex = legs.findIndex((leg) => leg.cancelled === true);
  const cancelled = cancelledIndex >= 0 ? legs[cancelledIndex]
    : (journey && journey.cancelled ? first : null);

  // Read through journeyDetail so the header, the board row and detail can
  // never disagree about a change window.
  const changes = journeyDetail(journey, nowMs, opts).changes;
  // Computed before the phase branches: a change still ahead is at risk while
  // the rider is waiting for the train too, not only once aboard.
  const risk = changes.find((change) => change.tight
    && (change.departureMs === null || nowMs < change.departureMs));

  /* The leg that left fine is not the leg that was cancelled: once under way,
     the header names the cancelled leg instead of offering a next train. */
  const ridingCancelled = !opts.cancelledTime && cancelledIndex > 0
    && depMs !== null && arrMs !== null && nowMs >= depMs && nowMs < arrMs;

  const model = {
    journey,
    vehicle: firstWords.vehicle,
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
    tight: Boolean(risk),
    provenanceWarn: false,
    receipt: opts.receipt || '',
    changes
  };

  if (!ridingCancelled && (opts.cancelledTime || cancelled)) {
    model.warn = true;
    model.tight = false;
    model.figure = depMs === null ? '' : countdownFigure(minutesUntil(depMs, nowMs));
    model.provenance = '';
    model.instruction = `${opts.cancelledTime || model.depTime} CANCELLED · NEXT ${firstWords.vehicle.toUpperCase()}`;
    return model;
  }
  if (depMs === null || arrMs === null) {
    model.provenance = 'SCHEDULED';
    return model;
  }
  /* A fix at the destination ends the journey before its timetable does, so this
     branch is tested before the countdown ones (client-storage.md, Travel mode). */
  if (nowMs >= arrMs || opts.arrived) {
    model.phase = 'done';
    model.progress = { at: 1, phase: 'done' };
    model.figure = countdownFigure(Math.max(0, -minutesUntil(arrMs, nowMs)));
    model.provenance = 'AGO';
    model.instruction = `You arrived at ${model.to}.`;
    model.showBoardingPlatform = false;
    model.act = true;
    return model;
  }
  if (nowMs < depMs) {
    const minutes = minutesUntil(depMs, nowMs);
    model.figure = countdownFigure(minutes);
    model.provenance = departureDelay > 0
      ? `${departureDelay} MIN LATE`
      : first.departure && first.departure.estimated ? '' : 'SCHEDULED';
    model.provenanceWarn = departureDelay > 0;
    if (opts.leave) {
      model.instruction = `Leave now for ${boardingLabel(first.from && first.from.platform, first.line && first.line.mode) || '—'}`;
      model.receipt = opts.receipt || `You’re ${opts.leave} from ${model.from}.`;
      model.act = true;
    }
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
      model.figure = countdownFigure(minutesUntil(legArrival, nowMs));
      model.provenance = hasChange ? 'TO CHANGE' : 'TO GO';
      const destination = boardingLabel(legs[i].to && legs[i].to.platform,
        legs[i].line && legs[i].line.mode);
      model.instruction = `Get off at ${hasChange ? next.fromStation : model.to}`
        + (destination ? ` · ${destination}` : '');
      model.activeLeg = i;
      phase = i === 0 ? 'ride' : 'ride2';
      break;
    }
    if (next && next.departureMs !== null && nowMs < next.departureMs) {
      model.figure = countdownFigure(minutesUntil(next.departureMs, nowMs));
      model.provenance = 'TO CHANGE';
      model.instruction = `Change at ${next.toStation}`
        + (next.toLabel ? ` · ${next.toLabel}` : '');
      model.activeLeg = next.index;
      phase = 'dwell';
      break;
    }
  }
  model.phase = phase;
  model.progress = { at, phase };
  if (risk) {
    model.warn = true;
    model.instruction = `Tight change · ${risk.minutes} min`
      + (risk.toLabel ? ` · ${risk.toLabel}` : '');
    if (risk.printedMin !== null && risk.minutes < risk.printedMin) {
      model.receipt = `Printed change was ${risk.printedMin} min.`;
    }
  }
  if (ridingCancelled) {
    const lost = legs[cancelledIndex];
    const lostDep = effective(lost.departure);
    model.warn = true;
    model.tight = false;
    model.instruction = `${lostDep === null ? '—' : clock(lostDep)} from `
      + `${shortName((lost.from && lost.from.name) || '')} cancelled`;
  }
  return model;
}
