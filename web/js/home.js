/* Home and smart-header model. Business rules are pure and kept out of the
   renderer so home/reversal heuristics can be tuned without touching geometry. */

import { esc, shortName } from './dom.js';
import { focusExpired, focusOf, directionsModel } from './focus.js';
import { arrivalMs, departureMs, legsOf } from './journey.js';
import { clock } from './time.js';
import { journeyDeviceHtml, clampJourneyBars } from './journeybar.js';
import { cacheKey, leg } from './storage.js';
import { distanceKm, rankTrips } from './predict.js';

const EVENING_START = 16;
const MORNING_END = 11;
const HOME_EVIDENCE = 3;

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
  const nextRunning = journeys.find((item) => !item.cancelled) || null;
  const cancelledTime = !activeFocus && liveLead && liveLead.cancelled && nextRunning && nextRunning !== liveLead
    && departureMs(liveLead) !== null ? clock(departureMs(liveLead)) : '';
  const journey = activeFocus ? activeFocus.journey
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
    receipt = new Date(nowMs).getHours() < 12
      ? 'You ride this most weekday mornings.' : 'You often take this trip around now.';
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
  return {
    selected,
    trip: selectedTrip,
    directions,
    ranked,
    home,
    focus: activeFocus,
    over: tripIsOver(activeFocus, nowMs),
    freshness: opts.stale ? 'Offline' : 'Live',
    dot: opts.stale ? 'stale' : 'live',
    askLocation: Boolean(opts.askLocation)
  };
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
  const tracking = `Tracking · ${shortName(d.from)} → ${shortName(d.to)}`;
  return `<div class="hm-c home-screen">
    <div class="hm-top">
      <button class="hm-track" data-act="trip-list"><span class="t">${esc(tracking)}</span><span class="g">⌄</span></button>
      <span class="hm-fresh"><span class="pulse ${esc(model.dot)}"></span><span class="lbl">${esc(model.freshness)}</span></span>
    </div>
    <button class="hm-hd${String(d.figure).length > 2 ? ' wide' : ''}${d.provenanceWarn ? ' late' : ''}" style="${device.vars}" data-act="board">
      <span class="hm-fig"><span class="hm-n">${figureHtml(d.figure)}</span><span class="hm-st${d.warn || d.provenanceWarn ? ' warn' : ''}">${esc(d.provenance || '')}</span></span>
      <span class="hm-ends">
        <span class="hm-e from"><span class="hm-stn">${esc(d.from)}</span><span class="hm-t">${esc(d.depTime)}</span></span>
        <span class="hm-e to"><span class="hm-stn">${esc(d.to)}</span><span class="hm-t">${esc(d.arrTime)}</span></span>
      </span>
      ${device.html}
      <span class="hm-sign${d.warn ? ' note' : d.act ? ' hm-act' : ''}">${esc(d.instruction || '—')}</span>
      ${d.receipt ? `<span class="hm-rec">${esc(d.receipt)}</span>` : ''}
    </button>
    ${offerHtml(model)}
    <div class="hm-rule"></div>
    <div class="hm-ix tl" data-t="trip-list">
      <div class="hm-anchor"><div class="l">Track another trip</div></div>
      ${model.ranked.map(tripRowHtml).join('')}
      <div class="hm-end">— That’s everything on this phone</div>
    </div>
    ${model.askLocation ? locationAskHtml() : '<div class="hm-bar"><button data-act="new-trip"><span class="g">+</span>New trip</button></div>'}
  </div>`;
}

function figureHtml(value) {
  const text = String(value || '');
  const hours = /^(\d+)H$/.exec(text);
  if (hours) return `${esc(hours[1])}<span class="hm-u">H</span>`;
  return /^\d+$/.test(text) ? `${esc(text)}<span class="hm-u">min</span>` : esc(text);
}

function badge(code) {
  const lightInk = ['T4', 'T5', 'T9', 'CCN', 'HUN'].includes(code);
  return `<b class="hm-bdg" style="background:var(--line-${esc(code)});color:var(--${lightInk ? 'ink' : 'bg'});">${esc(code)}</b>`;
}

function tripRowHtml(entry) {
  const codes = entry.codes;
  const spine = `<span class="hm-spine">${codes.map((code) => `<i style="background:var(--line-${esc(code)})"></i>`).join('')}</span>`;
  const name = codes.length > 1
    ? `${badge(codes[0])}${esc(entry.from)} <em>→</em> ${badge(codes[codes.length - 1])}${esc(entry.to)}`
    : codes.length === 1
      ? `${badge(codes[0])}${esc(entry.from)} <em>→</em> ${esc(entry.to)}`
      : `${esc(entry.from)} <em>→</em> ${esc(entry.to)}`;
  const lead = entry.selected ? 'Tracking now' : entry.distance;
  const sub = [lead ? `<b>${lead}</b>` : '', entry.ridden].filter(Boolean).join(' · ');
  return `<button class="tripr${entry.selected ? ' top' : ''}" data-svc data-act="select-trip" data-id="${esc(entry.trip.id)}" data-direction="${esc(entry.direction)}">
    <span class="hm-in">${spine}<span class="hm-bd"><span class="hm-nm">${name}</span><span class="hm-sub">${sub}</span></span></span>
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
}
