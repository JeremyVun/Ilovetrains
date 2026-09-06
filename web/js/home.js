/* Home and smart-header model. Business rules are pure and kept out of the
   renderer so home/reversal heuristics can be tuned without touching geometry. */

import { esc, figureHtml, shortName, fitStationNames } from './dom.js';
import {
  visibleFocus, directionsModel, focusStatus, journeyCancelled
} from './focus.js';
import { arrivalMs, departureMs, departureKey, journeyKey, journeyDetail, legsOf, modeWords } from './journey.js';
import { colourKey, lineFill } from './lines.js';
import { clock, countdownFigure, minutesUntil } from './time.js';
import { journeyDeviceHtml, clampJourneyBars, chipInk } from './journeybar.js';
import { cacheKey, leg } from './storage.js';
import { AT_STATION_KM, distanceKm } from './stations.js';
import { dayTypeMatch, homeOf, HOME_VOTES_NEEDED, hourProximity, isWeekend, rankTrips } from './predict.js';
import { journeyAllowed, preferencesOf, tripsForModes, SUPPORTED_MODES } from './preferences.js';

const RECEIPT_EVIDENCE = 3;

/** Another itinerary on the same first service is not another departure. */
export function nextService(journeys, lead, nowMs, stale = false) {
  const departure = departureMs(lead);
  if (departure === null || departure <= nowMs) return null;
  const candidate = journeys.filter((item) => !journeyCancelled(item)
    && departureKey(item) !== departureKey(lead) && departureMs(item) > departure)
    .sort((a, b) => departureMs(a) - departureMs(b))[0];
  if (!candidate) return null;
  const mode = String(legsOf(candidate)[0]?.line?.mode || '').toLowerCase();
  const vehicle = ['train', 'metro', 'ferry'].includes(mode) ? mode : 'service';
  const arrival = arrivalMs(candidate);
  return {
    journey: candidate, key: journeyKey(candidate), label: `Next ${vehicle}`,
    figure: stale ? '' : countdownFigure(minutesUntil(departureMs(candidate), nowMs)),
    depTime: clock(departureMs(candidate)), arrTime: arrival === null ? '—' : clock(arrival), stale
  };
}

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

function cachedJourney(doc, trip, direction, modes) {
  const ends = leg(trip, direction);
  const keys = [cacheKey(ends.from.id, ends.to.id, modes)];
  const allKey = cacheKey(ends.from.id, ends.to.id, SUPPORTED_MODES);
  if (!keys.includes(allKey)) keys.push(allKey);
  for (const key of keys) {
    const entry = doc.cache && doc.cache[key];
    const journeys = entry && entry.body && Array.isArray(entry.body.journeys)
      ? entry.body.journeys : [];
    const eligible = journeys.find((journey) => journeyAllowed(journey, modes));
    if (eligible) return eligible;
  }
  return null;
}

function journeyLines(doc, trip, direction, currentJourney, modes) {
  const journey = currentJourney || cachedJourney(doc, trip, direction, modes)
    || cachedJourney(doc, trip, direction === 'forward' ? 'reverse' : 'forward', modes);
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
  const preferences = preferencesOf(doc);
  const enabledModes = preferences.enabledModes;
  const activeFocus = visibleFocus(doc, nowMs, opts.stations);
  const trip = doc.trips.find((item) => item.id === selection.tripId) || doc.trips[0];
  const ends = leg(trip, selection.direction);
  const journeys = body && Array.isArray(body.journeys)
    ? body.journeys.filter((item) => journeyAllowed(item, enabledModes)) : [];
  const focusJourneys = opts.focusBody && Array.isArray(opts.focusBody.journeys)
    ? opts.focusBody.journeys.filter((item) => journeyAllowed(item, enabledModes)) : [];
  const liveLead = journeys[0] || null;
  const nextRunning = journeys.find((item) => !journeyCancelled(item)) || null;
  const focusDep = activeFocus ? departureMs(activeFocus.journey) : null;
  // Cancelled before it leaves, the header shows the next running service
  // while the status still reads CANCELLED.
  const sameFocusedPair = activeFocus && selection.tripId === activeFocus.tripId
    && selection.direction === activeFocus.direction;
  const candidateReplacement = sameFocusedPair && journeyCancelled(activeFocus.journey)
    && focusDep !== null && nowMs < focusDep
    ? journeys.find((item) => !journeyCancelled(item)
      && departureMs(item) !== null && departureMs(item) > focusDep) || null : null;
  const focusReplacement = !candidateReplacement && activeFocus && journeyCancelled(activeFocus.journey)
    && focusDep !== null && nowMs < focusDep
    ? focusJourneys.find((item) => !journeyCancelled(item)
      && departureMs(item) !== null && departureMs(item) > focusDep) || null : null;
  const replacement = candidateReplacement || focusReplacement;
  const displaySource = activeFocus
    ? replacement ? (focusReplacement ? opts.focusSource : opts.candidateSource) : opts.focusSource
    : opts.candidateSource;
  const displayStale = displaySource ? Boolean(displaySource.stale) : Boolean(opts.stale);
  const cancelledTime = replacement ? clock(focusDep)
    : !activeFocus && liveLead && journeyCancelled(liveLead) && nextRunning && nextRunning !== liveLead
      && departureMs(liveLead) !== null ? clock(departureMs(liveLead)) : '';
  const journey = activeFocus ? replacement || activeFocus.journey
    : nextRunning || liveLead || (!body ? cachedJourney(doc, trip, selection.direction, enabledModes) : null);
  const firstJourneyLeg = legsOf(journey)[0] || {};
  const selected = activeFocus
    ? { tripId: activeFocus.tripId, direction: activeFocus.direction } : selection;
  const selectedTrip = doc.trips.find((item) => item.id === selected.tripId) || trip;
  const selectedEnds = leg(selectedTrip, selected.direction);
  const modeSubset = enabledModes.length < SUPPORTED_MODES.length;
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
    receipt = home.source === 'manual'
      ? `You set ${shortName(home.station.name)} as home.`
      : home.confidence >= HOME_VOTES_NEEDED
      ? `Your days usually start at ${shortName(home.station.name)}.`
      : `You usually travel from ${shortName(home.station.name)}.`;
  }

  const over = Boolean(activeFocus) && (tripIsOver(activeFocus, nowMs) || Boolean(opts.arrived));
  const directions = journey ? directionsModel(journey, nowMs, {
    stale: displayStale,
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
    instruction: !enabledModes.length ? 'Turn on a service in Settings'
      : opts.offline ? 'Couldn’t refresh this trip. Try again when connected.'
        : opts.stale ? 'No services on the last board we could load'
          : body ? modeSubset ? 'No journeys with these services' : 'No services in the next few hours'
            : 'Getting the next trains…',
    progress: { at: 0, phase: 'pre' }, showBoardingPlatform: true, receipt: '',
    settingsAction: !enabledModes.length || Boolean(body && modeSubset && !opts.offline && !opts.stale),
    allServicesOff: !enabledModes.length
  };
  const visibleDoc = tripsForModes(doc, opts.stations);
  const ranked = rankTrips(visibleDoc, nowMs, { fix: opts.fix, selection: selected }).map((entry) => {
    const entryEnds = leg(entry.trip, entry.direction);
    return {
      ...entry,
      from: shortName(entryEnds.from.name),
      to: shortName(entryEnds.to.name),
      lines: journeyLines(doc, entry.trip, entry.direction,
        entry.trip.id === selectedTrip.id ? journey : null, enabledModes),
      distance: formatDistance(entry.distanceKm),
      ridden: lastRidden(doc, entry.trip.id, nowMs),
      justAdded: entry.trip.id === selectedTrip.id && !activeFocus
        && Boolean(opts.predicted) && savedThisOpen(entry.trip, opts.loadedAt)
    };
  });
  // A board still in the post is not offline; the pill rests until it answers.
  const waiting = !activeFocus && (!enabledModes.length || (!body && !opts.offline));
  const status = activeFocus ? focusStatus(activeFocus.journey, {
    activeLeg: directions.activeLeg,
    stale: displayStale,
    over
  }) : null;
  const strip = activeFocus && activeFocus.by === 'inferred' ? {
    origin: selectedEnds.from,
    destination: selectedEnds.to,
    departureMs: departureMs(activeFocus.journey),
    journeyKey: departureKey(activeFocus.journey),
    slot: opts.stripVariant === 'a2' ? 'receipt' : 'below'
  } : null;
  const useFocusSource = Boolean(activeFocus && !candidateReplacement
    && (opts.focusBody || !sameFocusedPair));
  const followingSource = useFocusSource ? opts.focusSource : opts.candidateSource;
  const followingBody = useFocusSource ? opts.focusBody : body;
  const followingStale = followingSource ? Boolean(followingSource.stale) : displayStale;
  const following = directions.phase === 'pre' && !over
    ? nextService(useFocusSource ? focusJourneys : journeys, journey, nowMs, followingStale) : null;
  if (following) following.source = {
    body: followingBody, offline: followingStale, serverStale: followingSource?.dot === 'stale'
  };
  return {
    selected,
    trip: selectedTrip,
    directions,
    ranked,
    home,
    strip,
    focus: activeFocus,
    status,
    pinned: Boolean(activeFocus && activeFocus.by !== 'inferred' && !replacement),
    following,
    changes: journey ? journeyDetail(journey, nowMs).changes.map((change) => ({
      ...change, tight: change.tight && !journeyCancelled(journey)
    })) : [],
    top: status ? null : topLine(shortName(selectedEnds.from.name),
      distanceKm(opts.fix, selectedEnds.from.location),
      modeWords(firstJourneyLeg.line && firstJourneyLeg.line.mode).vehicle),
    over,
    freshness: waiting ? '' : displaySource?.freshness || (displayStale ? 'Offline' : 'Live'),
    dot: waiting ? 'idle' : displaySource?.dot || (displayStale ? 'stale' : 'live'),
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
    changes: model.changes,
    stations: true,
    showBoardingPlatform: d.showBoardingPlatform,
    originName: d.from
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
      <span class="hm-sign${d.warn ? ' note' : d.act ? ' hm-act' : ''}">${d.allServicesOff
        ? 'Turn on a service in <button class="hm-empty-settings" data-act="settings" data-action="settings">Settings</button>'
        : `${esc(d.instruction || '—')}${d.settingsAction ? '<button class="hm-empty-settings" data-act="settings" data-action="settings">Change settings</button>' : ''}`}</span>
      ${model.strip && model.strip.slot === 'receipt'
        ? stripHtml('receipt')
        : d.receipt ? `<span class="hm-rec">${esc(d.receipt)}</span>` : ''}
    </section>
    ${nextServiceHtml(model.following)}
    ${offerHtml(model)}
    <div class="hm-rule"></div>
    ${model.strip && model.strip.slot === 'below' ? stripHtml('below') : ''}
    <div class="hm-ix tl" data-t="trip-list" data-scroller>
      <div class="hm-anchor"><div class="l">My trips</div></div>
      ${model.ranked.map((entry) => tripRowHtml(entry, model)).join('')}
      <div class="hm-end">— That’s everything on this phone</div>
    </div>
    ${model.askLocation ? locationAskHtml() : footerHtml()}
  </div>`;
}

function footerHtml() {
  return `<div class="hm-bar split" data-footer-rail><button data-act="new-trip" data-tap><span class="g">+</span>New trip</button><button data-act="settings" data-action="settings" data-tap>${settingsIcon()}Settings</button></div>`;
}

function nextServiceHtml(next) {
  if (!next) return '';
  return `<button class="hm-next" data-act="next-service" data-tap data-next-service data-match="${esc(next.key)}" aria-label="${esc(`${next.label}, departs ${next.depTime}, arrives ${next.arrTime}`)}">
    <span class="hm-next-label">${esc(next.label)}</span>
    <span class="hm-next-count">${figureHtml(next.figure, 'hm-next-unit')}</span>
    <span class="hm-next-times"><time>${esc(next.depTime)}</time><span aria-hidden="true">→</span><time>${esc(next.arrTime)}</time></span>
    <span class="hm-next-go" aria-hidden="true">›</span>
  </button>`;
}

function pinHtml(icon = true) {
  const tag = icon ? 'button' : 'span';
  const action = icon ? ' data-act="unpin" aria-label="Unpin this service" title="Unpin this service"' : '';
  return `<${tag}${action} class="pin-status" data-pinned>${icon ? '<svg class="pin-icon" aria-hidden="true" viewBox="0 0 16 16"><path d="M5 1h6v1l-1 1v3l3 3v1H9v5H7v-5H3V9l3-3V3L5 2z"/></svg>' : ''}Pinned</${tag}>`;
}

function selectedStatusHtml(model, icon = false) {
  const status = model.status;
  const onlyPin = model.pinned && model.directions.phase === 'pre' && status.kind === 'ordinary';
  if (onlyPin) return pinHtml(icon);
  return statusHtml(status) + (model.pinned ? `<span class="pin-separator"> · </span>${pinHtml(icon)}` : '');
}

export function emptyServicesHtml(modes) {
  const message = modes.length ? 'No saved trips with these services.' : 'Turn on a service to see your trips.';
  return `<div class="hm-c home-screen" data-filtered-empty>
    <div class="hm-ix tl" data-t="trip-list" data-scroller>
      <div class="hm-anchor"><div class="l">My trips</div></div>
      <div class="hm-filtered-empty"><p>${message}</p>
        <button class="hm-empty-settings" data-act="settings" data-action="settings">Change settings</button></div>
    </div>${footerHtml()}</div>`;
}

function settingsIcon() {
  return '<svg class="settings-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
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
    return `<span class="answer-kind${statusClass(status)}" data-focus-status data-late="${status.late}"><span class="answer-line">${selectedStatusHtml(model, true)}</span></span>`;
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
    return `<b class="${statusClass(model.status).trim()}" data-row-status data-late="${model.status.late}">${selectedStatusHtml(model)}</b>`;
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
    ? `<span class="hm-route">${badge(lines[0])}${esc(entry.from)}</span> <span class="hm-route"><em>→</em> ${badge(lines[lines.length - 1])}${esc(entry.to)}</span>`
    : lines.length === 1
      ? `<span class="hm-route">${badge(lines[0])}${esc(entry.from)}</span> <span class="hm-route"><em>→</em> ${esc(entry.to)}</span>`
      : `<span class="hm-route">${esc(entry.from)}</span> <span class="hm-route"><em>→</em> ${esc(entry.to)}</span>`;
  const state = entry.selected ? model.status ? ' focused' : ' shown' : '';
  const action = 'open-trip';
  const label = `Open ${entry.from} to ${entry.to} departures`;
  const cue = 'Departures<span class="arrow">›</span>';
  return `<button class="tripr${state}" data-svc data-tap data-act="${action}" data-id="${esc(entry.trip.id)}" data-direction="${esc(entry.direction)}" aria-label="${esc(label)}">
    <span class="hm-in">${spine}<span class="hm-bd"><span class="hm-nm" data-fit-trip>${name}</span><span class="hm-sub">${subHtml(entry, model)}</span></span><span class="route-cue">${cue}</span></span>
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
    const row = node.closest ? node.closest('.tripr') : null;
    delete node.dataset.wrap;
    if (row) row.classList.remove('wrapped');
    node.style.fontSize = '';
    let size = Number.parseFloat(getComputedStyle(node).fontSize);
    while (node.scrollWidth > node.clientWidth + 1 && size > 16) {
      size = Math.max(16, size - 0.25);
      node.style.fontSize = `${size}px`;
    }
    if (node.scrollWidth > node.clientWidth + 1) {
      node.dataset.wrap = 'true';
      if (row) row.classList.add('wrapped');
    }
  });
}
