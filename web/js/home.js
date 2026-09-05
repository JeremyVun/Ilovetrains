/* Home and smart-header model. Business rules are pure and kept out of the
   renderer so home/reversal heuristics can be tuned without touching geometry. */

import { esc, figureHtml, shortName, fitStationNames } from './dom.js';
import {
  focusExpired, focusOf, directionsModel, focusStatus, journeyCancelled
} from './focus.js';
import { arrivalMs, departureMs, departureKey, legsOf, modeWords } from './journey.js';
import { colourKey, lineFill } from './lines.js';
import { clock } from './time.js';
import { journeyDeviceHtml, clampJourneyBars, chipInk } from './journeybar.js';
import { cacheKey, leg } from './storage.js';
import { AT_STATION_KM, distanceKm } from './stations.js';
import { dayTypeMatch, homeOf, HOME_VOTES_NEEDED, hourProximity, isWeekend, rankTrips } from './predict.js';

const RECEIPT_EVIDENCE = 3;

export function tripIsOver(focus, nowMs) {
  if (!focus) return false;
  const arrival = arrivalMs(focus.journey);
  return arrival !== null && nowMs > arrival;
}

/* The evidence a view-history receipt is allowed to claim: past views of this
   very (trip, direction) that the predictor itself counted — same day type,
   near this hour — and the distinct days they fall on. */
function viewEvidence(doc, selected, nowMs) {
  const days = new Set();
  let events = 0;
  for (const event of doc.history) {
    if (event.tripId !== selected.tripId || event.direction !== selected.direction) continue;
    const t = Date.parse(event.t);
    if (Number.isNaN(t) || hourProximity(t, nowMs) <= 0 || dayTypeMatch(t, nowMs) !== 1) continue;
    events += 1;
    days.add(new Date(t).toDateString());
  }
  return { events, days: days.size };
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

function journeyLines(doc, trip, direction, currentJourney) {
  const journey = currentJourney || cachedJourney(doc, trip, direction)
    || cachedJourney(doc, trip, direction === 'forward' ? 'reverse' : 'forward');
  return legsOf(journey).map((item) => ({
    code: (item.line && item.line.name) || '',
    colourKey: colourKey(item.line)
  })).filter((item) => item.code);
}

/* The mark is a fact about this open: the trip did not exist when the page
   loaded, so the app is the one that saved it. */
function savedThisOpen(trip, loadedAt) {
  const created = Date.parse(trip.createdAt);
  return Number.isFinite(loadedAt) && Number.isFinite(created) && created >= loadedAt;
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
  // Cancelled before it leaves, the header shows the next running service
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
  const firstJourneyLeg = legsOf(journey)[0] || {};
  const selected = activeFocus
    ? { tripId: activeFocus.tripId, direction: activeFocus.direction } : selection;
  const selectedTrip = doc.trips.find((item) => item.id === selected.tripId) || trip;
  const selectedEnds = leg(selectedTrip, selected.direction);
  const home = homeOf(doc);
  let receipt = opts.receipt || '';
  if (!receipt && selected.direction === 'reverse') {
    const outbound = (doc.rides || []).filter((ride) => ride.tripId === selectedTrip.id && ride.direction === 'forward').at(-1);
    if (outbound) receipt = `You rode out at ${clock(Date.parse(outbound.departedAt))}. Here’s the way back.`;
  }
  if (!receipt && opts.predicted && !activeFocus && !opts.fix && doc.trips.length >= 2) {
    const evidence = viewEvidence(doc, selected, nowMs);
    // history records qualified board views, not rides, so the receipt says check.
    if (evidence.events >= RECEIPT_EVIDENCE) {
      receipt = !isWeekend(nowMs) && new Date(nowMs).getHours() < 12
        && evidence.days >= RECEIPT_EVIDENCE
        ? 'You check this trip most weekday mornings.' : 'You often check this trip around now.';
    }
  }
  if (!receipt && opts.predicted && !activeFocus && opts.leap === 'home' && home) {
    receipt = home.confidence >= HOME_VOTES_NEEDED
      ? `Your days usually start at ${shortName(home.station.name)}.`
      : `You usually travel from ${shortName(home.station.name)}.`;
  }

  const over = Boolean(activeFocus) && (tripIsOver(activeFocus, nowMs) || Boolean(opts.arrived));
  const directions = journey ? directionsModel(journey, nowMs, {
    stale: Boolean(opts.stale),
    fromName: selectedEnds.from.name,
    toName: selectedEnds.to.name,
    leave: opts.leave || '',
    arrived: over,
    cancelledTime,
    receipt
  }) : {
    journey: null,
    from: shortName(selectedEnds.from.name),
    to: shortName(selectedEnds.to.name),
    depTime: '—', arrTime: '—', figure: '', provenance: '',
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
      lines: journeyLines(doc, entry.trip, entry.direction,
        entry.trip.id === selectedTrip.id ? journey : null),
      distance: formatDistance(entry.distanceKm),
      ridden: lastRidden(doc, entry.trip.id, nowMs),
      justAdded: entry.trip.id === selectedTrip.id && !activeFocus
        && Boolean(opts.predicted) && savedThisOpen(entry.trip, opts.loadedAt)
    };
  });
  // A board still in the post is not offline; the pill rests until it answers.
  const waiting = !body && !opts.offline;
  const status = activeFocus ? focusStatus(activeFocus.journey, {
    activeLeg: directions.activeLeg,
    stale: Boolean(opts.stale),
    over
  }) : null;
  const strip = activeFocus && activeFocus.by === 'inferred' ? {
    origin: selectedEnds.from,
    destination: selectedEnds.to,
    departureMs: departureMs(activeFocus.journey),
    journeyKey: departureKey(activeFocus.journey),
    slot: opts.stripVariant === 'a2' ? 'receipt' : 'below'
  } : null;
  return {
    selected,
    trip: selectedTrip,
    directions,
    ranked,
    home,
    strip,
    focus: activeFocus,
    status,
    top: status ? null : topLine(shortName(selectedEnds.from.name),
      distanceKm(opts.fix, selectedEnds.from.location),
      modeWords(firstJourneyLeg.line && firstJourneyLeg.line.mode).vehicle),
    over,
    freshness: waiting ? '' : opts.stale ? 'Offline' : 'Live',
    dot: waiting ? 'idle' : opts.stale ? 'stale' : 'live',
    askLocation: Boolean(opts.askLocation)
  };
}

/* The line above the header answers how far the station is, and only falls
   back to a status word when it cannot. */
function topLine(name, km, vehicle = 'train') {
  if (!Number.isFinite(km)) return { lead: `Next ${vehicle}`, name: '' };
  if (km <= AT_STATION_KM) return { lead: 'At ', name };
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
      <span class="hm-fig"><span class="hm-n">${figureHtml(d.figure, 'hm-u')}</span><span class="hm-st${d.warn || d.provenanceWarn ? ' warn' : ''}">${esc(d.provenance || '')}</span></span>
      <span class="hm-ends">
        <span class="hm-e from"><span class="hm-stn" data-fit-box data-fit-name="${esc(d.from)}">${esc(d.from)}</span><span class="hm-t">${esc(d.depTime)}</span></span>
        <span class="hm-e to"><span class="hm-stn" data-fit-box data-fit-name="${esc(d.to)}">${esc(d.to)}</span><span class="hm-t">${esc(d.arrTime)}</span></span>
      </span>
      ${device.html}
      <span class="hm-sign${d.warn ? ' note' : d.act ? ' hm-act' : ''}">${esc(d.instruction || '—')}</span>
      ${model.strip && model.strip.slot === 'receipt'
        ? stripHtml('receipt')
        : d.receipt ? `<span class="hm-rec">${esc(d.receipt)}</span>` : ''}
    </section>
    ${offerHtml(model)}
    <div class="hm-rule"></div>
    ${model.strip && model.strip.slot === 'below' ? stripHtml('below') : ''}
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

function badge(line) {
  return `<b class="hm-bdg" data-line-code="${esc(line.code)}" style="background:${lineFill(line.colourKey)};color:${chipInk(line.colourKey)};">${esc(line.code)}</b>`;
}

function subHtml(entry, model) {
  if (entry.selected && model.status) {
    return `<b class="${statusClass(model.status).trim()}" data-row-status data-late="${model.status.late}">${statusHtml(model.status)}</b>`;
  }
  if (entry.justAdded) {
    return `<i class="hm-new">Just added</i>${entry.distance ? ` · ${esc(entry.distance)}` : ''}`;
  }
  if (entry.selected) {
    return `<b>Shown above</b>${entry.distance ? ` · ${esc(entry.distance)}` : ''}`;
  }
  return [entry.distance ? `<b>${esc(entry.distance)}</b>` : '', esc(entry.ridden)]
    .filter(Boolean).join(' · ');
}

function tripRowHtml(entry, model) {
  const lines = entry.lines;
  const spine = `<span class="hm-spine">${lines.map((line) => `<i style="background:${lineFill(line.colourKey)}"></i>`).join('')}</span>`;
  const name = lines.length > 1
    ? `${badge(lines[0])}${esc(entry.from)} <em>→</em> ${badge(lines[lines.length - 1])}${esc(entry.to)}`
    : lines.length === 1
      ? `${badge(lines[0])}${esc(entry.from)} <em>→</em> ${esc(entry.to)}`
      : `${esc(entry.from)} <em>→</em> ${esc(entry.to)}`;
  const state = entry.selected ? model.status ? ' focused' : ' shown' : '';
  return `<button class="tripr${state}" data-svc data-tap data-act="open-trip" data-id="${esc(entry.trip.id)}" data-direction="${esc(entry.direction)}" aria-label="Open ${esc(entry.from)} to ${esc(entry.to)} departures">
    <span class="hm-in">${spine}<span class="hm-bd"><span class="hm-nm" data-fit-trip>${name}</span><span class="hm-sub">${subHtml(entry, model)}</span></span><span class="route-cue">Departures<span class="arrow">›</span></span></span>
  </button>`;
}

function offerHtml(model) {
  if (model.over) {
    return `<div class="hm-offer"><div class="r"></div><span class="k">Trip over</span>
      <p>You’ve arrived. The return trip is ready when you are.</p>
      <div class="hm-acts"><button data-act="way-back">Show the way back</button><button class="q" data-act="dismiss-offer">Not now</button></div></div>`;
  }
  return '';
}

/* The inferred header's only control, and its receipt: the app guessed this
   trip, so the correction is one tap (design.md, ruling 7). */
function stripHtml(slot) {
  const tag = slot === 'receipt' ? 'span' : 'div';
  const klass = slot === 'receipt' ? 'hm-rec hm-rec-strip' : 'hm-strip';
  return `<${tag} class="${klass}" data-strip><span class="q">Going somewhere else?</span>`
    + `<button data-act="change-destination" data-tap>Change</button></${tag}>`;
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
  fitTripNames(root);
  // Republish journeybar.js's own axis arithmetic where the probes read it.
  root.querySelectorAll('.hm-hd .sy-bar').forEach((bar) => {
    const spec = bar.querySelector('.sy-spec');
    if (spec) bar.dataset.axis = spec.dataset.mins;
  });
}

export function fitTripNames(root) {
  root.querySelectorAll('[data-fit-trip]').forEach((node) => {
    let size = Number.parseFloat(getComputedStyle(node).fontSize);
    while (node.scrollWidth > node.clientWidth + 1 && size > 16) {
      size = Math.max(16, size - 0.25);
      node.style.fontSize = `${size}px`;
    }
  });
}
