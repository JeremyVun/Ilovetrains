/* Drive the REAL client into each board state and shoot it.
 *
 *   node tools/shoot-states.js                 # every state, into docs/.../shots
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
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'docs/backlog/v1-core-loop/shots');
const DEFAULT_URL = 'http://localhost:8092/';

/* The exemplar's moment: 22:45 on Monday 31 August 2026, the clock the
   comps were drawn at (comps/shots/b-editorial-390x844.png). */
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
  to: { id: '213910', name: 'Epping Station' },
  createdAt: '2026-08-10T08:00:00+10:00'
};
/* The transfer corridor: the journey-focus round's own data, so the detail
   shots and the exemplar (comps/shots/a1-ledger-390x844-hero.png) describe the
   same six real T9 → T4 services. */
const TRIP_TRANSFER = {
  id: 'trip-rhodes-bondi',
  from: { id: '213820', name: 'Rhodes Station' },
  to: { id: '200080', name: 'Bondi Junction Station' },
  createdAt: '2026-08-01T08:00:00+10:00'
};
const TRIP_LONG = {
  id: 'trip-olympicpark-mtvictoria',
  from: { id: '206010', name: 'Sydney Olympic Park Station' },
  to: { id: '253030', name: 'Mount Victoria Station' },
  createdAt: '2026-08-01T08:00:00+10:00'
};

/* Tap the row a state is about. The whole row is the target (frozen IA), so
   this drives the real affordance rather than the route — a detail shot is
   also the proof that the board opens it. */
const OPEN_ROW = (i = 0) => `
  document.querySelectorAll('[data-t="row"]')[${i}].click();
  await sleep(140);
`;

/** History that makes `predict` choose TRIP forward at 22:45 on a weekday. */
function history(tripId = TRIP.id) {
  return [
    { tripId, direction: 'forward', t: '2026-08-28T22:40:00+10:00' },
    { tripId, direction: 'forward', t: '2026-08-27T22:50:00+10:00' },
    { tripId, direction: 'forward', t: '2026-08-26T22:35:00+10:00' }
  ];
}

function doc({ trips = [TRIP], body = null, fetchedAt = NOW_ISO, hist = history(), focus = null } = {}) {
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
  return d;
}

/* --- the state list ------------------------------------------------------ */

async function states() {
  const fx = await import(pathToFileURL(path.join(ROOT, 'web/test/fixture.js')).href);
  const {
    departuresBody, baseJourneys, journey, delay, cancel,
    transferBody, transferJourneys, delayLeg, cancelLeg,
    TRANSFER_NOW, TRANSFER_DEPARTED_NOW
  } = fx;

  const board = (name, body, opts = {}) => ({
    name,
    seed: doc({ body, trips: opts.trips || [TRIP] }),
    now: opts.now || NOW,
    body,
    route: '#/board',
    ...opts
  });

  const TRANSFER_AT = '2026-09-01T09:21:00+10:00';

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
      after: opts.after
    };
  };

  const home = (name, journeys, opts = {}) => {
    const body = transferBody({ journeys, generatedAt: opts.generatedAt || TRANSFER_AT });
    return {
      name,
      seed: doc({
        trips: opts.trips || [TRIP_TRANSFER],
        body,
        hist: opts.hist || [],
        fetchedAt: opts.generatedAt || TRANSFER_AT,
        focus: opts.focus || null
      }),
      now: opts.now || TRANSFER_NOW,
      body,
      route: '#/',
      after: opts.after
    };
  };

  const tighten = (journeys) => { delayLeg(journeys[0], 0, 5); return journeys; };
  const breakLeg = (journeys) => { cancelLeg(journeys[0], 1); return journeys; };

  /* Sydney Olympic Park → Strathfield → Mount Victoria: a real journey shape
     carrying the longest station names and the longest headsign the board has
     ever had to print. */
  const longBody = () => {
    const j = transferJourneys()[0];
    Object.assign(j.legDetail[0], {
      line: { name: 'T7', mode: 'train' },
      headsign: 'Central via Lidcombe',
      from: { id: '206010', name: 'Sydney Olympic Park Station', platform: 'Platform 1' },
      to: { id: '206020', name: 'Strathfield Station', platform: 'Platform 4' }
    });
    Object.assign(j.legDetail[1], {
      line: { name: 'BMT', mode: 'train' },
      headsign: 'Mount Victoria via Parramatta and Katoomba',
      from: { id: '206020', name: 'Strathfield Station', platform: 'Platform 6' },
      to: { id: '253030', name: 'Mount Victoria Station', platform: 'Platform 2' }
    });
    j.line = { name: 'T7', mode: 'train' };
    j.destinationHeadsign = 'Central via Lidcombe';
    return {
      from: { id: '206010', name: 'Sydney Olympic Park Station' },
      to: { id: '253030', name: 'Mount Victoria Station' },
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
  const pastBody = departuresBody({
    generatedAt: NOW_ISO,
    journeys: baseJourneys().map((value) => shiftJourney(value, -75))
  });
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
        from: { id: '200080', name: 'Bondi Junction Station', platform: 'Platform 2' },
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
    from: { id: '200080', name: 'Bondi Junction Station' },
    to: { id: '213820', name: 'Rhodes Station' },
    generatedAt: '2026-09-01T10:11:00+10:00',
    journeys: [reverseJourney]
  };

  /* The late-night board, which is what Sydney actually shows between the last
     service and the first: waits of three digits, no realtime control on any
     of them. Found live 2026-09-01 at 00:47 — every seeded state until then
     had a one- or two-digit figure. */
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

  return [
    home('home-before', transferJourneys()),
    home('home-delayed', tighten(transferJourneys())),
    home('home-cancelled', (() => {
      const value = transferJourneys();
      value[0].cancelled = true;
      value[0].legDetail[0].cancelled = true;
      return value;
    })()),
    home('home-change', transferJourneys(), {
      now: Date.parse('2026-09-01T09:53:00+10:00'),
      generatedAt: '2026-09-01T09:53:00+10:00',
      focus: transferJourneys()[0]
    }),
    home('home-final', transferJourneys(), {
      now: Date.parse('2026-09-01T10:01:00+10:00'),
      generatedAt: '2026-09-01T10:01:00+10:00',
      focus: transferJourneys()[0]
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

    // Four hours old: the figures go, the clock times stay, the board dims.
    board('stale', departuresBody({ generatedAt: '2026-08-31T18:45:00+10:00' })),
    // Twenty minutes past its generation: two services have left, so the list
    // closes upward and the four that remain distribute down the frame.
    board('stale-departed', departuresBody(), { now: Date.parse('2026-08-31T23:05:00+10:00') }),

    // Caught mid-dissolve: the 22:48 service has just left, its row is fading
    // and the list is about to close upward (~240ms, docs/STYLES.md).
    board('dissolve', departuresBody(), {
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
    { name: 'cold-offline', seed: doc({ trips: [TRIP] }), now: NOW, body: null, offline: true },
    // No cache and the first call still in the post: a cold station pair is one
    // to two seconds of TfNSW, and this line is the whole screen for all of it.
    { name: 'cold-loading', seed: doc({ trips: [TRIP] }), now: NOW, body: null },

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
    transfer('detail-hero', transferJourneys(), { after: OPEN_ROW(0) }),

    // The first leg five minutes late, so the printed 7-minute change is
    // really 2. Two times, two windows, and no claim about whether you make it.
    transfer('detail-tight', tighten(transferJourneys()), { after: OPEN_ROW(0) }),

    // The second leg cancelled: the journey is cancelled because ANY leg is,
    // and the detail view is the only screen that says WHICH.
    transfer('detail-cancelled', breakLeg(transferJourneys()), { after: OPEN_ROW(0) }),

    // The longest real strings on any of these corridors: nothing abbreviated,
    // the third line allowed to wrap rather than truncate (the detail view's
    // exemption from the three-line invariant, owner ruling 2026-09-01).
    {
      name: 'detail-long',
      seed: doc({ trips: [TRIP_LONG], body: longBody(), fetchedAt: TRANSFER_AT, hist: [] }),
      now: TRANSFER_NOW,
      body: longBody(),
      after: OPEN_ROW(0)
    },

    transfer('focus-returns-home', transferJourneys(), {
      after: `${OPEN_ROW(0)} document.querySelector('[data-act="focus"]').click(); await sleep(160);`
    }),

    home('reverse-real-platforms', transferJourneys(), {
      now: Date.parse('2026-09-01T10:11:00+10:00'),
      generatedAt: '2026-09-01T10:11:00+10:00',
      focus: transferJourneys()[0],
      after: `window.fetch = async () => new Response(${JSON.stringify(JSON.stringify(reverseBody))}, { headers: { 'Content-Type': 'application/json' } }); document.querySelector('[data-act="way-back"]').click(); await sleep(220);`
    }),

    // A focus never adds a board strip: the board remains exactly six slots.
    transfer('board-focused', transferJourneys(), { focus: transferJourneys()[0] }),

    // ...and the proof, driven to the end of the board.
    transfer('board-focused-scrolled', transferJourneys(), {
      focus: transferJourneys()[0], after: SCROLL_TO_END
    }),

    // 09:47: the focused journey has left the board and the snapshot carries
    // it. B3's departed copy, and the masthead's second kicker.
    transfer('board-focused-departed', transferJourneys().slice(2), {
      focus: transferJourneys()[0],
      now: TRANSFER_DEPARTED_NOW,
      generatedAt: '2026-09-01T09:47:00+10:00'
    }),

    { name: 'first-run', seed: doc({ trips: [], hist: [] }), now: NOW, route: '#/setup' },
    {
      name: 'first-run-search',
      seed: doc({ trips: [], hist: [] }),
      now: NOW,
      route: '#/setup',
      type: { role: 'from', text: 'central' }
    },
    // Two characters: too short to ask TfNSW anything worth waiting for, so the
    // screen asks for another letter instead of claiming there is no station.
    {
      name: 'first-run-short-query',
      seed: doc({ trips: [], hist: [] }),
      now: NOW,
      route: '#/setup',
      type: { role: 'from', text: 'ce', freeze: true }
    },
    // The call is away and nothing has come back yet — up to a second and a
    // half of it. The network stays frozen so this state holds still.
    {
      name: 'first-run-searching',
      seed: doc({ trips: [], hist: [] }),
      now: NOW,
      route: '#/setup',
      type: { role: 'from', text: 'cen', freeze: true }
    },
    { name: 'trips-list', seed: doc({ trips: [TRIP, TRIP_2], body: departuresBody() }), now: NOW, route: '#/trips' },

    { name: 'desktop', seed: doc({ body: departuresBody() }), now: NOW, body: departuresBody(), size: '1280x800', desktop: true },
    {
      name: 'desktop-delayed',
      seed: doc({ body: departuresBody({ journeys: delayed }) }),
      now: NOW,
      body: departuresBody({ journeys: delayed }),
      size: '1280x800',
      desktop: true
    },
    {
      ...transfer('desktop-detail', transferJourneys(), { after: OPEN_ROW(0) }),
      size: '1280x800',
      desktop: true
    }
  ];
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
  const frozen = () => new Promise(() => {});
  window.fetch = frozen;
  if (t) t.refresh();
  await sleep(40);

  if (t) t.now = () => ${state.now};

  ${state.route ? `if (location.hash !== ${JSON.stringify(state.route)}) { location.hash = ${JSON.stringify(state.route)}; await sleep(60); }` : ''}

  ${state.type ? `
  // A frozen fetch photographs the WAIT; the mock photographs the answer.
  ${state.type.freeze ? '' : `window.fetch = async () => new Response(${JSON.stringify(JSON.stringify(STOPS))}, { headers: { 'Content-Type': 'application/json' } });`}
  const input = document.querySelector('[data-role="${state.type ? state.type.role : ''}"]');
  input.focus();
  input.value = ${JSON.stringify(state.type ? state.type.text : '')};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(700);
  ` : ''}

  if (t && t.state.onBoard) {
    t.state.body = ${JSON.stringify(body)};
    t.state.offline = ${state.offline ? 'true' : 'false'};
    t.state.serverStale = false;
    t.rerender();
  }

  ${state.after || ''}

  // Invariants checked on every state, in the browser, at the shot's viewport.
  // They are reported at console.error, which screenshot.js prints under the
  // shot, so a broken invariant cannot hide inside a plausible-looking image.
  try {
    const problems = [];
    const rowEls = [...document.querySelectorAll('[data-t="row"]')];

    /* The journey detail view is EXEMPT from the three-line invariant (its
       blocks may run longer), but not from the two rules that invariant
       serves: a figure that does not fit its column is drawn straight through
       the time beside it, and our own copy is never ellipsised. */
    for (const block of document.querySelectorAll('[data-t="leg"],[data-t="change"]')) {
      const fig = block.querySelector('.mins');
      if (fig && fig.scrollWidth > fig.clientWidth) {
        problems.push('detail figure "' + (fig.firstChild && fig.firstChild.nodeValue)
          + '" overflows its column: ' + fig.scrollWidth + ' > ' + fig.clientWidth);
      }
      for (const own of block.querySelectorAll('.warnline, .prov')) {
        if (own.scrollWidth > own.clientWidth) problems.push('detail copy truncated: ' + own.textContent);
      }
    }

    for (const row of rowEls) {
      // docs/STYLES.md, binding: three lines per row, in every state.
      const lines = ['.sy-t', '.sy-j', '.sy-sign'].map((s) => row.querySelector(s));
      if (lines.some((el) => !el || !el.textContent.trim())) problems.push('row is not three full lines');
      // The figure must fit its column: it has no ellipsis and nothing clips
      // it, so an overlong one is drawn straight through the departure time.
      const mins = row.querySelector('.sy-n');
      if (mins && mins.scrollWidth > mins.clientWidth) {
        problems.push('figure "' + (mins.firstChild && mins.firstChild.nodeValue) + '" overflows its column: '
          + mins.scrollWidth + ' > ' + mins.clientWidth);
      }
      // Our own copy must never be ellipsised. An upstream headsign may be.
      const note = row.querySelector('.sy-sign.note');
      if (note && note.scrollWidth > note.clientWidth) {
        problems.push('cancelled-lead note truncated: ' + note.scrollWidth + ' > ' + note.clientWidth);
      }
    }

    for (const target of document.querySelectorAll('button,[role="button"]')) {
      const rect = target.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.height < 43.5) {
        problems.push('tap target under 44px: ' + (target.className || target.textContent.trim())
          + ' (' + Math.round(rect.height * 10) / 10 + 'px)');
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

    const fromStation = document.querySelector('.hm-e.from .hm-stn');
    const toStation = document.querySelector('.hm-e.to .hm-stn');
    const fromTime = document.querySelector('.hm-e.from .hm-t');
    const toTime = document.querySelector('.hm-e.to .hm-t');
    if (fromStation && toStation
        && Math.abs(fromStation.getBoundingClientRect().top - toStation.getBoundingClientRect().top) > 0.1) {
      problems.push('home station names are vertically misaligned');
    }
    if (fromTime && toTime
        && Math.abs(fromTime.getBoundingClientRect().top - toTime.getBoundingClientRect().top) > 0.1) {
      problems.push('home endpoint times are vertically misaligned');
    }
    if (document.querySelector('.rail')) problems.push('deleted B2 focus strip is still rendered');

    const timeline = document.querySelector('.sy-tl');
    const futureRows = timeline ? [...timeline.querySelectorAll('.sy-fwd > .sy-row')] : [];
    if (timeline && futureRows.length === 6 && !timeline.querySelector(':scope > .sy-row')) {
      const box = timeline.getBoundingClientRect();
      const heights = futureRows.map((row) => row.getBoundingClientRect().height);
      if (futureRows[0].getBoundingClientRect().top < box.top - 0.5
          || futureRows[5].getBoundingClientRect().bottom > box.bottom + 0.5
          || Math.max(...heights) - Math.min(...heights) > 0.2) {
        problems.push('six future services are not six whole equal slots');
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
       scroll, and the chrome never paints over it or hangs below the frame.
       The detail view's chrome is its closing rule. */
    const region = (sel, itemSel, chromeEl, what) => {
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

    region('.sy-tl', '[data-t="row"]', null, 'board');
    region('.legs', '[data-t="leg"],[data-t="change"]', document.querySelector('.tail'), 'journey');
    if (problems.length) console.error('INVARIANT ' + ${JSON.stringify(state.name)} + ': ' + problems.join('; '));
  } catch (e) { console.error('invariant check failed: ' + e.message); }

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
      for (const feature of media) args.push('--media', feature);
      await run(process.execPath, args, env);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
