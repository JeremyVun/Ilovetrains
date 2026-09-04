/* Home and smart-header model. Business rules are pure and kept out of the
   renderer so home/reversal heuristics can be tuned without touching geometry. */

import { esc, shortName, fitStationNames } from './dom.js';
import {
  focusExpired, focusOf, directionsModel, focusStatus, journeyCancelled
} from './focus.js';
import { arrivalMs, departureMs, legsOf } from './journey.js';
import { clock } from './time.js';
import { journeyDeviceHtml, clampJourneyBars } from './journeybar.js';
import { cacheKey, leg } from './storage.js';
import { distanceKm, rankTrips } from './predict.js';

const EVENING_START = 16;
const MORNING_END = 11;
const HOME_EVIDENCE = 3;
/* Inside this radius the top line answers "you are here" rather than "how far". */
const AT_ORIGIN_KM = 0.2;

export function inferHome(doc, nowMs) {
  const rides = (doc.rides || []).filter((ride) => Date.parse(ride.arrivedAt) <= nowMs);
  const scores = new Map();
  for (const ride of rides) {
    const departureHour = new Date(ride.departedAt).getHours();
    const arrivalHour = new Date(ride.arrivedAt).getHours();
    if (departureHour < MORNING_END) addScore(scores, ride.from, 1);
    if (arrivalHour >= EVENING_START) addScore(scores, ride.to, 1);
  }
  const leaders = [...scores.values()].sort((a, b) => b.count - a.count);
  const inferred = leaders[0] && leaders[0].count >= HOME_EVIDENCE
    ? { station: leaders[0].station, confidence: leaders[0].count } : null;
  const home = doc.home || (inferred
    ? { ...inferred, inferredAt: new Date(nowMs).toISOString() }
    : doc.trips[0] ? { station: doc.trips[0].from, confidence: 0, inferredAt: null } : null);

  const evenings = rides.filter((ride) => new Date(ride.arrivedAt).getHours() >= EVENING_START).slice(-3);
  const moved = home && evenings.length === 3
    && evenings.every((ride) => ride.to.id === evenings[0].to.id)
    && evenings[0].to.id !== home.station.id ? evenings[0].to : null;
  return { home, inferred, moved };
}

function addScore(scores, station, value) {
  const current = scores.get(station.id) || { station, count: 0 };
  current.count += value;
  scores.set(station.id, current);
}

export function tripIsOver(focus, nowMs) {
  if (!focus) return false;
  const arrival = arrivalMs(focus.journey);
  return arrival !== null && nowMs > arrival;
}

function lastRidden(doc, tripId, nowMs) {
  const rides = (doc.rides || []).filter((ride) => ride.tripId === tripId);
  const latest = rides.sort((a, b) => Date.parse(b.arrivedAt) - Date.parse(a.arrivedAt))[0];
  if (!latest) return 'Never ridden';
  const days = Math.floor((nowMs - Date.parse(latest.arrivedAt)) / 86400000);
  if (days <= 0) return 'Rode it today';
  if (days === 1) return 'Last ridden yesterday';
  if (days < 7) return `Last ridden ${new Date(latest.arrivedAt).toLocaleDateString('en-AU', { weekday: 'long' })}`;
  return `Last ridden ${new Date(latest.arrivedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;
}

function cachedJourney(doc, trip, direction) {
  const ends = leg(trip, direction);
  const entry = doc.cache && doc.cache[cacheKey(ends.from.id, ends.to.id)];
  return entry && entry.body && Array.isArray(entry.body.journeys) ? entry.body.journeys[0] : null;
}

function lineCodes(doc, trip, direction, currentJourney) {
  const journey = currentJourney || cachedJourney(doc, trip, direction)
    || cachedJourney(doc, trip, direction === 'forward' ? 'reverse' : 'forward');
  const codes = legsOf(journey).map((item) => (item.line && item.line.name) || '').filter(Boolean);
  return codes;
}

export function homeModel(doc, selection, body, nowMs, opts = {}) {
  const focus = focusOf(doc);
  const activeFocus = focus && !focusExpired(focus, nowMs) ? focus : null;
  const trip = doc.trips.find((item) => item.id === selection.tripId) || doc.trips[0];
  const ends = leg(trip, selection.direction);
  const journeys = body && Array.isArray(body.journeys) ? body.journeys : [];
  const liveLead = journeys[0] || null;
  const nextRunning = journeys.find((item) => !journeyCancelled(item)) || null;
  const focusDep = activeFocus ? departureMs(activeFocus.journey) : null;
  // B8: cancelled before it leaves, the header shows the next running service
  // while the status still reads CANCELLED.
  const replacement = activeFocus && journeyCancelled(activeFocus.journey)
    && focusDep !== null && nowMs < focusDep
    ? journeys.find((item) => !journeyCancelled(item)
      && departureMs(item) !== null && departureMs(item) > focusDep) || null : null;
  const cancelledTime = replacement ? clock(focusDep)
    : !activeFocus && liveLead && journeyCancelled(liveLead) && nextRunning && nextRunning !== liveLead
      && departureMs(liveLead) !== null ? clock(departureMs(liveLead)) : '';
  const journey = activeFocus ? replacement || activeFocus.journey
    : nextRunning || liveLead || cachedJourney(doc, trip, selection.direction);
  const selected = activeFocus
    ? { tripId: activeFocus.tripId, direction: activeFocus.direction } : selection;
  const selectedTrip = doc.trips.find((item) => item.id === selected.tripId) || trip;
  const selectedEnds = leg(selectedTrip, selected.direction);
  const home = inferHome(doc, nowMs);
  let receipt = opts.receipt || '';
  if (!receipt && selected.direction === 'reverse') {
    const outbound = (doc.rides || []).filter((ride) => ride.tripId === selectedTrip.id && ride.direction === 'forward').at(-1);
    if (outbound) receipt = `You rode out at ${new Date(outbound.departedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })}. Here’s the way back.`;
  }
  if (!receipt && !activeFocus && !opts.fix && doc.history.length) {
    // history records qualified board views, not rides (design.md, Findings).
    receipt = new Date(nowMs).getHours() < 12
      ? 'You check this trip most weekday mornings.' : 'You often check this trip around now.';
  }

  const directions = journey ? directionsModel(journey, nowMs, {
    stale: Boolean(opts.stale),
    fromName: selectedEnds.from.name,
    toName: selectedEnds.to.name,
    leave: opts.leave || '',
    cancelledTime,
    receipt
  }) : {
    journey: null,
    from: shortName(selectedEnds.from.name),
    to: shortName(selectedEnds.to.name),
    depTime: '—', arrTime: '—', figure: '', provenance: 'TIMETABLE ONLY',
    phase: 'pre', activeLeg: 0,
    instruction: opts.offline ? 'No saved board for this trip yet' : 'Getting the next trains…',
    progress: { at: 0, phase: 'pre' }, showBoardingPlatform: true, receipt: ''
  };
  const ranked = rankTrips(doc, nowMs, { fix: opts.fix, selection: selected }).map((entry) => {
    const entryEnds = leg(entry.trip, entry.direction);
    return {
      ...entry,
      from: shortName(entryEnds.from.name),
      to: shortName(entryEnds.to.name),
      codes: lineCodes(doc, entry.trip, entry.direction,
        entry.trip.id === selectedTrip.id ? journey : null),
      distance: formatDistance(entry.distanceKm),
      ridden: lastRidden(doc, entry.trip.id, nowMs)
    };
  });
  const over = tripIsOver(activeFocus, nowMs);
  const status = activeFocus ? focusStatus(activeFocus.journey, {
    activeLeg: directions.activeLeg,
    stale: Boolean(opts.stale),
    over
  }) : null;
  return {
    selected,
    trip: selectedTrip,
    directions,
    ranked,
    home,
    focus: activeFocus,
    status,
    top: status ? null : topLine(shortName(selectedEnds.from.name),
      distanceKm(opts.fix, selectedEnds.from.location)),
    over,
    freshness: opts.stale ? 'Offline' : 'Live',
    dot: opts.stale ? 'stale' : 'live',
    askLocation: Boolean(opts.askLocation)
  };
}

/* Ruling 11: the line above the header answers how far the station is, and
   only falls back to a status word when it cannot. */
function topLine(name, km) {
  if (!Number.isFinite(km)) return { lead: 'Next train', name: '' };
  if (km <= AT_ORIGIN_KM) return { lead: 'At ', name };
  return { lead: `${formatDistance(km).replace(/ away$/, '')} to `, name };
}

export function formatDistance(km) {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return `${Math.max(10, Math.round(km * 1000 / 10) * 10)} m away`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}

export function homeHtml(model) {
  const d = model.directions;
  const journey = d.journey;
  const device = journey ? journeyDeviceHtml(journey, {
    caps: true,
    progress: d.progress,
    tight: d.tight,
    showBoardingPlatform: d.showBoardingPlatform
  }) : { html: '<span class="sy-j"><span class="sy-bar"></span></span>', vars: '' };
  const status = model.status;
  const late = Boolean(status && status.late);
  return `<div class="hm-c home-screen" data-phase="${esc(d.phase || 'pre')}" data-focused="${Boolean(status)}" data-relevant-leg="${status ? status.leg : -1}" data-active-delay="${status ? status.delay : 0}" data-freshness="${esc(model.freshness.toLowerCase())}">
    <div class="hm-top">
      ${topHtml(model)}
      <span class="hm-fresh"><span class="pulse ${esc(model.dot)}"></span><span class="lbl">${esc(model.freshness)}</span></span>
    </div>
    <section class="hm-hd${String(d.figure).length > 2 ? ' wide' : ''}${d.provenanceWarn ? ' late' : ''}${late ? ' active-late' : ''}" style="${device.vars}" data-active-late="${late}">
      <span class="hm-fig"><span class="hm-n">${figureHtml(d.figure)}</span><span class="hm-st${d.warn || d.provenanceWarn ? ' warn' : ''}">${esc(d.provenance || '')}</span></span>
      <span class="hm-ends">
        <span class="hm-e from"><span class="hm-stn" data-fit-box data-fit-name="${esc(d.from)}">${esc(d.from)}</span><span class="hm-t">${esc(d.depTime)}</span></span>
        <span class="hm-e to"><span class="hm-stn" data-fit-box data-fit-name="${esc(d.to)}">${esc(d.to)}</span><span class="hm-t">${esc(d.arrTime)}</span></span>
      </span>
      ${device.html}
      <span class="hm-sign${d.warn ? ' note' : d.act ? ' hm-act' : ''}">${esc(d.instruction || '—')}</span>
      ${d.receipt ? `<span class="hm-rec">${esc(d.receipt)}</span>` : ''}
    </section>
    ${offerHtml(model)}
    <div class="hm-rule"></div>
    <div class="hm-ix tl" data-t="trip-list" data-scroller>
      <div class="hm-anchor"><div class="l">My trips</div></div>
      ${model.ranked.map((entry) => tripRowHtml(entry, model)).join('')}
      <div class="hm-end">— That’s everything on this phone</div>
    </div>
    ${model.askLocation ? locationAskHtml() : '<div class="hm-bar" data-footer-rail><button data-act="new-trip" data-tap><span class="g">+</span>New trip</button></div>'}
  </div>`;
}

function statusClass(status) {
  return ` status-copy status-${status.kind}${status.late ? ' status-late' : ''}`;
}

/* The late word is its own span so the treatment can space and colour it. */
function statusHtml(status) {
  return status.late
    ? '<span class="status-inner">Running <span class="status-late-word">late</span></span>'
    : esc(status.text);
}

/* One flex item: two would collapse the space before the station name. */
function topHtml(model) {
  const status = model.status;
  if (status) {
    return `<span class="answer-kind${statusClass(status)}" data-focus-status data-late="${status.late}"><span class="answer-line">${statusHtml(status)}</span></span>`;
  }
  const top = model.top;
  const name = top.name
    ? `<span data-fit-name="${esc(top.name)}">${esc(top.name)}</span>` : '';
  return `<span class="answer-kind" data-focus-status data-late="false"><span class="answer-line" data-fit-box>${esc(top.lead)}${name}</span></span>`;
}

function figureHtml(value) {
  const text = String(value || '');
  const hours = /^(\d+)H$/.exec(text);
  if (hours) return `${esc(hours[1])}<span class="hm-u">H</span>`;
  return /^\d+$/.test(text) ? `${esc(text)}<span class="hm-u">min</span>` : esc(text);
}

function badge(code) {
  const lightInk = ['T4', 'T5', 'T9', 'CCN', 'HUN'].includes(code);
  return `<b class="hm-bdg" style="background:var(--line-fill-${esc(code)}, var(--line-${esc(code)}));color:var(--${lightInk ? 'ink' : 'bg'});">${esc(code)}</b>`;
}

function subHtml(entry, model) {
  if (entry.selected && model.status) {
    return `<b class="${statusClass(model.status).trim()}" data-row-status data-late="${model.status.late}">${statusHtml(model.status)}</b>`;
  }
  if (entry.selected) {
    return `<b>Shown above</b>${entry.distance ? ` · ${esc(entry.distance)}` : ''}`;
  }
  return [entry.distance ? `<b>${esc(entry.distance)}</b>` : '', esc(entry.ridden)]
    .filter(Boolean).join(' · ');
}

function tripRowHtml(entry, model) {
  const codes = entry.codes;
  const spine = `<span class="hm-spine">${codes.map((code) => `<i style="background:var(--line-fill-${esc(code)}, var(--line-${esc(code)}))"></i>`).join('')}</span>`;
  const name = codes.length > 1
    ? `${badge(codes[0])}${esc(entry.from)} <em>→</em> ${badge(codes[codes.length - 1])}${esc(entry.to)}`
    : codes.length === 1
      ? `${badge(codes[0])}${esc(entry.from)} <em>→</em> ${esc(entry.to)}`
      : `${esc(entry.from)} <em>→</em> ${esc(entry.to)}`;
  const state = entry.selected ? model.status ? ' focused' : ' shown' : '';
  return `<button class="tripr${state}" data-svc data-tap data-act="open-trip" data-id="${esc(entry.trip.id)}" data-direction="${esc(entry.direction)}" aria-label="Open ${esc(entry.from)} to ${esc(entry.to)} departures">
    <span class="hm-in">${spine}<span class="hm-bd"><span class="hm-nm">${name}</span><span class="hm-sub">${subHtml(entry, model)}</span></span><span class="route-cue">Departures<span class="arrow">›</span></span></span>
  </button>`;
}

function offerHtml(model) {
  if (model.over) {
    return `<div class="hm-offer"><div class="r"></div><span class="k">Trip over</span>
      <p>You’ve arrived. The return trip is ready when you are.</p>
      <div class="hm-acts"><button data-act="way-back">Show the way back</button><button class="q" data-act="dismiss-offer">Not now</button></div></div>`;
  }
  if (model.home.moved) {
    return `<div class="hm-offer"><div class="r"></div><span class="k">Home may have moved</span>
      <p>Your last three evenings ended at ${esc(shortName(model.home.moved.name))}, not ${esc(shortName(model.home.home.station.name))}.</p>
      <div class="hm-acts"><button data-act="accept-home" data-id="${esc(model.home.moved.id)}">Use ${esc(shortName(model.home.moved.name))}</button><button class="q" data-act="dismiss-offer">Keep current</button></div></div>`;
  }
  return '';
}

function locationAskHtml() {
  return `<div class="hm-ask"><span class="k">Open on the right trip</span>
    <p>With several trips saved, your location helps choose the right one. It never leaves this phone.</p>
    <div class="hm-acts"><button data-act="use-location">Use my location</button><button class="q" data-act="skip-location">Not now</button></div>
  </div>`;
}

export function finishHomeRender(root) {
  clampJourneyBars(root);
  fitStationNames(root);
  // Republish journeybar.js's own axis arithmetic where the probes read it.
  root.querySelectorAll('.hm-hd .sy-bar').forEach((bar) => {
    const spec = bar.querySelector('.sy-spec');
    if (spec) bar.dataset.axis = spec.dataset.mins;
  });
}
