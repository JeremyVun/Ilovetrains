/* Drive the REAL client into each board state and shoot it.
 *
 *   node tools/shoot-states.js                 # every state, into the system temp directory
 *   node tools/shoot-states.js stale sparse    # just these
 *   node tools/shoot-states.js --list
 *   node tools/shoot-states.js --url http://localhost:8092 --out /tmp/look
 *   node tools/shoot-states.js --media prefers-color-scheme:light --prefix light-
 *
 * This is not a mock of the app: it loads the app the server serves, seeds
 * localStorage exactly as the client writes it, pins the clock through the
 * page's own `window.__trains` harness, and photographs whatever the client
 * decides to draw. The journey data is imported from web/test/fixture.js, so
 * the shots and the unit tests describe the same six real services.
 *
 * TRAPS this driver exists to defeat:
 *
 * 1. THE LIVE FETCH RACE. main.js fires a real /api/v1/departures on load, and
 *    it can land after the state has been set up — replacing a carefully
 *    seeded board with tonight's actual trains, silently. Every state first
 *    freezes `window.fetch` on a promise that never settles and calls
 *    `__trains.refresh()`, which aborts the in-flight request; only then is
 *    the state written. Nothing can arrive afterwards.
 *
 * 2. THE UNPINNED CLOCK. The app renders once at load with the real clock, so
 *    a seeded board of 22:48 services is all "departed" until the clock is
 *    pinned. States pin `__trains.now` and re-render.
 *
 * 3. LOCAL TIME. Every clock string the board prints is device-local. TZ is
 *    forced to Australia/Sydney here so a shot taken on any machine is the
 *    shot the exemplar is judged against.
 *
 * 4. Whatever tools/screenshot.js documents (viewport lie, silent overflow).
 *
 * 5. THE LOCATION PATH IS BEHIND route(). A state's `geo`/`permission` is
 *    installed after the page has loaded, so the whole controller path — the
 *    permission query, the silent fix, useFix — only runs when route() is
 *    called again. See the geo block in pageScript.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { journeyGeometryProblems } = require('./journey-geometry');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(os.tmpdir(), 'trains-states');
const DEFAULT_URL = 'http://localhost:8092/';
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'fixtures', name), 'utf8'));

/* The fixture's pinned moment: 22:45 on Monday 31 August 2026. */
const NOW_ISO = '2026-08-31T22:45:00+10:00';
const NOW = Date.parse(NOW_ISO);

/* The SHORT frame: a 412px Android with the browser's own chrome on screen,
   which is what the owner's phone actually shows — the address bar and the
   status bar take about 170px of a 900px-tall device, and six three-line rows
   do not fit what is left. Measured on 2026-09-01: 696px of board in 567px of
   frame. Every state shot at 390x844 fits; this is the size that does not, and
   the size the board has to stay whole in. */
const SHORT = '412x732';

/* Drive the board to the end of its scroll. Not smooth — the shot is taken
   right after, and a 240ms animation would photograph the middle of it. */
const SCROLL_TO_END = `
  const rowsEl = document.querySelector('.sy-tl');
  rowsEl.scrollTop = rowsEl.scrollHeight;
  await sleep(80);
`;

const TRIP = {
  id: 'trip-central-parramatta',
  from: { id: '200060', name: 'Central Station' },
  to: { id: '215020', name: 'Parramatta Station' },
  createdAt: '2026-08-01T08:00:00+10:00'
};
const TRIP_2 = {
  id: 'trip-town-hall-epping',
  from: { id: '200070', name: 'Town Hall Station' },
  to: { id: '212110', name: 'Epping Station' },
  createdAt: '2026-08-10T08:00:00+10:00'
};
/* The transfer corridor uses the captured fixture shared with the unit tests:
   six real T9 → T4 services. */
const TRIP_TRANSFER = {
  id: 'trip-rhodes-bondi',
  from: { id: '213820', name: 'Rhodes Station' },
  to: { id: '202210', name: 'Bondi Junction Station' },
  createdAt: '2026-08-01T08:00:00+10:00'
};
/* Owner screenshot transcription, 2026-09-06: the short T8 leg and Central
   transfer that exposed platform crowding in both the header and board. */
const TRIP_MASCOT = {
  id: 'trip-mascot-kellyville',
  from: { id: '202010', name: 'Mascot Station' },
  to: { id: '2155382', name: 'Kellyville Station' },
  createdAt: '2026-09-06T20:53:00+10:00'
};
/* The same corridor with the station coordinates the distance line needs; the
   ids are unchanged, so the seeded cache still matches. */
const TRIP_TRANSFER_LOCATED = {
  ...TRIP_TRANSFER,
  from: { id: '213820', name: 'Rhodes Station', location: { lat: -33.8299, lon: 151.0866 } },
  to: { id: '202210', name: 'Bondi Junction Station', location: { lat: -33.8915, lon: 151.2477 } }
};
const TRIP_CENTRAL_LOCATED = {
  id: 'trip-central-parramatta',
  from: { id: '200060', name: 'Central Station', location: { lat: -33.8832, lon: 151.2069 } },
  to: { id: '215020', name: 'Parramatta Station', location: { lat: -33.8172, lon: 151.0050 } },
  createdAt: '2026-08-05T08:00:00+10:00'
};
const TRIP_METRO = {
  id: 'trip-tallawong-chatswood',
  from: { id: '2155384', name: 'Tallawong Station', location: { lat: -33.6918, lon: 150.9060 } },
  to: { id: '206710', name: 'Chatswood Station', location: { lat: -33.7967, lon: 151.1830 } },
  createdAt: '2026-08-06T08:00:00+10:00'
};
const TRIP_MEADOWBANK = {
  id: 'trip-meadowbank-townhall',
  from: { id: '211430', name: 'Meadowbank Station', location: { lat: -33.8180, lon: 151.0900 } },
  to: { id: '200070', name: 'Town Hall Station', location: { lat: -33.8735, lon: 151.2070 } },
  createdAt: '2026-08-07T08:00:00+10:00'
};
const TRIP_EPPING = {
  id: 'trip-epping-chatswood',
  from: { id: '212110', name: 'Epping Station', location: { lat: -33.7727, lon: 151.0820 } },
  to: { id: '206710', name: 'Chatswood Station', location: { lat: -33.7967, lon: 151.1830 } },
  createdAt: '2026-08-08T08:00:00+10:00'
};
const TRIP_FERRY = {
  id: 'trip-circular-quay-manly',
  from: { id: '200020', name: 'Circular Quay', location: { lat: -33.861351, lon: 151.210813 } },
  to: { id: '209573', name: 'Manly Wharf', location: { lat: -33.799541, lon: 151.284282 } },
  createdAt: '2026-09-05T08:00:00+10:00'
};
const TRIP_PYRMONT_DOUBLE_BAY = {
  id: 'trip-pyrmont-double-bay',
  from: { id: '2000260', name: 'Pyrmont Bay Wharf' },
  to: { id: '202823', name: 'Double Bay Wharf' },
  createdAt: '2026-09-05T20:30:00+10:00'
};
const TRIP_DOUBLE_BAY_PYRMONT = {
  id: 'trip-double-bay-pyrmont',
  from: { id: '202823', name: 'Double Bay Wharf' },
  to: { id: '2000260', name: 'Pyrmont Bay Wharf' },
  createdAt: '2026-09-05T20:30:00+10:00'
};
const TRIP_MIXED = {
  id: 'trip-wynyard-manly',
  from: { id: '200080', name: 'Wynyard Station', location: { lat: -33.8659, lon: 151.2057 } },
  to: { id: '209573', name: 'Manly Wharf', location: { lat: -33.799541, lon: 151.284282 } },
  createdAt: '2026-09-05T08:01:00+10:00'
};
const TRIP_BALMAIN_EAST = {
  id: 'trip-circular-quay-balmain-east',
  from: { id: '200020', name: 'Circular Quay' },
  to: { id: '20414', name: 'Balmain East Wharf' },
  createdAt: '2026-09-05T08:02:00+10:00'
};
const TRIP_COCKATOO_BALMAIN = {
  id: 'trip-barangaroo-balmain',
  from: { id: '2000441', name: 'Barangaroo Wharf' },
  to: { id: '204157', name: 'Balmain Wharf' },
  createdAt: '2026-09-05T08:03:00+10:00'
};

/* The coordinates web/stations.json actually carries, so a seeded fix lands
   where the baked index says the station is and `here` names it. */
const IX = {
  rhodes: { id: '213820', name: 'Rhodes Station', location: { lat: -33.83053, lon: 151.087032 } },
  bondi: { id: '202210', name: 'Bondi Junction Station', location: { lat: -33.891202, lon: 151.248384 } },
  burwood: { id: '213410', name: 'Burwood Station', location: { lat: -33.877315, lon: 151.104762 } },
  strathfield: { id: '213510', name: 'Strathfield Station', location: { lat: -33.87181, lon: 151.094427 } }
};

/* One vote per named day, as the client writes them: the shot's own day is
   never among them, because this open casts that one. */
const votesFor = (station, days) => days.map((day) => ({ day, station }));

const TRIP_LONG = {
  id: 'trip-olympicpark-mtvictoria',
  from: { id: '212710', name: 'Olympic Park Station' },
  to: { id: '278610', name: 'Mount Victoria Station' },
  createdAt: '2026-08-01T08:00:00+10:00'
};

/* Tap the row a state is about. The whole row is the target (frozen IA), so
   this drives the real affordance rather than the route — a detail shot is
   also the proof that the board opens it. */
const OPEN_ROW = (i = 0) => `
  document.querySelectorAll('[data-t="row"]')[${i}].click();
  await sleep(140);
`;

/* The one-shot fix the top line reads, written where the client keeps it. */
const FIX = (lat, lon, nowMs) => `
  t.state.fix = { lat: ${lat}, lon: ${lon}, at: ${nowMs} };
  t.rerender();
  await sleep(40);
`;

/** History that makes `predict` choose TRIP forward at 22:45 on a weekday. */
function history(tripId = TRIP.id) {
  return [
    { tripId, direction: 'forward', t: '2026-08-28T22:40:00+10:00' },
    { tripId, direction: 'forward', t: '2026-08-27T22:50:00+10:00' },
    { tripId, direction: 'forward', t: '2026-08-26T22:35:00+10:00' }
  ];
}

function doc({ trips = [TRIP], body = null, fetchedAt = NOW_ISO, hist = history(), focus = null,
  telemetry = null } = {}) {
  const d = {
    schemaVersion: 1,
    trips,
    history: hist,
    lastViewed: trips.length ? { tripId: trips[0].id, direction: 'forward' } : null,
    cache: {}
  };
  if (body) d.cache[trips[0].from.id + '-' + trips[0].to.id] = { fetchedAt, body };
  // Exactly as the client writes it (docs/contracts/client-storage.md): the
  // focused journey is a verbatim snapshot, which is what lets directions
  // outlive the journey's departure from the board.
  if (focus) {
    d.focus = {
      tripId: trips[0].id, direction: 'forward',
      focusedAt: fetchedAt, journey: focus
    };
  }
  if (telemetry) d.telemetry = telemetry;
  return d;
}

/* --- the state list ------------------------------------------------------ */

async function states() {
  const fx = await import(pathToFileURL(path.join(ROOT, 'web/test/fixture.js')).href);
  const {
    departuresBody, baseJourneys, journey, delay, cancel,
    transferBody, transferJourneys, delayLeg, cancelLeg, threeLegJourney,
    TRANSFER_NOW, TRANSFER_DEPARTED_NOW,
    FERRY_NOW, ferryBody, ferryJourneys, mixedBody, mixedJourneys,
    balmainEastBody, cockatooBalmainBody
  } = fx;
  const pyrmontDoubleBayBody = readFixture('departures_pyrmont_doublebay.json');
  const doubleBayPyrmontBody = readFixture('departures_doublebay_pyrmont.json');
  const circularQuayManlyBody = readFixture('departures_circularquay_manly.json');
  const sideOnlySource = cockatooBalmainBody();
  const sideOnlyLeg = sideOnlySource.journeys[0].legDetail[1];
  const sideOnlyBody = {
    from: { ...sideOnlyLeg.from, modes: ['ferry'] },
    to: { ...sideOnlyLeg.to, modes: ['ferry'] },
    generatedAt: sideOnlySource.generatedAt,
    journeys: [{
      departure: sideOnlyLeg.departure,
      arrival: sideOnlyLeg.arrival,
      line: sideOnlyLeg.line,
      destinationHeadsign: sideOnlyLeg.headsign,
      stopsAway: null,
      cancelled: sideOnlyLeg.cancelled,
      legDetail: [sideOnlyLeg]
    }]
  };
  const sideOnlyTrip = {
    id: 'trip-cockatoo-balmain-side-only',
    from: sideOnlyBody.from,
    to: sideOnlyBody.to,
    createdAt: '2026-09-05T08:04:00+10:00'
  };
  const loc = (role, stop, raw, visible = raw) => `${role}|${stop}|${raw}|${visible}`;
  const pyrmontRows = [
    [loc('alight', 'Circular Quay', 'Wharf 4, Side B', '4B'), loc('board', 'Circular Quay', 'Wharf 4, Side B', '4B')],
    [loc('alight', 'Circular Quay', 'Wharf 5, Side B', '5B'), loc('board', 'Circular Quay', 'Wharf 4, Side B', '4B')],
    [loc('alight', 'Circular Quay', 'Wharf 5, Side B', '5B'), loc('board', 'Circular Quay', 'Wharf 2, Side B', '2B')],
    [loc('alight', 'Circular Quay', 'Wharf 5, Side B', '5B'), loc('board', 'Circular Quay', 'Wharf 2, Side B', '2B')]
  ];
  const doubleBayRows = [
    [loc('alight', 'Circular Quay', 'Wharf 5, Side B', '5B'), loc('board', 'Circular Quay', 'Wharf 5, Side A', '5A')],
    [loc('alight', 'Circular Quay', 'Wharf 4, Side A', '4A'), loc('board', 'Circular Quay', 'Wharf 5, Side A', '5A')],
    [loc('alight', 'Circular Quay', 'Wharf 4, Side A', '4A'), loc('board', 'Circular Quay', 'Wharf 5, Side B', '5B')],
    [loc('alight', 'Circular Quay', 'Wharf 5, Side A', '5A'), loc('board', 'Circular Quay', 'Wharf 5, Side B', '5B')]
  ];

  const board = (name, body, opts = {}) => ({
    name,
    seed: doc({ body, trips: opts.trips || [TRIP] }),
    now: opts.now || NOW,
    body,
    route: '#/board',
    events: [],
    ...opts
  });

  const TRANSFER_AT = '2026-09-01T09:21:00+10:00';

  /* S1 — owner screenshot transcription. The capture supplies the endpoints,
     clocks, platforms, lines and headsign. The unprinted segment times use the
     comp's declared 11 / 7 / 50 minute lead axis; the following service keeps
     the capture's 04:53 → 05:56 clocks with the same 11 / 7 shape. */
  const mascotAt = (hhmm, day = 7) => `2026-09-0${day}T${hhmm}:00+10:00`;
  const mascotTimes = (hhmm, day = 7) => ({
    scheduled: mascotAt(hhmm, day), estimated: null
  });
  const mascotJourney = ({ dep, centralIn, centralOut, arr }) => {
    const legDetail = [{
      line: { name: 'T8', mode: 'train' }, headsign: 'City Circle via Museum',
      from: { id: '202010', name: 'Mascot Station', platform: 'Platform 1' },
      to: { id: '200060', name: 'Central Station', platform: 'Platform 21' },
      departure: mascotTimes(dep), arrival: mascotTimes(centralIn), cancelled: false
    }, {
      line: { name: 'M1', mode: 'metro' }, headsign: 'Tallawong',
      from: { id: '200060', name: 'Central Station', platform: 'Platform 26' },
      to: { id: '2155382', name: 'Kellyville Station', platform: 'Platform 2' },
      departure: mascotTimes(centralOut), arrival: mascotTimes(arr), cancelled: false
    }];
    return {
      departure: { ...legDetail[0].departure, platform: 'Platform 1' },
      arrival: { ...legDetail[1].arrival }, line: { name: 'T8', mode: 'train' },
      destinationHeadsign: 'City Circle via Museum', stopsAway: null,
      cancelled: false, legs: 2, legDetail
    };
  };
  const mascotJourneys = () => [
    mascotJourney({ dep: '04:38', centralIn: '04:49', centralOut: '04:56', arr: '05:46' }),
    mascotJourney({ dep: '04:53', centralIn: '05:04', centralOut: '05:11', arr: '05:56' })
  ];
  const mascotBody = (generatedAt = '2026-09-06T20:53:00+10:00') => ({
    from: { ...TRIP_MASCOT.from }, to: { ...TRIP_MASCOT.to }, generatedAt,
    journeys: mascotJourneys()
  });
  const mascot = (name, opts = {}) => {
    const generatedAt = opts.generatedAt || '2026-09-06T20:53:00+10:00';
    const body = mascotBody(generatedAt);
    const seed = doc({
      trips: [TRIP_MASCOT], body, hist: [], fetchedAt: opts.fetchedAt || generatedAt,
      focus: opts.focus ? body.journeys[opts.focusIndex || 0] : null
    });
    if (seed.focus) seed.focus.by = opts.focusBy || 'focus';
    return {
      name, seed, now: opts.now, body, route: '#/',
      events: opts.events || [opts.focus ? (opts.focusBy === 'inferred' ? 'shown_inferred' : 'shown_focus') : 'shown_predicted'],
      after: opts.after, expect: opts.expect
    };
  };

  const metroBody = () => {
    const one = (dep, arr) => ({
      departure: { ...mascotTimes(dep), platform: 'Platform 1' },
      arrival: mascotTimes(arr), line: { name: 'M1', mode: 'metro' },
      destinationHeadsign: 'Chatswood', stopsAway: null, cancelled: false, legs: 1
    });
    return {
      from: { ...TRIP_METRO.from }, to: { ...TRIP_METRO.to },
      generatedAt: '2026-09-07T04:33:00+10:00', journeys: [one('04:38', '05:05'), one('04:53', '05:20')]
    };
  };

  /* A board (and optionally a focus) on the transfer corridor. */
  const transfer = (name, journeys, opts = {}) => {
    const body = transferBody({ journeys, generatedAt: opts.generatedAt || TRANSFER_AT });
    return {
      name,
      seed: doc({
        trips: [TRIP_TRANSFER], body, hist: [],
        fetchedAt: opts.generatedAt || TRANSFER_AT, focus: opts.focus || null
      }),
      now: opts.now || TRANSFER_NOW,
      body,
      route: '#/board',
      events: opts.events || [],
      after: opts.after,
      expect: opts.expect
    };
  };

  const home = (name, journeys, opts = {}) => {
    const body = transferBody({ journeys, generatedAt: opts.generatedAt || TRANSFER_AT });
    const seed = doc({
      trips: opts.trips || [TRIP_TRANSFER],
      body,
      hist: opts.hist || [],
      fetchedAt: opts.generatedAt || TRANSFER_AT,
      focus: opts.focus || null
    });
    // A saved trip prints its line badges from whatever board it has on the
    // device, so a multi-trip home needs more than the selected trip's.
    for (const [key, cached] of Object.entries(opts.cache || {})) {
      seed.cache[key] = { fetchedAt: opts.generatedAt || TRANSFER_AT, body: cached };
    }
    return {
      name,
      seed,
      now: opts.now || TRANSFER_NOW,
      body,
      route: '#/',
      geo: opts.geo || null,
      permission: opts.permission,
      events: opts.events || [opts.focus ? 'shown_focus' : 'shown_predicted'],
      after: opts.after,
      expect: opts.expect
    };
  };

  const ferry = (name, body, opts = {}) => ({
    name,
    seed: doc({
      trips: [opts.trip || TRIP_FERRY], body, hist: opts.hist || [],
      fetchedAt: body.generatedAt, focus: opts.focus || null
    }),
    now: opts.now || FERRY_NOW,
    body,
    route: opts.route || '#/board',
    events: opts.events || (opts.route === '#/'
      ? [opts.focus ? 'shown_focus' : 'shown_predicted'] : []),
    after: opts.after,
    expect: opts.expect
  });

  const tighten = (journeys) => { delayLeg(journeys[0], 0, 5); return journeys; };
  const breakLeg = (journeys) => { cancelLeg(journeys[0], 1); return journeys; };

  const twoChangeBoard = () => {
    const journeys = transferJourneys();
    journeys[0] = threeLegJourney();
    return journeys;
  };
  const mixedPastBody = (journey) => mixedBody({
    generatedAt: '2026-09-05T15:36:00+10:00',
    journeys: journey ? [journey] : []
  });

  /* One displayed minute is the smallest positive delay the floored-minute
     arithmetic can print (r3 OPTIONS.md, S3/S4). */
  const lateSecond = () => { const j = transferJourneys(); delayLeg(j[0], 1, 1); return j; };
  const lateFirst = () => { const j = transferJourneys(); delayLeg(j[0], 0, 1); return j; };
  const staleLate = () => { const j = transferJourneys(); delayLeg(j[0], 1, 9); return j; };
  const cancelledLead = () => { const j = transferJourneys(); cancelLeg(j[0], 0); return j; };
  const scheduledOnly = () => {
    const j = transferJourneys();
    j[0].legDetail.forEach((item) => { item.departure.estimated = null; item.arrival.estimated = null; });
    j[0].departure.estimated = null;
    j[0].arrival.estimated = null;
    return j;
  };

  /* Olympic Park → Strathfield → Mount Victoria: a real journey shape
     carrying the longest station names and the longest headsign the board has
     ever had to print. */
  const longBody = () => {
    const j = transferJourneys()[0];
    Object.assign(j.legDetail[0], {
      line: { name: 'T7', mode: 'train' },
      headsign: 'Central via Lidcombe',
      from: { id: '212710', name: 'Olympic Park Station', platform: 'Platform 1' },
      to: { id: '213510', name: 'Strathfield Station', platform: 'Platform 4' }
    });
    Object.assign(j.legDetail[1], {
      line: { name: 'BMT', mode: 'train' },
      headsign: 'Mount Victoria via Parramatta and Katoomba',
      from: { id: '213510', name: 'Strathfield Station', platform: 'Platform 6' },
      to: { id: '278610', name: 'Mount Victoria Station', platform: 'Platform 2' }
    });
    j.line = { name: 'T7', mode: 'train' };
    j.destinationHeadsign = 'Central via Lidcombe';
    return {
      from: { id: '212710', name: 'Olympic Park Station' },
      to: { id: '278610', name: 'Mount Victoria Station' },
      generatedAt: TRANSFER_AT,
      journeys: [j]
    };
  };

  const delayed = baseJourneys();
  delay(delayed[0], 6);
  delay(delayed[3], 3);

  const cancelled = baseJourneys();
  cancel(cancelled[0]);
  cancel(cancelled[3]);

  const scheduled = baseJourneys().map((j) => {
    j.departure.estimated = null;
    j.arrival.estimated = null;
    return j;
  });

  const long = [
    journey('22:48', '23:17', '12', 'BMT', 'Mount Victoria via Parramatta and Katoomba', true),
    journey('23:03', '23:34', '18', 'T1', 'Emu Plains via Parramatta and Penrith', true),
    ...baseJourneys().slice(2)
  ];

  const shiftJourney = (value, minutes) => {
    const shifted = structuredClone(value);
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      for (const [key, child] of Object.entries(node)) {
        if ((key === 'scheduled' || key === 'estimated') && typeof child === 'string') {
          node[key] = new Date(Date.parse(child) + minutes * 60_000).toISOString();
        } else walk(child);
      }
    };
    walk(shifted);
    return shifted;
  };
  /* Both past registers in one frame: four services with actuals, one of them
     four minutes late, and the two the fixture has no realtime for. Only the
     actuals rows may carry a struck scheduled time (ui.md, past data). */
  const pastBody = (() => {
    const journeys = baseJourneys().map((value) => shiftJourney(value, -75));
    delay(journeys[3], 4);
    return departuresBody({ generatedAt: NOW_ISO, journeys });
  })();
  const reverseJourney = {
    departure: {
      scheduled: '2026-09-01T10:18:00+10:00',
      estimated: '2026-09-01T10:18:00+10:00',
      platform: 'Platform 2'
    },
    arrival: {
      scheduled: '2026-09-01T11:02:00+10:00',
      estimated: '2026-09-01T11:02:00+10:00'
    },
    line: { name: 'T4', mode: 'train' },
    destinationHeadsign: 'Waterfall',
    stopsAway: null,
    cancelled: false,
    legs: 2,
    legDetail: [
      {
        line: { name: 'T4', mode: 'train' }, headsign: 'Waterfall',
        from: { id: '202210', name: 'Bondi Junction Station', platform: 'Platform 2' },
        to: { id: '200070', name: 'Town Hall Station', platform: 'Platform 4' },
        departure: { scheduled: '2026-09-01T10:18:00+10:00', estimated: '2026-09-01T10:18:00+10:00' },
        arrival: { scheduled: '2026-09-01T10:28:00+10:00', estimated: '2026-09-01T10:28:00+10:00' },
        cancelled: false
      },
      {
        line: { name: 'T9', mode: 'train' }, headsign: 'Hornsby via Gordon',
        from: { id: '200070', name: 'Town Hall Station', platform: 'Platform 1' },
        to: { id: '213820', name: 'Rhodes Station', platform: 'Platform 1' },
        departure: { scheduled: '2026-09-01T10:35:00+10:00', estimated: '2026-09-01T10:35:00+10:00' },
        arrival: { scheduled: '2026-09-01T11:02:00+10:00', estimated: '2026-09-01T11:02:00+10:00' },
        cancelled: false
      }
    ]
  };
  const reverseBody = {
    from: { id: '202210', name: 'Bondi Junction Station' },
    to: { id: '213820', name: 'Rhodes Station' },
    generatedAt: '2026-09-01T10:11:00+10:00',
    journeys: [reverseJourney]
  };

  /* A late-night board between the last service and the first: waits beyond 99
     minutes, with no realtime control on any service. */
  const lateNight = [187, 216, 221, 240, 251, 266].map((mins, i) => ({
    departure: {
      scheduled: new Date(NOW + mins * 60000).toISOString(),
      estimated: null,
      platform: 'Platform ' + [3, 1, 1, 1, 1, 1][i]
    },
    arrival: { scheduled: new Date(NOW + (mins + 31) * 60000).toISOString(), estimated: null },
    line: { name: i === 1 ? 'BMT' : 'T1', mode: 'train' },
    destinationHeadsign: i === 1 ? 'Central' : 'Berowra via Gordon',
    stopsAway: null,
    cancelled: false,
    legs: 1
  }));

  const REVERSE_AT = Date.parse('2026-09-01T10:11:00+10:00');

  /* Burwood → Rhodes changes at Strathfield: the pair the app saves itself has
     to be a journey the corridor could really return. */
  const burwoodBody = (() => {
    const on = (hhmm) => `2026-09-01T${hhmm}:00+10:00`;
    const stamp = (hhmm) => ({ scheduled: on(hhmm), estimated: on(hhmm) });
    return {
      from: { id: '213410', name: 'Burwood Station' },
      to: { id: '213820', name: 'Rhodes Station' },
      generatedAt: TRANSFER_AT,
      journeys: [{
        departure: { ...stamp('09:28'), platform: 'Platform 4' },
        arrival: stamp('09:52'),
        line: { name: 'T2', mode: 'train' },
        destinationHeadsign: 'City via Strathfield',
        stopsAway: null,
        cancelled: false,
        legs: 2,
        legDetail: [
          {
            line: { name: 'T2', mode: 'train' }, headsign: 'City via Strathfield',
            from: { id: '213410', name: 'Burwood Station', platform: 'Platform 4' },
            to: { id: '213510', name: 'Strathfield Station', platform: 'Platform 5' },
            departure: stamp('09:28'), arrival: stamp('09:32'), cancelled: false
          },
          {
            line: { name: 'T9', mode: 'train' }, headsign: 'Hornsby via Strathfield',
            from: { id: '213510', name: 'Strathfield Station', platform: 'Platform 3' },
            to: { id: '213820', name: 'Rhodes Station', platform: 'Platform 1' },
            departure: stamp('09:38'), arrival: stamp('09:52'), cancelled: false
          }
        ]
      }]
    };
  })();

  /* Seeded as the client writes it, then driven through route() with the fix in
     place (pageScript's geo block): every answer below is the controller's. */
  const smart = (name, opts) => {
    const generatedAt = opts.generatedAt || TRANSFER_AT;
    const trips = opts.trips || [];
    const seed = {
      schemaVersion: 1,
      trips,
      history: opts.hist || [],
      homeVotes: opts.homeVotes || [],
      lastOpen: opts.lastOpen || null,
      lastViewed: null,
      cache: {}
    };
    if (opts.journeys) {
      seed.cache[trips[0].from.id + '-' + trips[0].to.id] = {
        fetchedAt: generatedAt, body: transferBody({ journeys: opts.journeys, generatedAt })
      };
    }
    for (const [key, cached] of Object.entries(opts.cache || {})) {
      seed.cache[key] = { fetchedAt: cached.generatedAt, body: cached };
    }
    if (opts.focus) {
      seed.focus = {
        tripId: trips[0].id, direction: 'forward', focusedAt: generatedAt,
        journey: opts.focus, by: opts.focusBy || 'focus'
      };
    }
    if (opts.telemetry) seed.telemetry = opts.telemetry;
    return {
      name,
      seed,
      now: opts.now || TRANSFER_NOW,
      body: opts.body !== undefined ? opts.body
        : opts.journeys ? transferBody({ journeys: opts.journeys, generatedAt }) : undefined,
      route: opts.route || '#/',
      geo: opts.geo || null,
      permission: opts.permission,
      variant: opts.variant,
      events: opts.events || [],
      after: opts.after,
      expect: opts.expect
    };
  };

  const inferred = () => ({
    trips: [TRIP_TRANSFER_LOCATED],
    lastOpen: {
      at: '2026-09-01T09:15:00+10:00',
      station: { id: IX.rhodes.id, name: IX.rhodes.name },
      tripId: TRIP_TRANSFER_LOCATED.id,
      direction: 'forward',
      journey: transferJourneys()[0]
    },
    journeys: transferJourneys(),
    now: Date.parse('2026-09-01T09:40:00+10:00'),
    generatedAt: '2026-09-01T09:40:00+10:00',
    geo: IX.strathfield.location,
    expect: { status: 'Running', strip: true, receipt: null, ruleTop: 218.3 }
  });

  const inferredLong = () => {
    const value = inferred();
    value.trips = structuredClone(value.trips);
    value.trips[0].to.name = 'International Airport Station';
    value.lastOpen = structuredClone(value.lastOpen);
    value.lastOpen.journey.legDetail.at(-1).to.name = 'International Airport Station';
    value.journeys = structuredClone(value.journeys);
    value.journeys[0].legDetail.at(-1).to.name = 'International Airport Station';
    return value;
  };

  return [
    home('analytics-predicted-hit', transferJourneys(), {
      after: `document.querySelectorAll('[data-act="open-trip"]')[0].click(); await sleep(120);`,
      events: ['shown_predicted', 'hit_predicted']
    }),
    home('analytics-predicted-miss', transferJourneys(), {
      trips: [TRIP_TRANSFER, TRIP],
      cache: { '200060-215020': departuresBody() },
      after: `document.querySelectorAll('[data-act="open-trip"]')[1].click(); await sleep(120);`,
      events: ['shown_predicted', 'miss_predicted']
    }),
    home('home-location-panel-later', transferJourneys(), {
      trips: [TRIP_TRANSFER, TRIP],
      cache: { '200060-215020': departuresBody() },
      permission: 'prompt',
      after: `document.querySelector('[data-act="skip-location"]').click(); await sleep(80);`,
      events: ['shown_predicted', 'asked_panel', 'later_panel']
    }),
    home('analytics-focus', transferJourneys(), {
      focus: transferJourneys()[0], events: ['shown_focus']
    }),
    home('analytics-rapid-focus', transferJourneys(), {
      after: `document.querySelectorAll('[data-act="open-trip"]')[0].click();
  await sleep(120);
  document.querySelectorAll('[data-t="row"]')[0].click();
  await sleep(120);
  {
    const focus = document.querySelector('[data-act="focus"]');
    focus.click();
    focus.click();
    await sleep(160);
  }`,
      events: ['shown_predicted', 'hit_predicted', 'hit_predicted', 'shown_focus']
    }),
    home('analytics-setup-cancel-hit', transferJourneys(), {
      after: `document.querySelector('[data-act="new-trip"]').click();
  await sleep(180);
  document.querySelector('[data-act="home"]').click();
  await sleep(180);
  document.querySelectorAll('[data-act="open-trip"]')[0].click();
  await sleep(120);`,
      events: ['shown_predicted', 'shown_setup', 'hit_predicted']
    }),
    {
      name: 'analytics-rapid-save',
      seed: doc({ trips: [TRIP_TRANSFER], hist: [] }),
      now: TRANSFER_NOW,
      route: '#/trips/new',
      permission: 'denied',
      events: ['shown_setup', 'saved_setup'],
      after: `
  const choose = async (role, text, stop) => {
    window.fetch = async () => new Response(JSON.stringify({stops: [stop]}), {headers: {'Content-Type': 'application/json'}});
    const input = document.querySelector('[data-role="' + role + '"]');
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    await sleep(700);
    document.querySelector('[data-act="pick"]').click();
    await sleep(40);
  };
  await choose('from', 'central', {id: '200060', name: 'Central Station', modes: ['train']});
  await choose('to', 'parramatta', {id: '215020', name: 'Parramatta Station', modes: ['train']});
  const save = document.querySelector('[data-act="save"]');
  save.click();
  save.click();
      await sleep(160);`
    },
    mascot('mascot-before', {
      now: Date.parse('2026-09-06T20:53:00+10:00'),
      expect: {
        next: ['Next train', '8H', '04:53', '05:56'], pinned: false,
        marker: false, transferStem: false, transferStation: 'Central',
        transferMidpoint: true, platformSeparator: true, sideBySideSpines: true
      }
    }),
    mascot('mascot-pinned-before', {
      now: Date.parse('2026-09-06T20:53:00+10:00'), focus: true,
      expect: {
        status: 'Pinned', next: ['Next train', '8H', '04:53', '05:56'], pinned: true,
        marker: false, transferStem: false, transferStation: 'Central',
        transferMidpoint: true, platformSeparator: true, sideBySideSpines: true
      }
    }),
    (() => {
      const state = mascot('mascot-home-unpin', {
        now: Date.parse('2026-09-07T04:33:00+10:00'),
        generatedAt: '2026-09-07T04:33:00+10:00', focus: true,
        events: ['shown_focus', 'shown_predicted'],
        expect: {
          status: 'Next train', next: ['Next train', '20min', '04:53', '05:56'], pinned: false,
          marker: false, transferStem: false, transferStation: 'Central', departure: '04:38'
        }
      });
      state.seed.lastOpen = {
        at: '2026-09-07T04:34:00+10:00',
        station: { id: TRIP_MASCOT.from.id, name: TRIP_MASCOT.from.name },
        tripId: TRIP_MASCOT.id, direction: 'forward', journey: state.seed.focus.journey
      };
      state.after = `
  {
    const pin = document.querySelector('.hm-top [data-act="unpin"]');
    const beforeFigure = document.querySelector('.hm-fig')?.getBoundingClientRect().top;
    if (!pin || pin.textContent.trim() !== 'Pinned') console.error('home has no Pinned unpin control');
    if (pin) {
      const box = pin.getBoundingClientRect();
      if (box.height < 43.5 || box.top < -0.5 || box.bottom > innerHeight + 0.5) {
        console.error('home Pinned control is not a fully reachable 44px target');
      }
      pin.click();
    }
    await sleep(180);
    const afterFigure = document.querySelector('.hm-fig')?.getBoundingClientRect().top;
    if (beforeFigure === undefined || afterFigure === undefined || Math.abs(beforeFigure - afterFigure) > 0.1) {
      console.error('unpin shifts the smart-header figure from ' + beforeFigure + ' to ' + afterFigure);
    }
    let persisted = JSON.parse(localStorage.getItem('trains.v1'));
    if (persisted.focus) console.error('home unpin did not clear persisted focus');
    if (persisted.lastOpen) console.error('home unpin did not clear persisted lastOpen evidence');
    if (t.state.previousOpen) console.error('home unpin did not clear in-memory previousOpen evidence');
    if (document.querySelector('[data-pinned]')) console.error('home unpin left a pinned indication');
    if (document.querySelector('.hm-e.from .hm-t')?.textContent.trim() !== '04:38') {
      console.error('home unpin did not restore the earliest service');
    }
    // Rebuild controller state from the stored document, as a returning open
    // does. The granted origin fix must not recreate the released focus.
    t.state.doc = structuredClone(persisted);
    t.state.selection = null;
    t.state.previousOpen = t.state.doc.lastOpen || null;
    t.route();
    await sleep(500);
    persisted = JSON.parse(localStorage.getItem('trains.v1'));
    if (persisted.focus || document.querySelector('[data-pinned]')) {
      console.error('released focus re-entered after the returning route with location granted');
    }
  }`;
      return state;
    })(),
    (() => {
      const now = Date.now();
      const at = (offset) => ({ scheduled: new Date(now + offset * 60000).toISOString(), estimated: null });
      const journey = (offset) => {
        const legDetail = [{
          line: { name: 'T8', mode: 'train' }, headsign: 'City Circle via Museum',
          from: { id: '202010', name: 'Mascot Station', platform: 'Platform 1' },
          to: { id: '200060', name: 'Central Station', platform: 'Platform 21' },
          departure: at(offset), arrival: at(offset + 11), cancelled: false
        }, {
          line: { name: 'M1', mode: 'metro' }, headsign: 'Tallawong',
          from: { id: '200060', name: 'Central Station', platform: 'Platform 26' },
          to: { id: '2155382', name: 'Kellyville Station', platform: 'Platform 2' },
          departure: at(offset + 18), arrival: at(offset + 68), cancelled: false
        }];
        return {
          departure: { ...legDetail[0].departure, platform: 'Platform 1' },
          arrival: { ...legDetail[1].arrival }, line: { name: 'T8', mode: 'train' },
          destinationHeadsign: 'City Circle via Museum', stopsAway: null,
          cancelled: false, legs: 2, legDetail
        };
      };
      const lead = journey(-5);
      const body = {
        from: { ...TRIP_MASCOT.from }, to: { ...TRIP_MASCOT.to },
        generatedAt: new Date(now).toISOString(), journeys: [lead, journey(10)]
      };
      const seed = doc({
        trips: [TRIP_MASCOT], body, fetchedAt: body.generatedAt, hist: [], focus: lead
      });
      seed.focus.by = 'focus';
      seed.lastOpen = {
        at: new Date(now - 10 * 60000).toISOString(),
        station: { id: TRIP_MASCOT.from.id, name: TRIP_MASCOT.from.name },
        tripId: TRIP_MASCOT.id, direction: 'forward', journey: lead
      };
      return {
        name: 'mascot-active-unpin-location', seed, now, body, route: '#/',
        geo: { lat: -33.87181, lon: 151.094427, speed: 12 }, permission: 'granted',
        events: ['shown_focus', 'shown_predicted', 'shown_pair'],
        after: `
  {
    const action = document.querySelector('.hm-top [data-act="unpin"]');
    if (!t.state.fix) console.error('granted moving-location unpin state has no fix');
    if (!action) console.error('active explicit focus has no Pinned unpin control');
    else action.click();
    await sleep(180);
    const stored = JSON.parse(localStorage.getItem('trains.v1'));
    if (stored.focus || stored.lastOpen || t.state.previousOpen) {
      console.error('active unpin retained focus or inference evidence');
    }
    t.state.doc = structuredClone(stored);
    t.state.selection = null;
    t.state.previousOpen = t.state.doc.lastOpen || null;
    t.route();
    await sleep(700);
    if (t.state.doc.focus || document.querySelector('[data-pinned]')) {
      console.error('released active journey re-entered from a granted moving fix');
    }
  }`,
        expect: { pinned: false }
      };
    })(),
    mascot('mascot-active', {
      now: Date.parse('2026-09-07T04:44:00+10:00'),
      generatedAt: '2026-09-07T04:44:00+10:00', focus: true,
      expect: {
        status: 'Running · Pinned', next: null, pinned: true,
        marker: true, transferStem: true, transferStation: 'Central',
        transferMidpoint: true, transferInstructionGap: 6,
        platformSeparator: true, sideBySideSpines: true
      }
    }),
    mascot('mascot-inferred-active', {
      now: Date.parse('2026-09-07T04:44:00+10:00'),
      generatedAt: '2026-09-07T04:44:00+10:00', focus: true, focusBy: 'inferred',
      expect: {
        status: 'Running', next: null, pinned: false, marker: true,
        transferStem: true, transferStation: 'Central', transferMidpoint: true,
        transferInstructionGap: 6, platformSeparator: true, sideBySideSpines: true
      }
    }),
    mascot('mascot-stale-before', {
      now: Date.parse('2026-09-07T04:33:00+10:00'),
      generatedAt: '2026-09-07T00:33:00+10:00',
      expect: {
        next: ['Next train', '', '04:53', '05:56'], pinned: false,
        marker: false, transferStem: false, transferStation: 'Central'
      }
    }),
    mascot('mascot-next-pin-flow', {
      now: Date.parse('2026-09-07T04:33:00+10:00'),
      generatedAt: '2026-09-07T04:33:00+10:00',
      events: ['shown_predicted', 'hit_predicted', 'shown_focus'],
      after: `
  document.querySelector('[data-next-service]').click();
  await sleep(140);
  {
    const row = document.querySelector('.detail-scroll [data-t="row"]');
    if (!row || !row.textContent.includes('04:53')) console.error('next service did not open its 04:53 journey detail');
    const action = document.querySelector('[data-act="focus"]');
    if (!action || action.textContent.trim() !== 'Pin this train') console.error('next journey detail does not offer Pin this train');
    action.click();
    await sleep(160);
  }`,
      expect: {
        status: 'Pinned', pinned: true, marker: false, transferStem: false,
        departure: '04:53', next: null
      }
    }),
    (() => {
      const fresh = mascotBody('2026-09-07T04:33:00+10:00');
      const seed = doc({
        trips: [TRIP_MASCOT], body: null, fetchedAt: fresh.generatedAt,
        hist: [], focus: fresh.journeys[0]
      });
      seed.focus.by = 'focus';
      return {
        name: 'mascot-next-focus-source-handoff', seed,
        now: Date.parse('2026-09-07T04:33:00+10:00'), body: null, route: '#/',
        events: ['shown_focus'],
        after: `
  {
    const { departureKey } = await import('/js/journey.js');
    const sourceBody = ${JSON.stringify(fresh)};
    t.state.body = null;
    t.state.focusBody = sourceBody;
    t.state.focusIdentity = t.state.doc.focus.tripId + ':' + t.state.doc.focus.direction + ':'
      + departureKey(t.state.doc.focus.journey);
    t.state.focusOffline = false;
    t.state.focusServerStale = false;
    t.rerender();
    await sleep(60);
    const next = document.querySelector('[data-next-service]');
    if (!next || !next.textContent.includes('04:53') || !next.textContent.includes('05:56')) {
      console.error('fresh focus source did not supply the following service');
    }
    if (!next) throw new Error('fresh focus source following service is unavailable');
    let failRefresh;
    window.fetch = () => new Promise((resolve, reject) => { failRefresh = reject; });
    next.click();
    await sleep(50);
    const first = document.querySelector('.detail-scroll [data-t="row"]');
    const firstFooter = document.querySelector('[data-t="footer"]');
    if (!first || !first.textContent.includes('04:53') || !first.textContent.includes('05:56')
        || !first.textContent.replace(/\\s+/g, '').includes('20min')) {
      console.error('next-service handoff lost its fresh clocks or countdown on first detail paint');
    }
    if (!firstFooter || !firstFooter.textContent.includes('Updated')
        || firstFooter.textContent.includes('Offline')) {
      console.error('next-service handoff did not preserve fresh provenance on first detail paint');
    }
    failRefresh(new TypeError('offline'));
    await sleep(180);
    const stale = document.querySelector('.detail-scroll [data-t="row"]');
    const staleFooter = document.querySelector('[data-t="footer"]');
    if (!stale || !stale.textContent.includes('04:53') || !stale.textContent.includes('05:56')) {
      console.error('failed detail refresh discarded the handed-off journey');
    }
    if (!staleFooter || !staleFooter.textContent.includes('Offline')) {
      console.error('failed detail refresh did not mark the handed-off journey stale');
    }
  }`,
        expect: { copy: ['04:53', '05:56', 'Pin this train'] }
      };
    })(),
    (() => {
      const body = metroBody();
      return {
        name: 'metro-next', seed: doc({ trips: [TRIP_METRO], body, hist: [], fetchedAt: body.generatedAt }),
        now: Date.parse('2026-09-07T04:33:00+10:00'), body, route: '#/', events: ['shown_predicted'],
        expect: { next: ['Next metro', '20min', '04:53', '05:20'], pinned: false, marker: false }
      };
    })(),
    home('home-before', transferJourneys(), { expect: { status: 'Next train' } }),
    home('home-delayed', tighten(transferJourneys()), { expect: { status: 'Next train' } }),
    home('home-cancelled', (() => {
      const value = transferJourneys();
      value[0].cancelled = true;
      value[0].legDetail[0].cancelled = true;
      return value;
    })(), { expect: { status: 'Next train' } }),
    home('home-change', transferJourneys(), {
      now: Date.parse('2026-09-01T09:53:00+10:00'),
      generatedAt: '2026-09-01T09:53:00+10:00',
      focus: transferJourneys()[0],
      expect: { status: 'Running · Pinned' }
    }),
    home('home-final', transferJourneys(), {
      now: Date.parse('2026-09-01T10:01:00+10:00'),
      generatedAt: '2026-09-01T10:01:00+10:00',
      focus: transferJourneys()[0],
      expect: { status: 'Running · Pinned' }
    }),

    /* --- the smart home's own states ------------------------------------ */

    // No fix at all is `home-before`. With one, the top line answers distance,
    // and inside 200 m it answers AT.
    home('home-at', transferJourneys(), {
      trips: [TRIP_TRANSFER_LOCATED], after: FIX(-33.8299, 151.0866, TRANSFER_NOW),
      expect: { status: 'At Rhodes' }
    }),
    home('home-near', transferJourneys(), {
      trips: [TRIP_TRANSFER_LOCATED], after: FIX(-33.8335, 151.0866, TRANSFER_NOW),
      expect: { status: '400 m to Rhodes' }
    }),
    home('home-far', transferJourneys(), {
      trips: [TRIP_TRANSFER_LOCATED], after: FIX(-33.8731, 151.0866, TRANSFER_NOW),
      expect: { status: '4.8 km to Rhodes' }
    }),

    // The second leg one displayed minute late, read during the Town Hall
    // dwell: leg 1 is the relevant one, so this is RUNNING LATE.
    home('home-late', lateSecond(), {
      now: Date.parse('2026-09-01T09:53:00+10:00'),
      generatedAt: '2026-09-01T09:53:00+10:00',
      focus: lateSecond()[0],
      expect: { status: 'Running late · Pinned' }
    }),
    // The first leg late, read while riding it.
    home('home-late-first', lateFirst(), {
      now: Date.parse('2026-09-01T09:33:00+10:00'),
      generatedAt: '2026-09-01T09:33:00+10:00',
      focus: lateFirst()[0],
      expect: { status: 'Running late · Pinned' }
    }),
    // A four-hour-old snapshot carrying a stored nine-minute delay still says
    // RUNNING: a stale delta is not evidence of lateness.
    home('home-stale-focused', staleLate(), {
      now: Date.parse('2026-09-01T09:53:00+10:00'),
      generatedAt: '2026-09-01T05:53:00+10:00',
      focus: staleLate()[0],
      expect: { status: 'Running · Pinned' }
    }),
    // No realtime control on either leg: nothing to be late against.
    home('home-scheduled-focused', scheduledOnly(), {
      now: Date.parse('2026-09-01T09:53:00+10:00'),
      generatedAt: '2026-09-01T09:53:00+10:00',
      focus: scheduledOnly()[0],
      expect: { status: 'Running · Pinned' }
    }),
    // Cancelled before it departs, the header hands over to the next running
    // service while the status still reads CANCELLED.
    home('home-focused-cancelled', cancelledLead(), {
      now: Date.parse('2026-09-01T09:21:00+10:00'),
      generatedAt: '2026-09-01T09:21:00+10:00',
      focus: cancelledLead()[0],
      expect: { status: 'Cancelled' }
    }),
    // Past the arrival: TRIP OVER, with the return offer under the header.
    home('home-over', transferJourneys(), {
      now: Date.parse('2026-09-01T10:11:00+10:00'),
      generatedAt: '2026-09-01T10:11:00+10:00',
      focus: transferJourneys()[0],
      expect: { status: 'Trip over · Pinned' }
    }),
    home('home-five-trips', transferJourneys(), {
      trips: [TRIP_TRANSFER_LOCATED, TRIP_CENTRAL_LOCATED, TRIP_METRO, TRIP_MEADOWBANK, TRIP_EPPING],
      focus: transferJourneys()[0],
      cache: { '200060-215020': departuresBody() },
      expect: { status: 'Running · Pinned' }
    }),
    /* The corridor's real four-minute change, read before its train has left:
       the gap is already painted and the instruction is still the headsign. */
    home('home-tight-before', transferJourneys(), {
      now: Date.parse('2026-09-01T10:30:00+10:00'),
      generatedAt: '2026-09-01T10:30:00+10:00',
      focus: transferJourneys()[5],
      expect: { status: 'Pinned' },
      after: `
  {
    const gap = document.querySelector('.hm-hd [data-tight-gap="true"]');
    if (!gap) console.error('the tight change is not painted before departure');
    const sign = document.querySelector('.hm-sign');
    const said = sign ? sign.textContent.trim() : null;
    if (said !== 'Gordon via Lindfield') {
      console.error('the instruction reads "' + said + '", not the headsign');
    }
  }
`
    }),
    /* --- the location-first answers, driven through the real fix path ---- */

    // At Bondi Junction with only the outbound trip saved and three earlier
    // days voting Rhodes: the header turns the trip around and says why.
    smart('home-here-home', {
      trips: [TRIP_TRANSFER_LOCATED],
      homeVotes: votesFor(IX.rhodes, ['2026-08-29', '2026-08-30', '2026-08-31']),
      cache: { '202210-213820': reverseBody },
      now: REVERSE_AT,
      body: reverseBody,
      geo: IX.bondi.location,
      events: ['shown_predicted', 'shown_home'],
      expect: {
        status: 'At Bondi Junction', strip: false,
        receipt: 'Your days usually start at Rhodes.'
      }
    }),
    // The same answer with no votes behind it: home is the first saved trip's
    // origin, and the receipt claims only that.
    smart('home-here-fallback', {
      trips: [TRIP_TRANSFER_LOCATED],
      cache: { '202210-213820': reverseBody },
      now: REVERSE_AT,
      body: reverseBody,
      geo: IX.bondi.location,
      events: ['shown_predicted', 'shown_home'],
      expect: {
        status: 'At Bondi Junction', strip: false,
        receipt: 'You usually travel from Rhodes.'
      }
    }),
    // A station no saved trip mentions. `locate` answers with a pair, the
    // controller saves it, and the row it just wrote says so once.
    smart('home-here-pair', {
      trips: [TRIP_TRANSFER_LOCATED],
      homeVotes: votesFor(IX.rhodes, ['2026-08-29', '2026-08-30', '2026-08-31']),
      now: TRANSFER_NOW,
      body: burwoodBody,
      geo: { lat: -33.876235, lon: 151.104762 },
      events: ['shown_predicted', 'shown_pair'],
      expect: {
        status: 'At Burwood', strip: false, receipt: null,
        sub: 'Just added · 120 m away'
      }
    }),
    // Seen at Rhodes at 09:15 for the 09:24, and now four kilometres down the
    // line: the app puts the rider back on the train it last showed them.
    smart('home-inferred', {
      ...inferred(), events: ['shown_predicted', 'entered_inferred', 'shown_inferred']
    }),
    smart('home-inferred-a2', {
      ...inferred(), telemetry: { opens: 5, bucket: 37 }, variant: 'a2',
      events: ['shown_predicted', 'entered_inferred', 'shown_inferred'],
      expect: { status: 'Running', strip: true, stripSlot: 'receipt', ruleTop: 262.3 }
    }),
    smart('home-inferred-a2-long', {
      ...inferredLong(), telemetry: { opens: 5, bucket: 37 }, variant: 'a2',
      events: ['shown_predicted', 'entered_inferred', 'shown_inferred'],
      expect: { status: 'Running', strip: true, stripSlot: 'receipt', ruleTop: 262.3 }
    }),
    // ...and the one control that mode has, which opens the familiar sheet on
    // the departure station it already knows.
    smart('setup-redirect', {
      ...inferred(),
      events: ['shown_predicted', 'entered_inferred', 'shown_inferred', 'change_inferred', 'shown_setup'],
      expect: {},
      after: `
  document.querySelector('[data-act="change-destination"]').click();
  await sleep(450);
  {
    const from = document.querySelector('[data-role="from"]');
    const to = document.querySelector('[data-role="to"]');
    if (!from || from.value !== 'Rhodes') console.error('the redirect sheet opens From "' + (from && from.value) + '", not Rhodes');
    if (document.activeElement !== to) console.error('the redirect sheet did not focus the To field');
  }
`
    }),
    smart('analytics-rapid-change', {
      ...inferred(),
      events: ['shown_predicted', 'entered_inferred', 'shown_inferred', 'change_inferred', 'shown_setup'],
      expect: {},
      after: `
  {
    const change = document.querySelector('[data-act="change-destination"]');
    change.click();
    change.click();
    await sleep(450);
  }`
    }),
    // Stepping off four minutes before the timetable says so: the fix ends the
    // trip, and the way back is the only thing left to offer.
    smart('home-arrived', {
      trips: [TRIP_TRANSFER_LOCATED],
      focus: { ...transferJourneys()[0] },
      focusBy: 'inferred',
      now: Date.parse('2026-09-01T10:04:00+10:00'),
      generatedAt: '2026-09-01T10:04:00+10:00',
      journeys: transferJourneys(),
      geo: IX.bondi.location,
      events: ['shown_inferred'],
      expect: { status: 'Trip over', strip: true }
    }),

    /* --- the setup sheet's own location rows ----------------------------- */

    // First run with the permission already granted: the sheet opens where the
    // phone is and asks only for the other end.
    smart('setup-origin', {
      trips: [], route: '#/setup', geo: IX.rhodes.location,
      events: ['shown_setup'],
      after: `
  {
    const from = document.querySelector('[data-role="from"]');
    if (!from || from.value !== 'Rhodes') console.error('the sheet opens From "' + (from && from.value) + '", not Rhodes');
    if (document.activeElement !== document.querySelector('[data-role="to"]')) console.error('the sheet did not focus the To field');
  }
`
    }),
    // First run with nothing granted: the ask is a row in the results, never a
    // prompt on load.
    smart('setup-location-row', {
      trips: [], route: '#/setup', permission: 'prompt',
      events: ['shown_setup', 'asked_setup'],
      after: `
  {
    const row = [...document.querySelectorAll('[data-act="use-location"]')].find((el) => el.closest('.hm-res'));
    if (!row) console.error('the From results carry no location row');
  }
`
    }),
    // Adding a trip with a fix already in hand: the nearest station is offered,
    // not filled in, because this user is not being presumed upon.
    smart('setup-nearest', {
      trips: [TRIP_TRANSFER_LOCATED, TRIP_CENTRAL_LOCATED],
      route: '#/trips/new', geo: IX.rhodes.location,
      events: ['shown_setup'],
      after: `
  {
    const group = [...document.querySelectorAll('.hm-grp')].map((el) => el.textContent.trim());
    if (!group.includes('Nearest station')) console.error('the nearest-station group is missing: ' + JSON.stringify(group));
    if (document.querySelectorAll('[data-act="pick-near"]').length !== 1) console.error('the nearest-station group is not one station');
  }
`
    }),

    board('on-time', departuresBody()),
    board('past-register', departuresBody(), {
      after: `t.state.pastBodies = [${JSON.stringify(pastBody)}]; t.state.initialBoardLanding = true; t.rerender(); await sleep(80);`
    }),
    board('past-register-scrolled', departuresBody(), {
      after: `t.state.pastBodies = [${JSON.stringify(pastBody)}]; t.state.initialBoardLanding = true; t.rerender(); await sleep(80); document.querySelector('.sy-tl').scrollTop = 0; await sleep(80);`
    }),
    board('late-night', departuresBody({ journeys: lateNight })),
    board('delayed', departuresBody({ journeys: delayed })),
    board('cancelled', departuresBody({ journeys: cancelled })),
    board('scheduled-only', departuresBody({ journeys: scheduled })),

    // Four hours old: figures and clocks stay; freshness uses the stale treatment.
    board('stale', departuresBody({ generatedAt: '2026-08-31T18:45:00+10:00' })),
    // Twenty minutes past its generation: two services have left, so the list
    // closes upward and the four that remain distribute down the frame.
    board('stale-departed', departuresBody(), { now: Date.parse('2026-08-31T23:05:00+10:00') }),

    // Caught mid-dissolve: the 22:48 service has just left, its row is fading
    // and the list is about to close upward during its transition. The board is
    // generated at 22:48:30 so advancing the clock to 22:49 departs one service
    // without also changing the board's freshness treatment.
    board('dissolve', departuresBody({ generatedAt: '2026-08-31T22:48:30+10:00' }), {
      // No sleep: screenshot.js's own 120ms settle lands the capture around
      // half way through the 240ms fade, which is the only moment it exists.
      after: `t.now = () => ${NOW + 4 * 60000}; t.tick();`
    }),

    // The minute a service leaves in: the figure reads "Now" and holds the row.
    // Its generatedAt moves with the clock, or the board would be stale
    // instead (three minutes past 22:45 is past STALE_MS) and print no figure.
    board('now-leaving', departuresBody({ generatedAt: '2026-08-31T22:48:10+10:00' }),
      { now: Date.parse('2026-08-31T22:48:20+10:00') }),

    board('sparse', departuresBody({ journeys: baseJourneys().slice(0, 3) })),
    board('empty', departuresBody({ journeys: [] })),
    board('long-names', departuresBody({ journeys: long })),

    // Two saved trips: the masthead earns its third word (SWITCH TRIP).
    board('two-trips', departuresBody(), { trips: [TRIP, TRIP_2] }),

    // No cache, no network: the honest nothing-to-show state.
    {
      name: 'cold-offline', seed: doc({ trips: [TRIP] }), now: NOW, body: null,
      offline: true, events: ['shown_predicted']
    },
    // No cache and the first call still in the post: a cold station pair is one
    // to two seconds of TfNSW, and this line is the whole screen for all of it.
    {
      name: 'cold-loading', seed: doc({ trips: [TRIP] }), now: NOW, body: null,
      events: ['shown_predicted']
    },

    /* The short frame, where the board does not fit. Shot before and after a
       scroll: the sixth service has to be reachable, and the footer has to keep
       its own line under the rows in both. The invariants below assert it —
       these shots are how a person confirms what they assert. */
    board('short-on-time', departuresBody(), { size: SHORT }),
    board('short-on-time-scrolled', departuresBody(), { size: SHORT, after: SCROLL_TO_END }),
    board('short-delayed', departuresBody({ journeys: delayed }), { size: SHORT }),
    board('short-long-names', departuresBody({ journeys: long }), { size: SHORT }),
    board('short-long-names-scrolled', departuresBody({ journeys: long }), {
      size: SHORT, after: SCROLL_TO_END
    }),

    /* --- the journey detail view and the focused board ------------------- */

    // The exemplar's own moment: 09:21 at Rhodes, the 09:24 three minutes out.
    transfer('detail-hero', transferJourneys(), { after: OPEN_ROW(0), expect: { rail: true } }),

    // A direct journey has no change step at all, so its ladder is board and
    // arrive: the 23:12 BMT to Parramatta, reached by tapping its own row.
    board('detail-direct', departuresBody(), { after: OPEN_ROW(2), expect: { rail: true } }),

    // The post-departure promoted row, and the trap it hides: the clock and the
    // body's generatedAt move TOGETHER. Advance only the clock and the board is
    // stale, the figure is correctly withheld, and the shot is of the wrong screen.
    transfer('detail-departed', transferJourneys(), {
      expect: { rail: true },
      after: `${OPEN_ROW(0)}
  t.state.body.generatedAt = '2026-09-01T09:47:00+10:00';
  t.now = () => ${TRANSFER_DEPARTED_NOW};
  t.rerender();
  await sleep(80);`
    }),

    // The journey already being followed has no positive action left.
    transfer('detail-focused', transferJourneys(), {
      focus: transferJourneys()[0], after: OPEN_ROW(0),
      expect: { rail: true, copy: ['Unpin this train'] }
    }),
    transfer('detail-unpin-flow', transferJourneys(), {
      focus: transferJourneys()[0],
      after: `${OPEN_ROW(0)}
  {
    const action = document.querySelector('.detail-rail [data-act="unpin"]');
    if (!action || action.textContent.trim() !== 'Unpin this train') {
      console.error('explicitly pinned detail has no train unpin action');
    } else {
      action.click();
      await sleep(180);
    }
    const persisted = JSON.parse(localStorage.getItem('trains.v1'));
    if (persisted.focus || persisted.lastOpen?.station || document.querySelector('[data-pinned]')) {
      console.error('detail unpin did not fully release the journey');
    }
  }`,
      expect: { status: 'Next train', pinned: false }
    }),
    (() => {
      const state = transfer('detail-inferred', transferJourneys(), {
        focus: transferJourneys()[0], after: OPEN_ROW(0),
        expect: { rail: false, notCopy: ['Unpin this train', 'Pin this train'] }
      });
      state.seed.focus.by = 'inferred';
      return state;
    })(),

    // The first leg five minutes late, so the printed 7-minute change is
    // really 2. Two times, two windows, and no claim about whether you make it.
    transfer('detail-tight', tighten(transferJourneys()), { after: OPEN_ROW(0), expect: { rail: true } }),

    // The second leg cancelled: the journey is cancelled because ANY leg is,
    // and the detail view is the only screen that says WHICH.
    transfer('detail-cancelled', breakLeg(transferJourneys()), { after: OPEN_ROW(0), expect: { rail: false } }),

    // The longest real strings on any of these corridors: nothing abbreviated,
    // the third line allowed to wrap rather than truncate (the detail view's
    // exemption from the three-line invariant in docs/contracts/ui.md).
    {
      name: 'detail-long',
      seed: doc({ trips: [TRIP_LONG], body: longBody(), fetchedAt: TRANSFER_AT, hist: [] }),
      now: TRANSFER_NOW,
      body: longBody(),
      route: '#/board',
      after: OPEN_ROW(0),
      expect: { rail: true }
    },

    transfer('focus-returns-home', transferJourneys(), {
      after: `${OPEN_ROW(0)} document.querySelector('[data-act="focus"]').click(); await sleep(160);`,
      events: ['shown_focus'],
      expect: { status: 'Running · Pinned' }
    }),

    home('reverse-real-platforms', transferJourneys(), {
      now: Date.parse('2026-09-01T10:11:00+10:00'),
      generatedAt: '2026-09-01T10:11:00+10:00',
      focus: transferJourneys()[0],
      after: `window.fetch = async () => new Response(${JSON.stringify(JSON.stringify(reverseBody))}, { headers: { 'Content-Type': 'application/json' } }); document.querySelector('[data-act="way-back"]').click(); await sleep(220);`,
      events: ['shown_focus', 'back_focus'],
      expect: { status: 'Next train' }
    }),

    // A focus never adds a board strip: the board remains exactly six slots.
    transfer('board-focused', transferJourneys(), { focus: transferJourneys()[0] }),

    // ...and the proof, driven to the end of the board.
    transfer('board-focused-scrolled', transferJourneys(), {
      focus: transferJourneys()[0], after: SCROLL_TO_END
    }),

    // 09:47: the focused journey has left the live board, while its snapshot
    // remains available to home and journey detail.
    transfer('board-focused-departed', transferJourneys().slice(2), {
      focus: transferJourneys()[0],
      now: TRANSFER_DEPARTED_NOW,
      generatedAt: '2026-09-01T09:47:00+10:00'
    }),

    /* The transfer states. A tight change is painted on the dwell alone; a
       cancelled one never is, even when the window is short; two changes are
       the renderer's plural seam. */
    transfer('board-tight', tighten(transferJourneys())),
    transfer('board-cancelled-tight', breakLeg(tighten(transferJourneys()))),
    transfer('board-two-change', twoChangeBoard()),

    ferry('ferry-pyrmont', pyrmontDoubleBayBody, {
      trip: TRIP_PYRMONT_DOUBLE_BAY,
      now: Date.parse(pyrmontDoubleBayBody.generatedAt),
      expect: {
        boardHeader: ['Pyrmont Bay Wharf', 'Double Bay Wharf'],
        equalHeaderLines: true,
        caps: Array(4).fill('Wharf'),
        ferryLocations: pyrmontRows.flatMap((row) => [
          loc('origin', 'Pyrmont Bay Wharf', 'Pyrmont Bay Wharf', 'Wharf'), ...row
        ]),
        copy: ['Circular Quay'],
        accessibleCopy: ['Pyrmont Bay Wharf'],
        ferryCodes: ['F4', 'F7']
      }
    }),
    ferry('ferry-doublebay', doubleBayPyrmontBody, {
      trip: TRIP_DOUBLE_BAY_PYRMONT,
      now: Date.parse(doubleBayPyrmontBody.generatedAt),
      expect: {
        boardHeader: ['Double Bay Wharf', 'Pyrmont Bay Wharf'],
        equalHeaderLines: true,
        caps: Array(4).fill('Wharf'),
        ferryLocations: doubleBayRows.flatMap((row) => [
          loc('origin', 'Double Bay Wharf', 'Double Bay Wharf', 'Wharf'), ...row
        ]),
        copy: ['Circular Quay'],
        accessibleCopy: ['Double Bay Wharf'],
        ferryCodes: ['F7', 'F4']
      }
    }),
    ferry('ferry-numeric-control', circularQuayManlyBody, {
      trip: TRIP_FERRY,
      now: Date.parse(circularQuayManlyBody.generatedAt),
      expect: {
        boardHeader: ['Circular Quay', 'Manly Wharf'],
        caps: ['Wharf 4, Side A', 'Wharf 4, Side B', 'Wharf 4, Side A', 'Wharf 4, Side A'],
        ferryLocations: ['A', 'B', 'A', 'A'].map((side) => loc('origin', 'Circular Quay', `Wharf 4, Side ${side}`)),
        ferryCodes: ['F1']
      }
    }),
    ferry('ferry-side-only-control', sideOnlyBody, {
      trip: sideOnlyTrip,
      now: Date.parse(sideOnlyBody.generatedAt),
      expect: {
        boardHeader: ['Cockatoo Island Wharf', 'Balmain Wharf'],
        caps: ['Side A'],
        ferryLocations: [loc('origin', 'Cockatoo Island Wharf', 'Side A')],
        ferryCodes: ['F8']
      }
    }),
    ferry('ferry-pyrmont-home', pyrmontDoubleBayBody, {
      trip: TRIP_PYRMONT_DOUBLE_BAY,
      route: '#/',
      now: Date.parse(pyrmontDoubleBayBody.generatedAt),
      expect: {
        status: 'Next ferry',
        caps: ['Wharf'],
        ferryLocations: [
          loc('origin', 'Pyrmont Bay Wharf', 'Pyrmont Bay Wharf', 'Wharf'), ...pyrmontRows[0]
        ],
        ferryCodes: ['F4', 'F7']
      }
    }),
    ferry('ferry-pyrmont-home-focused', pyrmontDoubleBayBody, {
      trip: TRIP_PYRMONT_DOUBLE_BAY,
      route: '#/',
      now: Date.parse(pyrmontDoubleBayBody.generatedAt),
      focus: pyrmontDoubleBayBody.journeys[1],
      expect: {
        status: 'Pinned',
        caps: ['Wharf'],
        ferryLocations: [
          loc('origin', 'Pyrmont Bay Wharf', 'Pyrmont Bay Wharf', 'Wharf'), ...pyrmontRows[1]
        ],
        ferryCodes: ['F4', 'F7']
      }
    }),
    ferry('ferry-numeric-home', circularQuayManlyBody, {
      trip: TRIP_FERRY,
      route: '#/',
      now: Date.parse(circularQuayManlyBody.generatedAt),
      expect: {
        status: 'Next ferry',
        caps: ['Wharf 4, Side A'],
        ferryLocations: [loc('origin', 'Circular Quay', 'Wharf 4, Side A')],
        ferryCodes: ['F1']
      }
    }),
    ferry('ferry-numeric-home-focused', circularQuayManlyBody, {
      trip: TRIP_FERRY,
      route: '#/',
      now: Date.parse(circularQuayManlyBody.generatedAt),
      focus: circularQuayManlyBody.journeys[1],
      expect: {
        status: 'Pinned',
        caps: ['Wharf 4, Side B'],
        ferryLocations: [loc('origin', 'Circular Quay', 'Wharf 4, Side B')],
        ferryCodes: ['F1']
      }
    }),
    ferry('ferry-doublebay-home', doubleBayPyrmontBody, {
      trip: TRIP_DOUBLE_BAY_PYRMONT,
      route: '#/',
      now: Date.parse(doubleBayPyrmontBody.generatedAt),
      expect: {
        status: 'Next ferry',
        caps: ['Wharf'],
        ferryLocations: [
          loc('origin', 'Double Bay Wharf', 'Double Bay Wharf', 'Wharf'), ...doubleBayRows[0]
        ],
        ferryCodes: ['F7', 'F4']
      }
    }),
    ferry('ferry-doublebay-home-focused', doubleBayPyrmontBody, {
      trip: TRIP_DOUBLE_BAY_PYRMONT,
      route: '#/',
      now: Date.parse(doubleBayPyrmontBody.generatedAt),
      focus: doubleBayPyrmontBody.journeys[0],
      expect: {
        status: 'Pinned',
        caps: ['Wharf'],
        ferryLocations: [
          loc('origin', 'Double Bay Wharf', 'Double Bay Wharf', 'Wharf'), ...doubleBayRows[0]
        ],
        ferryCodes: ['F7', 'F4']
      }
    }),
    ferry('ferry-pyrmont-detail', pyrmontDoubleBayBody, {
      trip: TRIP_PYRMONT_DOUBLE_BAY,
      now: Date.parse(pyrmontDoubleBayBody.generatedAt),
      after: OPEN_ROW(1),
      expect: {
        rail: true,
        compactPromoted: true,
        caps: ['Wharf'],
        ferryLocations: [
          loc('origin', 'Pyrmont Bay Wharf', 'Pyrmont Bay Wharf', 'Wharf'),
          ...pyrmontRows[1],
          loc('origin', 'Pyrmont Bay Wharf', 'Pyrmont Bay Wharf', 'Wharf'),
          ...pyrmontRows[1],
          loc('arrival', 'Double Bay Wharf', 'Double Bay Wharf', '—')
        ],
        boardingLocations: ['Wharf 4, Side B'],
        copy: ['Pyrmont Bay Wharf', 'Double Bay Wharf', 'Pin this ferry'],
        accessibleCopy: ['Pyrmont Bay Wharf'],
        ferryCodes: ['F4', 'F7']
      }
    }),
    ferry('ferry-doublebay-detail', doubleBayPyrmontBody, {
      trip: TRIP_DOUBLE_BAY_PYRMONT,
      now: Date.parse(doubleBayPyrmontBody.generatedAt),
      after: OPEN_ROW(0),
      expect: {
        rail: true,
        compactPromoted: true,
        caps: ['Wharf'],
        ferryLocations: [
          loc('origin', 'Double Bay Wharf', 'Double Bay Wharf', 'Wharf'),
          ...doubleBayRows[0],
          loc('origin', 'Double Bay Wharf', 'Double Bay Wharf', 'Wharf'),
          ...doubleBayRows[0],
          loc('arrival', 'Pyrmont Bay Wharf', 'Pyrmont Bay Wharf', '—')
        ],
        boardingLocations: ['Wharf 5, Side A'],
        copy: ['Double Bay Wharf', 'Pyrmont Bay Wharf', 'Pin this ferry'],
        ferryCodes: ['F7', 'F4']
      }
    }),
    ferry('ferry-numeric-detail', circularQuayManlyBody, {
      trip: TRIP_FERRY,
      now: Date.parse(circularQuayManlyBody.generatedAt),
      after: OPEN_ROW(1),
      expect: {
        rail: true,
        caps: ['Wharf 4, Side B'],
        ferryLocations: [
          loc('origin', 'Circular Quay', 'Wharf 4, Side B'),
          loc('origin', 'Circular Quay', 'Wharf 4, Side B'),
          loc('arrival', 'Manly Wharf', 'Wharf 1', '1')
        ],
        copy: ['Circular Quay', 'Manly Wharf', 'Pin this ferry'],
        ferryCodes: ['F1']
      }
    }),

    ferry('ferry-home', ferryBody(), {
      route: '#/',
      expect: { status: 'Next ferry', nextLabel: 'Next ferry', ferryCodes: ['MFF'] }
    }),
    ferry('ferry-board', ferryBody(), {
      expect: { copy: ['Wharf 2, Side A', 'Wharf 3, Side A'], ferryCodes: ['MFF', 'F1'] }
    }),
    ferry('ferry-detail', ferryBody(), {
      after: OPEN_ROW(1),
      expect: { rail: true, copy: ['Pin this ferry', 'Wharf 3, Side A'], ferryCodes: ['F1'] }
    }),
    ferry('ferry-focus-before', ferryBody({ generatedAt: '2026-09-05T15:43:00+10:00' }), {
      route: '#/',
      now: Date.parse('2026-09-05T15:43:00+10:00'),
      focus: ferryJourneys()[1],
      after: FIX(-33.861351, 151.210813, Date.parse('2026-09-05T15:43:00+10:00')),
      expect: { status: 'Pinned', copy: ['Leave now for Wharf 3, Side A'], ferryCodes: ['F1'] }
    }),
    ferry('ferry-distinct-stop-board', balmainEastBody(), {
      trip: TRIP_BALMAIN_EAST,
      expect: { copy: ['Wynyard → Barangaroo'], ferryCodes: ['F4'] }
    }),
    ferry('ferry-distinct-stop-detail', balmainEastBody(), {
      trip: TRIP_BALMAIN_EAST,
      after: OPEN_ROW(1),
      expect: {
        rail: true,
        copy: ['Wynyard → Barangaroo', 'Board F4 · Balmain East', 'Wharf 2, Side B', 'Pin this train'],
        aria: ['Wharf 2, Side B · F4'],
        ferryCodes: ['F4']
      }
    }),
    ferry('ferry-exception-detail', cockatooBalmainBody(), {
      trip: TRIP_COCKATOO_BALMAIN,
      after: OPEN_ROW(0),
      expect: {
        rail: true,
        compactPromoted: true,
        copy: ['Side A', 'Balmain Wharf', 'Pin this ferry'],
        notCopy: ['Wharf Side A', 'Wharf Balmain Wharf'],
        detailChips: ['Wharf 1, Side B', 'A', 'A', '—'],
        ferryLocations: [
          loc('origin', 'Barangaroo Wharf', 'Wharf 1, Side B'),
          loc('alight', 'Cockatoo Island Wharf', 'Side A', 'A'),
          loc('board', 'Cockatoo Island Wharf', 'Side A', 'A'),
          loc('origin', 'Barangaroo Wharf', 'Wharf 1, Side B'),
          loc('alight', 'Cockatoo Island Wharf', 'Side A', 'A'),
          loc('board', 'Cockatoo Island Wharf', 'Side A', 'A'),
          loc('arrival', 'Balmain Wharf', 'Balmain Wharf', '—')
        ],
        boardingLocations: ['Side A'],
        aria: ['Side A · F8', 'Balmain Wharf · F8'],
        ferryCodes: ['F3', 'F8']
      }
    }),
    ferry('mixed-board', mixedBody(), {
      trip: TRIP_MIXED,
      now: Date.parse('2026-09-05T15:25:00+10:00'),
      expect: {
        copy: ['Circular Quay'],
        aria: ['Wharf 2, Side A · MFF'],
        ferryLocations: [
          loc('board', 'Circular Quay', 'Wharf 2, Side A', '2A'),
          loc('board', 'Circular Quay', 'Wharf 3, Side A', '3A')
        ],
        ferryCodes: ['MFF', 'F1']
      }
    }),
    ferry('mixed-detail', mixedBody(), {
      trip: TRIP_MIXED,
      now: Date.parse('2026-09-05T15:25:00+10:00'),
      after: OPEN_ROW(1),
      expect: {
        rail: true,
        compactPromoted: true,
        copy: ['arrives 16:07', 'Board F1 · Manly', 'Wharf 3, Side A', 'Pin this train'],
        aria: ['Wharf 3, Side A · F1'],
        ferryLocations: [
          loc('board', 'Circular Quay', 'Wharf 3, Side A', '3A'),
          loc('board', 'Circular Quay', 'Wharf 3, Side A', '3A'),
          loc('arrival', 'Manly Wharf', 'Wharf 1', '1')
        ],
        boardingLocations: ['Wharf 3, Side A'],
        ferryCodes: ['F1']
      }
    }),
    ferry('mixed-detail-mff', mixedBody(), {
      trip: TRIP_MIXED,
      now: Date.parse('2026-09-05T15:25:00+10:00'),
      after: OPEN_ROW(0),
      expect: {
        rail: true,
        copy: ['arrives 16:00', 'Board MFF · Manly', 'Wharf 2, Side A', 'Pin this train'],
        aria: ['Wharf 2, Side A · MFF'],
        ferryCodes: ['MFF']
      }
    }),
    ferry('mixed-past-dedupe', mixedPastBody(null), {
      trip: TRIP_MIXED,
      after: `
  t.state.pastBodies = [${JSON.stringify(mixedBody({ journeys: [mixedJourneys()[0]] }))}];
  t.state.pastExhausted = false;
  t.state.loadingPast = false;
  window.fetch = async () => new Response(${JSON.stringify(JSON.stringify(mixedBody({ journeys: [mixedJourneys()[1]] })))}, { headers: { 'Content-Type': 'application/json' } });
  await t.older();
  await sleep(80);
  if (!t.state.pastExhausted) console.error('mixed onward-only duplicate did not exhaust past pagination');
  if (t.state.pastBodies.length !== 1) console.error('mixed onward-only duplicate appended a past page');`,
      expect: {}
    }),

    {
      name: 'first-run', seed: doc({ trips: [], hist: [] }), now: NOW, route: '#/setup',
      events: ['shown_setup', 'asked_setup']
    },
    {
      name: 'first-run-search-manly',
      seed: doc({ trips: [], hist: [] }),
      now: FERRY_NOW,
      route: '#/setup',
      events: ['shown_setup', 'asked_setup'],
      type: { role: 'from', text: 'manly' },
      stops: { stops: [{ id: '209573', name: 'Manly Wharf', modes: ['ferry'] }] },
      expect: { copy: ['Manly', 'ferry'] }
    },
    {
      name: 'first-run-search-circular',
      seed: doc({ trips: [], hist: [] }),
      now: FERRY_NOW,
      route: '#/setup',
      events: ['shown_setup', 'asked_setup'],
      type: { role: 'from', text: 'circular' },
      stops: { stops: [{ id: '200020', name: 'Circular Quay', modes: ['train', 'ferry'] }] },
      expect: { copy: ['Circular Quay', 'train · ferry'] }
    },
    {
      name: 'first-run-recent-manly-offline',
      seed: {
        ...doc({ trips: [], hist: [] }),
        searches: {
          from: [{ id: '209573', name: 'Manly Wharf', modes: ['ferry'] }],
          to: []
        }
      },
      now: FERRY_NOW,
      route: '#/setup',
      events: ['shown_setup', 'asked_setup'],
      type: { role: 'from', text: 'Manly Wharf', reject: true },
      expect: { copy: ['You searched before', 'Manly Wharf'] }
    },
    {
      name: 'first-run-search',
      seed: doc({ trips: [], hist: [] }),
      now: NOW,
      route: '#/setup',
      events: ['shown_setup', 'asked_setup'],
      type: { role: 'from', text: 'central' }
    },
    // Two characters: too short to ask TfNSW anything worth waiting for, so the
    // screen asks for another letter instead of claiming there is no station.
    {
      name: 'first-run-short-query',
      seed: doc({ trips: [], hist: [] }),
      now: NOW,
      route: '#/setup',
      events: ['shown_setup', 'asked_setup'],
      type: { role: 'from', text: 'ce', freeze: true }
    },
    // The call is away and nothing has come back yet — up to a second and a
    // half of it. The network stays frozen so this state holds still.
    {
      name: 'first-run-searching',
      seed: doc({ trips: [], hist: [] }),
      now: NOW,
      route: '#/setup',
      events: ['shown_setup', 'asked_setup'],
      type: { role: 'from', text: 'cen', freeze: true }
    },
    {
      name: 'desktop', seed: doc({ body: departuresBody() }), now: NOW,
      body: departuresBody(), size: '1280x800', desktop: true,
      events: ['shown_predicted']
    },
    {
      name: 'desktop-delayed',
      seed: doc({ body: departuresBody({ journeys: delayed }) }),
      now: NOW,
      body: departuresBody({ journeys: delayed }),
      size: '1280x800',
      desktop: true,
      events: ['shown_predicted']
    },
    {
      ...transfer('desktop-detail', transferJourneys(), { after: OPEN_ROW(0) }),
      size: '1280x800',
      desktop: true
    }
  ].map((state) => ({
    events: [],
    ...state,
    permission: state.permission || (!state.geo && state.seed.trips.length === 0 ? 'prompt' : undefined)
  }));
}

/* --- the page script each state runs ------------------------------------- */

const STOPS = {
  stops: [
    { id: '200060', name: 'Central Station', modes: ['train', 'metro'] },
    { id: '2000397', name: 'Central Chalmers Street, Stand C', modes: ['train'] },
    { id: '213891', name: 'Central Coast Line', modes: ['train'] }
  ]
};

function pageScript(state) {
  const body = state.body === undefined ? null : state.body;
  return `(async () => {
  const t = window.__trains;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // TRAP 1: freeze the network and abort whatever main.js already asked for.
  const analyticsRequests = [];
  const analyticsBeacons = [];
  let fetchImpl = () => new Promise(() => {});
  const guardedFetch = (input, init) => {
    const url = String(input && input.url || input || '');
    if (url.startsWith('https://analytics.jeremyvun.com/')) {
      analyticsRequests.push({ url, init });
      return Promise.reject(new TypeError('analytics is disabled in the shooter'));
    }
    return fetchImpl(input, init);
  };
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    get: () => guardedFetch,
    set: (next) => { fetchImpl = next; }
  });
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (url, body) => {
      if (String(url).startsWith('https://analytics.jeremyvun.com/')) analyticsBeacons.push({ url, body });
      return true;
    }
  });
  if (t) t.refresh();
  await sleep(40);

  if (t) t.now = () => ${state.now};

  if (location.hash !== ${JSON.stringify(state.route || '#/')}) {
    location.hash = ${JSON.stringify(state.route || '#/')};
    await sleep(100);
  }
  ${state.variant ? `if (!t.forceVariant('strip-placement', ${JSON.stringify(state.variant)})) throw new Error('could not force strip-placement');` : ''}
  if (!t || typeof t.resetAnalyticsForTest !== 'function') {
    throw new Error('the local analytics reset seam is missing');
  }
  t.resetAnalyticsForTest();
  t.state.doc = ${JSON.stringify(state.seed)};
  localStorage.setItem('trains.v1', JSON.stringify(t.state.doc));
  t.state.selection = null;
  t.state.previousOpen = t.state.doc.lastOpen || null;
  t.state.fix = null;
  t.state.geoPermission = null;
  t.state.body = null;
  t.state.focusBody = null;
  t.state.focusIdentity = null;
  t.state.focusOffline = false;
  t.state.focusServerStale = false;
  t.state.detailHandoff = null;
  t.state.journey = null;
  t.state.offline = false;
  t.route();
  await sleep(${state.geo || state.permission ? state.geoSettleMs || 500 : 180});

  ${state.geo || state.permission ? `
  // Only home holds the index in controller state; the sheet loads its own copy.
  if (${JSON.stringify(state.route || '#/')} === '#/' && !t.state.stations) {
    throw new Error('the station index never loaded: nothing can name where the fix is');
  }
  ${state.geo && (state.permission || 'granted') === 'granted'
    ? `if (!t.state.fix) throw new Error('the controller took no fix, so no answer on this screen came from one');` : ''}
  ` : ''}

  ${state.type ? `
  // A frozen fetch photographs the WAIT; the mock photographs the answer.
  ${state.type.freeze ? '' : state.type.reject
    ? 'window.fetch = async () => { throw new TypeError("offline"); };'
    : `window.fetch = async () => new Response(${JSON.stringify(JSON.stringify(state.stops || STOPS))}, { headers: { 'Content-Type': 'application/json' } });`}
  const input = document.querySelector('[data-role="${state.type ? state.type.role : ''}"]');
  input.focus();
  input.value = ${JSON.stringify(state.type ? state.type.text : '')};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(700);
  ` : ''}

  if (t && t.onLiveView()) {
    t.state.pastBodies = [];
    t.state.seenLive = new Map();
    t.state.body = ${JSON.stringify(body)};
    t.state.offline = ${state.offline ? 'true' : 'false'};
    t.state.serverStale = false;
    t.rerender();
  }

  ${state.after || ''}

  // Invariants checked on every state, in the browser, at the shot's viewport.
  // They are reported at console.error, which screenshot.js prints under the
  // shot, so a broken invariant cannot hide inside a plausible-looking image.
  // The numbers below are the ones docs/contracts/ui.md binds; a state declares
  // what it means in its expect block.
  try {
    const problems = (${journeyGeometryProblems.toString()})(document);
    const expect = ${JSON.stringify(state.expect || {})};
    const px = (value) => parseFloat(value) || 0;
    const measures = getComputedStyle(document.body);
    const PAD = px(measures.getPropertyValue('--sy-pad'));
    const near = (a, b, slack = 0.5) => Math.abs(a - b) <= slack;
    const round = (value) => Math.round(value * 10) / 10;
    const rowEls = [...document.querySelectorAll('[data-t="row"]')];
    const figureRights = [];

    for (const row of rowEls) {
      const box = row.getBoundingClientRect();
      const promoted = row.classList.contains('promoted');
      const rowFigure = px(getComputedStyle(row).getPropertyValue('--sy-fig'));

      // docs/contracts/ui.md, binding: three lines per row, in every state.
      const lines = ['.sy-t', '.sy-j', '.sy-sign'].map((s) => row.querySelector(s));
      if (lines.some((el) => !el || !el.textContent.trim())) problems.push('row is not three full lines');

      // Transfer-name bands are part of the row. They may make an ordinary
      // board row taller than the 96px base, and must remain reachable rather
      // than being clipped back into the old fixed slot.
      const height = promoted ? 100 : 96;
      const transferBand = Boolean(row.querySelector('.sy-j.has-changes'));
      const canGrow = transferBand
        || (promoted && row.classList.contains('change') && !expect.compactPromoted);
      if (canGrow ? box.height < height - 0.5 : !near(box.height, height)) {
        problems.push('the row is ' + round(box.height) + 'px, not the ledger’s ' + height);
      }

      // The rule is drawn edge to edge of a row that is itself edge to edge of
      // the region holding it. An inset rule reads as a box.
      const rule = getComputedStyle(row, '::after');
      if (!near(px(rule.width), box.width) || px(rule.left) !== 0) {
        problems.push('the row rule is ' + rule.width + ' inset ' + rule.left + ' across a ' + round(box.width) + 'px row');
      }
      const region = row.closest('[data-scroller]');
      if (region) {
        const held = region.getBoundingClientRect();
        if (!near(box.left, held.left) || !near(box.width, region.clientWidth)) {
          problems.push('the row is inset ' + round(box.left - held.left) + 'px in its region, so its rule cannot reach both edges');
        }
      }

      // One figure column across every row and every screen (probe: 22 + 72).
      const fig = row.querySelector('[data-figure-column]');
      if (fig) {
        const right = fig.getBoundingClientRect().right;
        figureRights.push(right);
        if (!near(right, box.left + PAD + rowFigure)) {
          problems.push('the figure column ends at ' + round(right) + ', not ' + (box.left + PAD + rowFigure));
        }
      }
      // The figure must fit its column: it has no ellipsis and nothing clips
      // it, so an overlong one is drawn straight through the departure time.
      const mins = row.querySelector('.sy-n');
      if (mins && mins.scrollWidth > mins.clientWidth) {
        problems.push('figure "' + (mins.firstChild && mins.firstChild.nodeValue) + '" overflows its column: '
          + mins.scrollWidth + ' > ' + mins.clientWidth);
      }
      const unit = row.querySelector('.sy-u');
      if (mins && unit) {
        const wide = row.classList.contains('wide');
        const expectedFigure = innerWidth >= 900 ? (wide ? 36 : 46.8) : (wide ? 27.9 : 40.5);
        const figureStyle = getComputedStyle(mins);
        const unitStyle = getComputedStyle(unit);
        if (!near(px(figureStyle.fontSize), expectedFigure, 0.1)) {
          problems.push('figure type is ' + figureStyle.fontSize + ', not ' + expectedFigure + 'px');
        }
        if (!near(px(unitStyle.fontSize), 12, 0.1) || unitStyle.fontWeight !== '500'
          || !near(px(unitStyle.paddingLeft), 2, 0.1)) {
          problems.push('unit type is ' + unitStyle.fontSize + '/' + unitStyle.fontWeight
            + ' with ' + unitStyle.paddingLeft + ' inset, not 12px/500 with 2px');
        }
        if (unitStyle.color !== figureStyle.color) {
          problems.push('unit colour ' + unitStyle.color + ' does not inherit figure colour ' + figureStyle.color);
        }
      }
      // The provenance shares the figure's 72px column and has no ellipsis, so
      // an overlong one is drawn straight through the departure time.
      const prov = row.querySelector('.sy-st');
      if (prov && prov.scrollWidth > prov.clientWidth) {
        problems.push('provenance "' + prov.textContent.trim() + '" overflows the figure column by '
          + (prov.scrollWidth - prov.clientWidth) + 'px');
      }

      // Every change states where it happens and which platform it boards
      // from; a label pushed out of the frame states neither.
      for (const gap of row.querySelectorAll('[data-transfer-gap]')) {
        const index = gap.dataset.transferGap;
        const at = (sel) => row.querySelector(sel + '[data-transfer-index="' + index + '"]');
        for (const [what, el] of [['station', at('[data-transfer-station]')], ['boarding platform', at('[data-transfer-platform]')]]) {
          if (!el) { problems.push('change ' + index + ' names no ' + what); continue; }
          const rect = el.getBoundingClientRect();
          if (rect.width < 1) problems.push('change ' + index + ' names no ' + what);
          else if (rect.left < -0.5 || rect.right > innerWidth + 0.5) {
            problems.push('change ' + index + '’s ' + what + ' "' + el.textContent.trim() + '" is outside the frame');
          }
        }
      }

      // An upstream headsign may be ellipsised, but only once it has used the
      // whole row.
      const sign = row.querySelector('[data-headsign]');
      if (sign && sign.scrollWidth > sign.clientWidth) {
        const free = box.right - PAD - sign.getBoundingClientRect().right;
        if (free > 1) problems.push('the headsign is ellipsised with ' + round(free) + 'px of row still free');
      }
      // Our own copy must never be ellipsised. An upstream headsign may be.
      const note = row.querySelector('.sy-sign.note');
      if (note && note.scrollWidth > note.clientWidth) {
        problems.push('cancelled-lead note truncated: ' + note.scrollWidth + ' > ' + note.clientWidth);
      }

      // The tight window is painted on the dwell alone, and a cancelled journey
      // never paints one.
      const warned = [...row.querySelectorAll('[data-seg].warn')];
      for (const seg of warned) {
        if (!seg.hasAttribute('data-transfer-gap')) problems.push('the tight colour is painted on a ride segment, not the dwell');
      }
      if (row.classList.contains('cx') && warned.length) problems.push('a cancelled row paints a tight change');
      if (row.classList.contains('tight') && !warned.length) problems.push('a tight row paints no tight dwell');
    }
    if (figureRights.length && Math.max(...figureRights) - Math.min(...figureRights) > 0.5) {
      problems.push('the figure column moves between rows: ' + figureRights.map(round).join(', '));
    }

    /* Journey detail. Its steps run on the row's own figure ladder, and its
       chrome is the tail, the freshness line and — only when the journey is
       neither cancelled nor already followed — the action rail. */
    if (document.querySelector('.detail-scroll')) {
      for (const step of document.querySelectorAll('[data-t="step"]')) {
        const stepBox = step.getBoundingClientRect();
        const stepFigure = px(getComputedStyle(step).getPropertyValue('--sy-fig'));
        const wanted = step.classList.contains('change') ? 82 : 72;
        if (stepBox.height < wanted - 0.5) {
          problems.push('a ' + step.dataset.step + ' step is ' + round(stepBox.height) + 'px, not ' + wanted);
        }
        const time = step.querySelector('.dtime');
        if (time) {
          const right = time.getBoundingClientRect().right;
          if (!near(right, stepBox.left + stepFigure)) {
            problems.push('a step time ends at ' + round(right) + ', not the figure column’s ' + (stepBox.left + stepFigure));
          }
          if (figureRights.length && !near(right, figureRights[0])) {
            problems.push('the step times and the promoted row use different figure columns: ' + round(right) + ' vs ' + round(figureRights[0]));
          }
          if (time.scrollWidth > time.clientWidth) problems.push('step time "' + time.textContent + '" overflows its column');
        }
        const label = step.querySelector('.dwhat span');
        if (label && label.scrollWidth > label.clientWidth) problems.push('step copy truncated: ' + label.textContent.trim());
      }

      // Exactly 18px of air between the summary and the heavy rule.
      const summary = document.querySelector('[data-summary]');
      const heavy = document.querySelector('.sy-mast .sy-hr');
      if (summary && heavy) {
        const gap = heavy.getBoundingClientRect().top - summary.getBoundingClientRect().bottom;
        if (!near(gap, 18)) problems.push('the summary sits ' + round(gap) + 'px above the heavy rule, not 18');
      }

      const rail = document.querySelector('.detail-rail[data-footer-rail]');
      if (rail) {
        const railBox = rail.getBoundingClientRect();
        if (!near(railBox.height, 66)) problems.push('the action rail is ' + round(railBox.height) + 'px, not 66');
        if (!near(railBox.bottom, innerHeight)) problems.push('the action rail is not flush with the frame');
        if (document.querySelector('.detail-tail.cx')) problems.push('a cancelled journey offers an action rail');
      }
      if (expect.rail === false && rail) problems.push('this journey carries an action rail it should not');
      if (expect.rail === true && !rail) problems.push('the action rail is missing');
    }

    for (const target of document.querySelectorAll('button,[role="button"]')) {
      const rect = target.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.height < 43.5) {
        problems.push('tap target under 44px: ' + (target.className || target.textContent.trim())
          + ' (' + round(rect.height) + 'px)');
      }
      const visibleHeight = Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top);
      if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
          && visibleHeight < 43.5) {
        problems.push('visible tap target is clipped by the viewport: '
          + (target.className || target.textContent.trim()) + ' (' + round(visibleHeight) + 'px reachable)');
      }
    }

    // Segment geometry is checked against the arithmetic carried in the DOM.
    // Platform boxes are overlays, so they never enter this sum.
    for (const bar of document.querySelectorAll('.sy-bar')) {
      const spec = bar.querySelector('.sy-spec');
      if (!spec) continue;
      const mins = spec.dataset.mins.split('/').map(Number);
      const total = mins.reduce((sum, value) => sum + value, 0);
      const segments = [...bar.querySelectorAll('.sy-r,.sy-g0')];
      const width = bar.getBoundingClientRect().width;
      segments.forEach((segment, index) => {
        const want = width * mins[index] / total;
        const got = segment.getBoundingClientRect().width;
        if (Math.abs(got - want) > 0.51) {
          problems.push('time axis is ' + Math.abs(got - want).toFixed(2) + 'px off scale');
        }
      });
    }

    /* In light, T1 and BMT keep their identity as a fill with paper numerals
       while the same code as bare text stays the darkened token. */
    if (matchMedia('(prefers-color-scheme: light)').matches) {
      const root = getComputedStyle(document.documentElement);
      for (const code of ['T1', 'BMT']) {
        const fill = root.getPropertyValue('--line-fill-' + code).trim().toUpperCase();
        const bare = root.getPropertyValue('--line-' + code).trim().toUpperCase();
        if (fill !== '#F99D1C') problems.push('light ' + code + ' fills ' + fill + ', not #F99D1C');
        if (bare !== '#A46204') problems.push('light ' + code + ' bare text is ' + bare + ', not #A46204');
      }
      for (const filled of document.querySelectorAll('.sy-cap[data-line-code],.sy-p[data-line-code],.dchip[data-line-code],.sy-rp[data-line-code]')) {
        if (filled.dataset.lineCode !== 'T1' && filled.dataset.lineCode !== 'BMT') continue;
        const paint = getComputedStyle(filled);
        if (paint.backgroundColor !== 'rgb(249, 157, 28)') {
          problems.push('a light ' + filled.dataset.lineCode + ' device is filled ' + paint.backgroundColor + ', not the approved yellow');
        }
        if (filled.textContent.trim() && paint.color !== 'rgb(250, 249, 245)') {
          problems.push('light ' + filled.dataset.lineCode + ' numerals are ' + paint.color + ', not paper');
        }
      }
    }

    const fromStation = document.querySelector('.hm-e.from .hm-stn');
    const toStation = document.querySelector('.hm-e.to .hm-stn');
    const fromTime = document.querySelector('.hm-e.from .hm-t');
    const toTime = document.querySelector('.hm-e.to .hm-t');
    if (fromStation && toStation
        && Math.abs(fromStation.getBoundingClientRect().top - toStation.getBoundingClientRect().top) > 0.1) {
      problems.push('home station names are vertically misaligned');
    }
    // Unequal clocks, so the shared edge is the baseline, not the box top. A
    // zero-height inline-block sits on the line box's baseline.
    const baselineOf = (el) => {
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      el.appendChild(probe);
      const y = probe.getBoundingClientRect().top;
      probe.remove();
      return y;
    };
    if (fromTime && toTime && Math.abs(baselineOf(fromTime) - baselineOf(toTime)) > 1.01) {
      problems.push('home endpoint times do not share a baseline');
    }

    /* An ordinary next service has no useful provenance word. Its empty slot
       must collapse, while LATE / TO CHANGE / TO GO / AGO still reserve the
       same labelled line above the journey bar. */
    const homeProvenance = document.querySelector('.hm-hd .hm-st');
    const homeNumber = document.querySelector('.hm-hd .hm-n');
    const homeEnds = document.querySelector('.hm-hd .hm-ends');
    const homeJourney = document.querySelector('.hm-hd .sy-j');
    if (homeProvenance && homeNumber && homeEnds && homeJourney) {
      const empty = !homeProvenance.textContent.trim();
      const hidden = getComputedStyle(homeProvenance).display === 'none';
      if (empty !== hidden) {
        problems.push(empty
          ? 'the empty home status line still reserves space'
          : 'the meaningful home status line is collapsed');
      }
      const statusBottom = empty ? -Infinity : homeProvenance.getBoundingClientRect().bottom;
      const contentBottom = Math.max(
        homeNumber.getBoundingClientRect().bottom,
        homeEnds.getBoundingClientRect().bottom,
        statusBottom
      );
      const gap = homeJourney.getBoundingClientRect().top - contentBottom;
      if (Math.abs(gap - 12) > 0.6) {
        problems.push('the home journey sits ' + round(gap) + 'px below its visible figure content, not 12');
      }
    }

    /* One status word for one journey: the header's top line and the focused
       saved-trip row cannot disagree, and each state declares what it says. */
    const topStatus = document.querySelector('[data-focus-status]');
    const rowStatus = document.querySelector('[data-row-status]');
    if (topStatus && rowStatus && topStatus.textContent.trim() !== rowStatus.textContent.trim()) {
      problems.push('the status reads "' + topStatus.textContent.trim() + '" in the top line and "'
        + rowStatus.textContent.trim() + '" in the saved-trip row');
    }
    if (expect.status !== undefined) {
      const said = topStatus ? topStatus.textContent.trim() : null;
      if (said !== expect.status) problems.push('the top line reads "' + said + '", not "' + expect.status + '"');
    }

    const nextService = document.querySelector('[data-next-service]');
    if (expect.next === null && nextService) problems.push('the next service is shown when it should be hidden');
    if (Array.isArray(expect.next)) {
      if (!nextService) {
        problems.push('the next service is missing');
      } else {
        const times = [...nextService.querySelectorAll('time')].map((node) => node.textContent.trim());
        const actual = [
          nextService.querySelector('.hm-next-label')?.textContent.trim() || '',
          (nextService.querySelector('.hm-next-count')?.textContent || '').replace(/\s+/g, ''),
          times[0] || '', times[1] || ''
        ];
        if (actual.join('/') !== expect.next.join('/')) {
          problems.push('the next service reads ' + actual.join('/') + ', not ' + expect.next.join('/'));
        }
      }
    }
    if (expect.nextLabel !== undefined) {
      const label = nextService?.querySelector('.hm-next-label')?.textContent.trim() || null;
      if (label !== expect.nextLabel) problems.push('the next service label is ' + label + ', not ' + expect.nextLabel);
    }
    const pinned = Boolean(document.querySelector('[data-pinned]'));
    if (expect.pinned !== undefined && pinned !== expect.pinned) {
      problems.push('the pinned indication is ' + (pinned ? 'shown' : 'missing'));
    }
    const homeMarker = Boolean(document.querySelector('.hm-hd .sy-mk'));
    if (expect.marker !== undefined && homeMarker !== expect.marker) {
      problems.push('the progress marker is ' + (homeMarker ? 'shown' : 'missing'));
    }
    const transferLabel = document.querySelector('.hm-hd [data-transfer-station]');
    if (expect.transferStation !== undefined) {
      const said = transferLabel ? transferLabel.textContent.trim() : null;
      if (said !== expect.transferStation) {
        problems.push('the transfer station reads ' + JSON.stringify(said) + ', not ' + JSON.stringify(expect.transferStation));
      }
    }
    if (transferLabel) {
      const stem = getComputedStyle(transferLabel, '::before');
      const hasStem = transferLabel.classList.contains('travelling') && stem.content !== 'none'
        && px(stem.height) > 0 && px(stem.width) > 0;
      if (expect.transferStem !== undefined && hasStem !== expect.transferStem) {
        problems.push('the transfer stem is ' + (hasStem ? 'shown' : 'missing'));
      }
      if (expect.transferMidpoint) {
        const bar = transferLabel.closest('.sy-bar');
        const labelBox = transferLabel.getBoundingClientRect();
        const barBox = bar && bar.getBoundingClientRect();
        const midpoint = Number(transferLabel.dataset.midpoint);
        const expectedX = barBox && Number.isFinite(midpoint) ? barBox.left + barBox.width * midpoint / 100 : null;
        if (expectedX === null || !near(labelBox.left + labelBox.width / 2, expectedX, 0.75)) {
          problems.push('the transfer station is not centred on its dwell midpoint');
        }
      }
      if (expect.transferInstructionGap !== undefined) {
        const instruction = document.querySelector('.hm-hd .hm-sign');
        const labelRange = document.createRange();
        labelRange.selectNodeContents(transferLabel);
        const labelText = [...labelRange.getClientRects()].at(-1);
        const gap = instruction && labelText ? instruction.getBoundingClientRect().top - labelText.bottom : null;
        if (gap === null || gap < expect.transferInstructionGap - 0.5) {
          problems.push('the transfer station/instruction gap is ' + (gap === null ? 'unmeasurable' : round(gap))
            + 'px, under ' + expect.transferInstructionGap + 'px');
        }
      }
    } else if (expect.transferStem === true || expect.transferMidpoint || expect.transferInstructionGap !== undefined) {
      problems.push('the transfer station needed for geometry checks is missing');
    }
    if (expect.platformSeparator) {
      const pins = [...document.querySelectorAll('.hm-hd .sy-p')];
      const boarding = pins.filter((pin) => pin.classList.contains('b'));
      const alighting = pins.filter((pin) => pin.classList.contains('a'));
      if (!boarding.length || !alighting.length) {
        problems.push('the transfer platform pair is incomplete');
      }
      if (pins.some((pin) => px(getComputedStyle(pin).borderLeftWidth) !== 0)) {
        problems.push('a transfer platform has an artificial border separator');
      }
      if (pins.some((pin) => getComputedStyle(pin).boxShadow !== 'none')) {
        problems.push('a transfer platform has an artificial shadow mask');
      }
      for (const platform of pins) {
        const index = Number(platform.dataset.transferIndex);
        const arriving = platform.dataset.pin === 'a';
        const ride = document.querySelector('.hm-hd .leg-' + (arriving ? index : index + 1));
        if (!ride || !platform.getClientRects().length) continue;
        const paint = ride.querySelector('.sy-rp');
        if (!paint) {
          problems.push('a logical ride segment has no independent paint layer');
          continue;
        }
        const rideBox = ride.getBoundingClientRect();
        const platformBox = platform.getBoundingClientRect();
        const style = getComputedStyle(platform);
        const radius = Math.min(platformBox.width / 2,
          px(arriving ? style.borderTopRightRadius : style.borderTopLeftRadius));
        const interiorStart = platformBox.left + radius;
        const interiorEnd = platformBox.right - radius;
        const expected = arriving
          ? rideBox.right - Math.max(interiorStart, Math.min(interiorEnd, rideBox.right))
          : Math.max(interiorStart, Math.min(interiorEnd, rideBox.left)) - rideBox.left;
        const paintStyle = getComputedStyle(paint);
        const actual = px(arriving ? paintStyle.right : paintStyle.left);
        if (!near(actual, expected)) {
          problems.push((arriving ? 'arriving' : 'departing') + ' ride paint inset is '
            + round(actual) + 'px, not ' + round(expected) + 'px from the measured platform frame');
        }
      }
    }
    if (expect.sideBySideSpines) {
      const lines = [...document.querySelectorAll('[data-t="trip-list"] .tripr .hm-spine i')];
      if (lines.length < 2) {
        problems.push('the saved-trip service spines are missing');
      } else {
        const first = lines[0].getBoundingClientRect();
        const second = lines[1].getBoundingClientRect();
        const verticalOverlap = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        if (second.left <= first.right || verticalOverlap <= 1) {
          problems.push('the saved-trip service spines are stacked instead of side by side');
        }
      }
    }
    if (expect.departure !== undefined) {
      const said = document.querySelector('.hm-e.from .hm-t')?.textContent.trim() || null;
      if (said !== expect.departure) problems.push('the lead departure is ' + said + ', not ' + expect.departure);
    }
    if (Array.isArray(expect.boardHeader)) {
      const endpoints = [...document.querySelectorAll('.sy-h1 > b')];
      const values = endpoints.map((node) => node.textContent.trim());
      if (values.join('/') !== expect.boardHeader.join('/')) {
        problems.push('board endpoints are ' + values.join('/') + ', not ' + expect.boardHeader.join('/'));
      }
      if (endpoints.length === 2) {
        const widths = endpoints.map((node) => node.getBoundingClientRect().width);
        if (!near(widths[0], widths[1])) {
          problems.push('board endpoint tracks are ' + widths.map(round).join('/') + 'px, not equal');
        }
        if (expect.equalHeaderLines) {
          const lineCount = (node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return new Set([...range.getClientRects()].map((rect) => round(rect.top))).size;
          };
          const lines = endpoints.map(lineCount);
          if (lines[0] !== lines[1]) {
            problems.push('board endpoints use ' + lines.join('/') + ' lines, not the same count');
          }
        }
        const textBounds = endpoints.map((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          const boxes = [...range.getClientRects()];
          return {
            left: Math.min(...boxes.map((box) => box.left)),
            right: Math.max(...boxes.map((box) => box.right)),
            top: Math.min(...boxes.map((box) => box.top)),
            bottom: Math.max(...boxes.map((box) => box.bottom))
          };
        });
        const sharesLine = Math.min(textBounds[0].bottom, textBounds[1].bottom)
          > Math.max(textBounds[0].top, textBounds[1].top);
        if (sharesLine && textBounds[1].left - textBounds[0].right < 8) {
          problems.push('board endpoint text has no readable connector gap');
        }
      }
    }
    if (Array.isArray(expect.caps)) {
      const caps = [...document.querySelectorAll('.sy-cap')].map((node) => node.textContent.trim());
      if (caps.join('/') !== expect.caps.join('/')) {
        problems.push('boarding caps are ' + caps.join('/') + ', not ' + expect.caps.join('/'));
      }
    }
    const ferryLocations = [...document.querySelectorAll('[data-ferry-location]')];
    for (const location of ferryLocations) {
      const box = location.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(location);
      const textBoxes = [...range.getClientRects()];
      const anchor = location.closest('.sy-p');
      if (!location.dataset.role || !location.dataset.stop) {
        problems.push('a visible ferry location has no stop/role association: ' + location.textContent.trim());
      }
      if (!location.dataset.ferryLocation) {
        problems.push('a visible ferry location has no full raw label: ' + location.textContent.trim());
      }
      const isTransfer = location.dataset.role === 'alight' || location.dataset.role === 'board';
      const fontSize = px(getComputedStyle(location).fontSize);
      if (isTransfer && !location.classList.contains('dchip')
        ? fontSize < 14 - 0.1
        : !near(fontSize, 14, 0.1)) {
        problems.push('ferry location type is ' + getComputedStyle(location).fontSize
          + (isTransfer ? ', below the 14px floor' : ', not 14px'));
      }
      if (box.width < 1 || box.height < 1 || box.left < -0.5 || box.right > innerWidth + 0.5
          || textBoxes.some((textBox) => textBox.left < box.left - 0.5 || textBox.right > box.right + 0.5
            || textBox.top < box.top - 0.5 || textBox.bottom > box.bottom + 0.5)) {
        problems.push('ferry location is clipped or outside the frame: ' + location.textContent.trim());
      }
      for (let parent = location.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        const parentBox = parent.getBoundingClientRect();
        if (overflow !== 'visible' && textBoxes.some((textBox) =>
          textBox.left < parentBox.left - 0.5 || textBox.right > parentBox.right + 0.5)) {
          problems.push('ferry location is clipped by its container: ' + location.textContent.trim());
          break;
        }
      }
      if (anchor) {
        const marker = anchor.getBoundingClientRect();
        const markerX = marker.left + marker.width / 2;
        if (markerX < box.left - 0.5 || markerX > box.right + 0.5) {
          problems.push('ferry location moved off its time-axis marker: ' + location.textContent.trim());
        }
      }
    }
    if (Array.isArray(expect.ferryLocations)) {
      const actual = ferryLocations.map((node) => [
        node.dataset.role, node.dataset.stop, node.dataset.ferryLocation, node.textContent.trim()
      ].join('|'));
      if (actual.join('/') !== expect.ferryLocations.join('/')) {
        problems.push('visible ferry locations are ' + actual.join('/')
          + ', not ' + expect.ferryLocations.join('/'));
      }
    }
    if (Array.isArray(expect.boardingLocations)) {
      const actual = [...document.querySelectorAll('[data-boarding-location]')].map((node) => {
        const box = node.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(node);
        const textBoxes = [...range.getClientRects()];
        if (box.width < 1 || box.height < 1 || textBoxes.length === 0
            || textBoxes.some((textBox) => textBox.left < box.left - 0.5 || textBox.right > box.right + 0.5
              || textBox.top < box.top - 0.5 || textBox.bottom > box.bottom + 0.5)) {
          problems.push('the full boarding location is not visibly contained: ' + node.dataset.boardingLocation);
        }
        if (!node.textContent.includes(node.dataset.boardingLocation)) {
          problems.push('the full boarding location is not visible: ' + node.dataset.boardingLocation);
        }
        return node.dataset.boardingLocation;
      });
      if (actual.join('/') !== expect.boardingLocations.join('/')) {
        problems.push('secondary boarding locations are ' + actual.join('/')
          + ', not ' + expect.boardingLocations.join('/'));
      }
    }
    if (Array.isArray(expect.ferryCodes)) {
      const codes = new Set(expect.ferryCodes);
      for (const device of document.querySelectorAll('.sy-cap[data-line-code],.sy-p[data-line-code],.dchip[data-line-code]')) {
        if (!codes.has(device.dataset.lineCode) || !device.textContent.trim()) continue;
        if (device.classList.contains('sy-p') && device.querySelector('[data-ferry-location]')) continue;
        if (!device.hasAttribute('data-ferry-location')) {
          problems.push('ferry device still uses a non-location label: ' + device.textContent.trim());
        }
      }
    }
    if (Array.isArray(expect.copy)) {
      const visible = document.body.textContent;
      for (const copy of expect.copy) {
        if (!visible.includes(copy)) problems.push('expected copy is missing: "' + copy + '"');
      }
    }
    if (Array.isArray(expect.notCopy)) {
      const visible = document.body.textContent;
      for (const copy of expect.notCopy) {
        if (visible.includes(copy)) problems.push('unexpected copy is present: "' + copy + '"');
      }
    }
    if (Array.isArray(expect.detailChips)) {
      const chips = [...document.querySelectorAll('.dchip')].map((node) => node.textContent.trim());
      if (chips.join('/') !== expect.detailChips.join('/')) {
        problems.push('detail chips are ' + chips.join('/') + ', not ' + expect.detailChips.join('/'));
      }
    }
    if (Array.isArray(expect.aria)) {
      const labels = [...document.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label'));
      for (const label of expect.aria) {
        if (!labels.includes(label)) problems.push('expected accessible label is missing: "' + label + '"');
      }
    }
    if (Array.isArray(expect.accessibleCopy)) {
      const labels = [...document.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label')).join(' ');
      for (const copy of expect.accessibleCopy) {
        if (!labels.includes(copy)) problems.push('accessible copy is missing: "' + copy + '"');
      }
    }
    if (Array.isArray(expect.ferryCodes)) {
      const root = getComputedStyle(document.documentElement);
      const ferryFill = root.getPropertyValue('--line-fill-FERRY').trim();
      const ferryProbe = document.createElement('span');
      ferryProbe.style.cssText = 'position:absolute;background:' + ferryFill;
      document.body.appendChild(ferryProbe);
      const expectedFill = getComputedStyle(ferryProbe).backgroundColor;
      ferryProbe.remove();
      for (const code of expect.ferryCodes) {
        const devices = [...document.querySelectorAll('[data-line-code="' + code + '"]')]
          .filter((node) => getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)');
        if (!devices.length) {
          problems.push('no painted ferry device for ' + code);
          continue;
        }
        for (const device of devices) {
          if (getComputedStyle(device).backgroundColor !== expectedFill) {
            problems.push(code + ' device is ' + getComputedStyle(device).backgroundColor
              + ', not ferry green ' + expectedFill);
          }
        }
      }
    }
    /* Smart-header contrast thresholds: docs/contracts/ui.md, calibration
       measurements. Composite translucent ink against its painted ground. */
    const light = matchMedia('(prefers-color-scheme: light)').matches;
    const channels = (value) => (String(value).match(/[\\d.]+/g) || []).map(Number);
    const luminance = (rgb) => {
      const linear = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
    };
    // The ink is drawn on whatever opaque paint is nearest above it.
    const groundOf = (el) => {
      for (let node = el; node; node = node.parentElement) {
        const paint = channels(getComputedStyle(node).backgroundColor);
        if (paint.length < 4 || paint[3] > 0) return paint;
      }
      return light ? [255, 255, 255] : [0, 0, 0];
    };
    // The ink tokens are translucent by design (--ink-2, --ink-3), so the ink
    // that reaches the eye is the composite, not the declared colour.
    const contrastOf = (el) => {
      const ink = channels(getComputedStyle(el).color);
      const ground = groundOf(el);
      const alpha = ink.length > 3 ? ink[3] : 1;
      const painted = [0, 1, 2].map((i) => alpha * ink[i] + (1 - alpha) * ground[i]);
      const [bright, dim] = [luminance(painted), luminance(ground)].sort((a, b) => b - a);
      return (bright + 0.05) / (dim + 0.05);
    };
    for (const [selector, ratios] of [
      ['.hm-new', [4.3, 4.83]], ['[data-strip] .q', [8, 8.13]], ['[data-strip] button', [17.6, 17.8]]
    ]) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const want = ratios[light ? 1 : 0];
      const got = contrastOf(el);
      // A tenth of slack: the reference measures the token against --bg, and
      // the row and the strip are painted on the panel.
      if (got < want - 0.1) {
        problems.push(selector + ' is ' + round(got) + ':1 against its ground, under the UI contract’s ' + want);
      }
    }

    /* A3 is below the rule; A2 uses the receipt slot. */
    const strip = document.querySelector('[data-strip]');
    if (expect.strip === true && !strip) problems.push('the inferred strip is missing');
    if (expect.strip === false && strip) problems.push('the inferred strip is shown on a header that did not guess');
    if (strip) {
      const stripBox = strip.getBoundingClientRect();
      const slot = strip.classList.contains('hm-rec-strip') ? 'receipt' : 'below';
      if (expect.stripSlot && slot !== expect.stripSlot) {
        problems.push('the inferred control is in the ' + slot + ' slot, not ' + expect.stripSlot);
      }
      const heavyRule = document.querySelector('.hm-rule');
      const trips = document.querySelector('[data-t="trip-list"]');
      if (slot === 'below') {
        if (!near(stripBox.height, 49)) problems.push('the strip is ' + round(stripBox.height) + 'px, not 49');
        if (heavyRule && stripBox.top < heavyRule.getBoundingClientRect().bottom - 0.5) {
          problems.push('the strip is not under the heavy rule');
        }
        if (trips && stripBox.bottom > trips.getBoundingClientRect().top + 0.5) {
          problems.push('the strip is not above the trip list');
        }
      } else {
        const question = strip.querySelector('.q');
        const action = strip.querySelector('button');
        if (!strip.closest('.hm-hd')) problems.push('the A2 control is outside the receipt slot');
        if (!question || question.textContent.trim() !== 'Going somewhere else?') {
          problems.push('the A2 question copy changed');
        }
        if (!action || action.textContent.trim() !== 'Change') problems.push('the A2 action copy changed');
        if (question && getComputedStyle(question).whiteSpace !== 'nowrap') {
          problems.push('the A2 question can wrap');
        }
        if (heavyRule && stripBox.bottom > heavyRule.getBoundingClientRect().top + 0.5) {
          problems.push('the A2 control crosses the heavy rule');
        }
        if (question && action
          && Math.abs(question.getBoundingClientRect().top - action.getBoundingClientRect().top) > 14) {
          problems.push('the A2 question and action do not share one line');
        }
      }
    }

    /* The heavy rule's own place in the header, which is what chose A3 over
       A2. It moves with the frame, so it is only asserted at the comps width. */
    if (expect.ruleTop !== undefined && innerWidth === 390) {
      const heavy = document.querySelector('.hm-rule');
      const top = heavy ? heavy.getBoundingClientRect().top : null;
      if (top === null || Math.abs(top - expect.ruleTop) > 1) {
        problems.push('the heavy rule is at ' + (top === null ? 'nowhere' : round(top)) + ', not ' + expect.ruleTop);
      }
    }

    // Our own copy, on the screen that says what the app decided.
    if (expect.receipt !== undefined) {
      const rec = document.querySelector('.hm-rec');
      const said = rec ? rec.textContent.trim() : null;
      if (said !== expect.receipt) problems.push('the receipt reads ' + JSON.stringify(said) + ', not ' + JSON.stringify(expect.receipt));
    }
    if (expect.sub !== undefined) {
      const sub = document.querySelector('.tripr.shown .hm-sub, .tripr.focused .hm-sub');
      const said = sub ? sub.textContent.trim() : null;
      if (said !== expect.sub) problems.push('the shown row’s sub line reads ' + JSON.stringify(said) + ', not ' + JSON.stringify(expect.sub));
    }

    // Metadata may ellipsise, but station names, the strip and its new-row mark may not.
    const markedSub = document.querySelector('.hm-new')?.closest('.hm-sub');
    const ownCopy = [...document.querySelectorAll('.hm-stn,.hm-nm,[data-strip] button')];
    if (markedSub) ownCopy.push(markedSub);
    for (const name of ownCopy) {
      if (name.scrollWidth > name.clientWidth + 0.5) {
        problems.push('"' + name.textContent.trim() + '" is truncated: ' + name.scrollWidth + ' > ' + name.clientWidth);
      }
    }

    // LIVE says the data is live and nothing else; lateness never colours it.
    const dot = document.querySelector('.hm-fresh .pulse');
    const freshness = document.querySelector('.hm-fresh .lbl');
    if (dot && freshness && freshness.textContent.trim() === 'Live') {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;color:var(--live)';
      document.body.appendChild(probe);
      const live = getComputedStyle(probe).color;
      probe.remove();
      const painted = getComputedStyle(dot).backgroundColor;
      if (painted !== live) {
        problems.push('the LIVE dot is ' + painted + ', not ' + live
          + (topStatus && topStatus.dataset.late === 'true' ? ' (the journey is late)' : ''));
      }
    }
    if (document.querySelector('.rail')) problems.push('deleted board focus strip is still rendered');

    const timeline = document.querySelector('.sy-tl');
    const futureRows = timeline ? [...timeline.querySelectorAll('.sy-fwd > .sy-row')] : [];
    if (timeline && futureRows.length === 6 && !timeline.querySelector(':scope > .sy-row')) {
      const heights = futureRows.map((row) => row.getBoundingClientRect().height);
      if (heights.some((height) => height < 95.5)) {
        problems.push('a future service is shorter than its 96px base slot');
      }
      const signatures = new Map();
      futureRows.forEach((row, index) => {
        const rowTop = row.getBoundingClientRect().top;
        const labels = [...row.querySelectorAll('[data-transfer-station]')];
        const lines = labels.map((label) => {
          const box = label.getBoundingClientRect();
          return round(box.top - rowTop) + 'x' + round(box.height);
        }).join(',');
        const signature = labels.length + ':' + lines;
        const previous = signatures.get(signature);
        if (previous !== undefined && !near(heights[index], previous, 0.2)) {
          problems.push('equivalent future services do not use equal whole slots');
        }
        signatures.set(signature, heights[index]);
      });
      if (futureRows.some((row) => row.scrollHeight > row.clientHeight + 1)) {
        problems.push('a future service clips content inside its expanded slot');
      }
    }
    if (${JSON.stringify(state.name)} === 'past-register' && timeline) {
      const anchor = timeline.querySelector('[data-t="now"]');
      if (anchor && Math.abs(timeline.scrollTop - anchor.offsetTop) > 1) {
        problems.push('board with past pages did not land at now');
      }
    }
    if (${JSON.stringify(state.name)} === 'focus-returns-home' && location.hash !== '#/') {
      problems.push('focusing a journey did not return home');
    }
    if (${JSON.stringify(state.name)} === 'reverse-real-platforms') {
      const platforms = [...document.querySelectorAll('.hm-hd .sy-p')].map((node) => node.textContent.trim());
      if (platforms.join('/') !== '4/1') problems.push('real reverse transfer platforms did not render: ' + platforms.join('/'));
    }
    const ftr = document.querySelector('[data-t="footer"]');
    if (ftr && ftr.scrollWidth > ftr.clientWidth) problems.push('footer truncated');
    const detailTop = document.querySelector('.detail-top');
    if (ftr && detailTop) {
      const freshBox = ftr.getBoundingClientRect();
      const topBox = detailTop.getBoundingClientRect();
      const backBox = detailTop.querySelector('.sy-home')?.getBoundingClientRect();
      const kickerBox = document.querySelector('.detail-kicker')?.getBoundingClientRect();
      const overlapsBack = backBox && freshBox.left < backBox.right && freshBox.right > backBox.left
        && freshBox.top < backBox.bottom && freshBox.bottom > backBox.top;
      if (!detailTop.contains(ftr)) problems.push('detail freshness is outside the masthead');
      if (!near(freshBox.right, topBox.right)) problems.push('detail freshness is not right aligned');
      if (overlapsBack) problems.push('detail freshness overlaps the back control');
      if (kickerBox && freshBox.bottom > kickerBox.top + 0.5) problems.push('detail freshness overlaps the route heading');
    }
    // Wherever it ends up, the freshness line is in the frame.
    if (ftr && ftr.getBoundingClientRect().bottom > innerHeight + 0.5) {
      problems.push('the footer is below the frame');
    }

    /* Every service is reachable. The board fills the frame, and when the frame
       is too short for six three-line rows it has to SCROLL — a frame that
       simply clips the sixth service is how the owner's phone lost it on
       2026-09-01, and no screenshot showed it, because a clipped row looks like
       a row that is nearly on screen.

       A scrolling region and the chrome beneath it: nothing in the region may
       be unreachable, the last thing in it must be whole at the end of the
       scroll, and the chrome never paints over it or hangs below the frame. */
    const scrollRegion = (sel, itemSel, chromeEl, what) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const box = el.getBoundingClientRect();
      const items = [...el.querySelectorAll(itemSel)];
      const beyond = el.scrollHeight - el.clientHeight;
      const scrolls = /auto|scroll/.test(getComputedStyle(el).overflowY);
      if (beyond > 1 && !scrolls) {
        problems.push(beyond + 'px of ' + what + ' is cut off with no way to scroll to it');
      }
      const last = items[items.length - 1];
      if (last && el.scrollTop >= beyond - 1) {
        const over = Math.round(last.getBoundingClientRect().bottom - box.bottom);
        if (over > 1) problems.push('the last ' + what + ' item is still ' + over + 'px short of visible at the end of the scroll');
      }
      if (chromeEl) {
        const chrome = chromeEl.getBoundingClientRect();
        if (box.bottom > chrome.top + 0.5) problems.push('the ' + what + ' chrome is painted over its content');
        if (chrome.bottom > innerHeight + 0.5) problems.push('the ' + what + ' chrome is below the frame');
      }
    };

    scrollRegion('.sy-tl', '[data-t="row"]', null, 'board');
    scrollRegion('.detail-scroll', '[data-t="step"]', document.querySelector('.detail-tail'), 'journey');
    scrollRegion('[data-t="trip-list"]', '.tripr', document.querySelector('.hm-bar, .hm-ask'), 'trip list');
    if (problems.length) console.error('INVARIANT ' + ${JSON.stringify(state.name)} + ': ' + problems.join('; '));
  } catch (e) { console.error('invariant check failed: ' + e.message); }

  const expectedEvents = ${JSON.stringify(state.events)};
  const actualEvents = t.analytics.events.map((event) => event.t);
  if (JSON.stringify(actualEvents) !== JSON.stringify(expectedEvents)) {
    throw new Error('analytics ledger for ' + ${JSON.stringify(state.name)} + ' is '
      + JSON.stringify(actualEvents) + ', not ' + JSON.stringify(expectedEvents));
  }
  if (localStorage.getItem('trains.analytics.v1') !== null) {
    throw new Error('analytics queue exists on the local origin');
  }
  if (analyticsRequests.length || analyticsBeacons.length) {
    throw new Error('analytics transport ran on the local origin: fetch=' + analyticsRequests.length
      + ' beacon=' + analyticsBeacons.length);
  }

  ${state.probe ? `try {
    // Awaited, so a probe that drives the UI can wait for a route change.
    console.warn('PROBE ' + ${JSON.stringify(state.name)} + ' ' + JSON.stringify(await (async () => { ${state.probe} })()));
  } catch (e) { console.error('PROBE failed: ' + e.message); }` : ''}
})()`;
}

/* --- running ------------------------------------------------------------- */

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  let url = DEFAULT_URL;
  let out = DEFAULT_OUT;
  let probe = null;
  let sizeOverride = null;
  let prefix = '';
  const media = [];
  const wanted = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url') url = argv[++i];
    else if (argv[i] === '--out') out = path.resolve(argv[++i]);
    // Measure the state you are looking at, in the same drive that shoots it:
    // --probe "return {w: document.querySelector('.dest').scrollWidth}"
    else if (argv[i] === '--probe') probe = argv[++i];
    // A probe that drives a flow is a script, not a flag: --probe-file takes
    // the same JS from a file, which is the only way to write more than one
    // statement of it without fighting the shell.
    else if (argv[i] === '--probe-file') probe = fs.readFileSync(argv[++i], 'utf8');
    // Any state at any viewport: --size 360x800 is the narrow phone the
    // 390px design has to survive.
    else if (argv[i] === '--size') sizeOverride = argv[++i];
    // Passed straight through: --media prefers-reduced-motion:reduce
    else if (argv[i] === '--media') media.push(argv[++i]);
    // A whole sweep shot under an emulated media feature has to land beside the
    // default one without overwriting it: --prefix light- names the set.
    else if (argv[i] === '--prefix') prefix = argv[++i];
    else if (argv[i] === '--list') wanted.push('--list');
    else wanted.push(argv[i]);
  }

  const all = await states();
  if (wanted.includes('--list')) {
    console.log(all.map((s) => s.name).join('\n'));
    return;
  }

  const chosen = wanted.length ? all.filter((s) => wanted.includes(s.name)) : all;
  const missing = wanted.filter((w) => !all.some((s) => s.name === w));
  if (missing.length) throw new Error('unknown state(s): ' + missing.join(', '));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trains-states-'));
  const env = { ...process.env, TZ: 'Australia/Sydney' };
  fs.mkdirSync(out, { recursive: true });

  try {
    for (const state of chosen) {
      if (probe) state.probe = probe;
      const size = sizeOverride || state.size || '390x844';
      const seedFile = path.join(tmp, state.name + '.json');
      fs.writeFileSync(seedFile, JSON.stringify(state.seed));
      const args = [
        path.join(ROOT, 'tools/screenshot.js'), url,
        path.join(out, `${prefix}${state.name}-${size}.png`),
        '--size', size, '--dsf', '2', '--wait', '600',
        '--seed', seedFile, '--eval', pageScript(state)
      ];
      if (state.desktop) args.push('--desktop');
      if (state.geo) {
        args.push('--geo', [state.geo.lat, state.geo.lon, state.geo.speed]
          .filter(Number.isFinite).join(','));
      }
      const permission = state.permission || (state.geo ? 'granted' : 'denied');
      if (permission) args.push('--geo-permission', permission);
      for (const feature of media) args.push('--media', feature);
      await run(process.execPath, args, env);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
