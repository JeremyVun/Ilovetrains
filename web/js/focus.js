/* "I'm on this train" — the focused journey, per
   docs/contracts/client-storage.md. Pure: a storage document, a journey and
   `now` in, a new document (or a render-ready strip) out.

   The whole point of the snapshot is that a focused journey stays viewable
   after the board has dropped it: rowmodel.js removes departed services and is
   right to, so once you are on the train the only copy of it left is the one
   in localStorage. On every refresh the client re-matches it in fresh data by
   (first leg's line, timetabled departure) and replaces the snapshot when it
   matches, so live delays keep flowing; when it no longer matches — it has
   departed, or the network is gone — the last snapshot stands.

   The strip is a port of comps/b2-footerrail.html with B3's departed copy
   transplanted in (docs/STYLES.md). */

import { clock, minutesUntil, countdownFigure } from './time.js';
import { journeyKey, legsOf, arrivalMs, departureMs, effective, TIGHT_CHANGE_MIN } from './journey.js';
import { shortName } from './dom.js';

/* Half an hour past arrival the journey is over and the strip is clutter
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
    learned falls back to when it was focused, so nothing can pin the strip to
    the screen forever. */
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
 * is what makes the strip survive its own departure.
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

/**
 * The strip: one band at the bottom edge of the board, in thumb reach,
 * absorbing the footer rather than adding to it.
 *
 * Its figure is always minutes TO ARRIVAL — before departure and after it —
 * because the question a focused journey answers is "when do I get there".
 * The board above it still answers "when does it leave".
 */
export function stripModel(focus, nowMs, opts = {}) {
  const stale = Boolean(opts.stale);
  const journey = focus.journey;
  const legs = legsOf(journey, opts);
  const first = legs[0] || {};
  const arrMs = arrivalMs(journey);
  const depMs = departureMs(journey);

  const toGo = arrMs === null ? null : minutesUntil(arrMs, nowMs);
  const departed = depMs !== null && minutesUntil(depMs, nowMs) < 0;
  const arrived = toGo !== null && toGo <= 0;

  // A countdown off an old cache is a lie (owner ruling 2026-08-31), and a
  // countdown to something that has already happened is not a number either.
  // The slot empties and keeps its height, the way the stale board's does.
  const figure = stale || arrived || toGo === null ? '' : countdownFigure(toGo);

  const changes = [];
  for (let i = 1; i < legs.length; i++) {
    const prevArr = effective(legs[i - 1].arrival);
    const dep = effective(legs[i].departure);
    changes.push({
      station: shortName((legs[i - 1].to && legs[i - 1].to.name) || ''),
      platform: legs[i].from && legs[i].from.platform
        ? String(legs[i].from.platform).replace(/^platform\s+/i, '') : null,
      depTime: dep === null ? null : clock(dep),
      minutes: prevArr === null || dep === null ? null : minutesUntil(dep, prevArr)
    });
  }

  const cancelled = legs.find((l) => l.cancelled === true) || null;
  const nextChange = changes.find((c) => c.minutes !== null) || null;
  const tight = !cancelled && nextChange !== null && nextChange.minutes < TIGHT_CHANGE_MIN;

  /* Third line, in priority order: what is wrong, then what you have to do,
     then where you are going. Every one of them fits the 232px body column at
     390px — the strip is a glance, and a truncated glance is not one. */
  let note = null;
  let third = null;
  if (cancelled) {
    const at = effective(cancelled.departure);
    note = (at === null ? '' : clock(at) + ' ') + 'cancelled';
  } else if (tight) {
    note = nextChange.minutes + ' min to change · ' + nextChange.station;
  } else if (nextChange && nextChange.depTime) {
    third = 'Change ' + nextChange.depTime
      + (nextChange.platform ? ' · Platform ' + nextChange.platform : '');
  } else {
    third = first.headsign || (journey && journey.destinationHeadsign) || '';
  }

  const lineCode = (first.line && first.line.name) || '';
  const offMs = legs.length > 1 ? effective(first.arrival) : null;

  return {
    figure,
    wide: figure.length >= 3,
    provenance: figure ? 'MIN TO GO' : '',
    warn: Boolean(cancelled || tight),
    arrTime: arrMs === null ? '' : clock(arrMs),
    arrStation: shortName((legs[legs.length - 1]?.to || {}).name || opts.toName || ''),
    // B3's departed-lead copy, transplanted (docs/STYLES.md): before it leaves
    // the strip states the journey, after it leaves it states you.
    arrives: !departed ? 'arrives' : arrived ? 'you arrived' : 'you arrive',
    // "ON BOARD T9 · OFF 09:51" while riding; "THE 09:24 · 1 CHANGE" otherwise
    // — which is the neutral statement of which journey this is, and true in
    // every tense.
    riding: departed && !arrived,
    lineCode,
    offTime: offMs === null ? null : clock(offMs),
    depTime: depMs === null ? '' : clock(depMs),
    changeCount: changes.length,
    note,
    third
  };
}
