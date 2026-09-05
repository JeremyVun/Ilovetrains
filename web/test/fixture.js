/* An /api/v1/departures body (docs/contracts/api.md shape) carrying the six
   real Central → Parramatta services from
   tools/fixtures/trip_central_parramatta.json — same times, platforms, lines
   and headsigns, including the two services the fixture genuinely returns
   with no realtime control. Sydney is UTC+10 in August (no DST). */

export const NOW = Date.parse('2026-08-31T22:45:00+10:00'); // a Monday, 22:45

const at = (hhmm, day = 31) => `2026-08-${day}T${hhmm}:00+10:00`;

export function departuresBody(overrides = {}) {
  return {
    from: { id: '200060', name: 'Central Station' },
    to: { id: '215020', name: 'Parramatta Station' },
    generatedAt: overrides.generatedAt || at('22:45'),
    journeys: (overrides.journeys || baseJourneys()).map((j) => j)
  };
}

export function baseJourneys() {
  return [
    journey('22:48', '23:17', '12', 'T1', 'Penrith via Parramatta', true),
    journey('23:03', '23:34', '8', 'T1', 'Penrith via Parramatta', true),
    journey('23:12', '23:36', '7', 'BMT', 'Mount Victoria via Parramatta', true),
    journey('23:18', '23:47', '13', 'T1', 'Penrith via Parramatta', true),
    journey('23:33', '00:04', '13', 'T1', 'Penrith via Parramatta', false),
    journey('23:48', '00:17', '12', 'T1', 'Penrith via Parramatta', false)
  ];
}

export function journey(dep, arr, platform, line, headsign, realtime) {
  const arrDay = arr < dep ? 1 : 31; // 00:04 and 00:17 land on the next day
  return {
    departure: {
      scheduled: at(dep),
      estimated: realtime ? at(dep) : null,
      platform: platform === null ? null : 'Platform ' + platform
    },
    arrival: {
      scheduled: arrDay === 1 ? `2026-09-01T${arr}:00+10:00` : at(arr),
      estimated: realtime ? (arrDay === 1 ? `2026-09-01T${arr}:00+10:00` : at(arr)) : null
    },
    line: { name: line, mode: 'train' },
    destinationHeadsign: headsign,
    stopsAway: null,
    cancelled: false,
    legs: 1
  };
}

/** Push a journey's realtime estimate `minutes` past its timetable. */
export function delay(j, minutes) {
  const shift = (iso) => new Date(Date.parse(iso) + minutes * 60000).toISOString();
  j.departure.estimated = shift(j.departure.scheduled);
  j.arrival.estimated = shift(j.arrival.scheduled);
  return j;
}

export function cancel(j) {
  j.cancelled = true;
  return j;
}

/* ---- the transfer corridor ---------------------------------------------- */

/* Rhodes → Bondi Junction, the six T9 → T4 journeys of
   tools/fixtures/trip_rhodes_bondijunction.json (captured 2026-09-01), mapped
   to the api.md shape the server produces. Every timestamp is the fixture's,
   to the second; the seconds matter, because they are what makes the
   floor-to-clock-minute rule visible (the last journey's change is 3m18s of
   wall clock and 4 minutes of printed timetable — the real tight connection on
   this corridor, with no delay applied to it).
   Five of the fixture's eleven journeys route via an "On Demand" bus and are
   excluded server-side (api.md); the six here are what a client sees.
   The last two are genuinely not realtime-controlled upstream. */

export const TRANSFER_NOW = Date.parse('2026-09-01T09:21:00+10:00');
export const TRANSFER_DEPARTED_NOW = Date.parse('2026-09-01T09:47:00+10:00');

const TRANSFER_RAW = [
  { dep: '09:24:18', arrTH: '09:51:36', depTH: '09:58:00', arr: '10:08:00', platform: '2', realtime: true },
  { dep: '09:39:18', arrTH: '10:06:36', depTH: '10:12:00', arr: '10:22:00', platform: '1', realtime: true },
  { dep: '09:54:18', arrTH: '10:21:36', depTH: '10:32:00', arr: '10:42:00', platform: '1', realtime: true },
  { dep: '10:09:18', arrTH: '10:36:36', depTH: '10:42:00', arr: '10:52:00', platform: '2', realtime: true },
  { dep: '10:24:18', arrTH: '10:51:36', depTH: '11:02:00', arr: '11:12:00', platform: '2', realtime: false },
  { dep: '10:39:18', arrTH: '11:08:42', depTH: '11:12:00', arr: '11:22:00', platform: '1', realtime: false }
];

const sydney = (hhmmss) => `2026-09-01T${hhmmss}+10:00`;
const times = (scheduled, realtime) => ({
  scheduled: sydney(scheduled),
  estimated: realtime ? sydney(scheduled) : null
});

export function transferJourneys() {
  return TRANSFER_RAW.map((r) => {
    const legDetail = [
      {
        line: { name: 'T9', mode: 'train' },
        headsign: 'Gordon via Lindfield',
        from: { id: '213820', name: 'Rhodes Station', platform: 'Platform 1' },
        to: { id: '200070', name: 'Town Hall Station', platform: 'Platform 3' },
        departure: times(r.dep, r.realtime),
        arrival: times(r.arrTH, r.realtime),
        cancelled: false
      },
      {
        line: { name: 'T4', mode: 'train' },
        headsign: 'Bondi Junction',
        from: { id: '200070', name: 'Town Hall Station', platform: 'Platform 5' },
        to: { id: '202210', name: 'Bondi Junction Station', platform: 'Platform ' + r.platform },
        departure: times(r.depTH, r.realtime),
        arrival: times(r.arr, r.realtime),
        cancelled: false
      }
    ];
    return {
      departure: { ...legDetail[0].departure, platform: 'Platform 1' },
      arrival: { ...legDetail[1].arrival },
      line: { name: 'T9', mode: 'train' },
      destinationHeadsign: 'Gordon via Lindfield',
      stopsAway: null,
      cancelled: false,
      legs: 2,
      legDetail
    };
  });
}

export function transferBody(overrides = {}) {
  return {
    from: { id: '213820', name: 'Rhodes Station' },
    to: { id: '202210', name: 'Bondi Junction Station' },
    generatedAt: overrides.generatedAt || sydney('09:21:00'),
    journeys: overrides.journeys || transferJourneys()
  };
}

/** Push one leg's realtime estimate `minutes` past its timetable, and the
    journey's own departure with it when it is the first leg. */
export function delayLeg(journey, index, minutes) {
  const shift = (iso) => new Date(Date.parse(iso) + minutes * 60000).toISOString();
  const leg = journey.legDetail[index];
  leg.departure.estimated = shift(leg.departure.scheduled);
  leg.arrival.estimated = shift(leg.arrival.scheduled);
  if (index === 0) journey.departure.estimated = leg.departure.estimated;
  if (index === journey.legDetail.length - 1) journey.arrival.estimated = leg.arrival.estimated;
  return journey;
}

/** Cancel one leg. A journey is cancelled if ANY leg is (api.md); which one
    is a question only `legDetail` can answer. */
export function cancelLeg(journey, index) {
  journey.legDetail[index].cancelled = true;
  journey.cancelled = true;
  return journey;
}

/* The renderer's plural seam: the corridor returns no three-leg journey, so the
   second change at Central is a declared synthetic delta (r6.js S3). */
export function threeLegJourney() {
  const j = structuredClone(transferJourneys()[0]);
  const at = (hhmm) => ({ scheduled: sydney(`${hhmm}:00`), estimated: sydney(`${hhmm}:00`) });
  j.legDetail[1] = {
    ...j.legDetail[1],
    to: { id: '200060', name: 'Central Station', platform: 'Platform 12' },
    arrival: at('10:02')
  };
  j.legDetail.push({
    line: { name: 'T1', mode: 'train' },
    headsign: 'Bondi Junction',
    from: { id: '200060', name: 'Central Station', platform: 'Platform 13' },
    to: { id: '202210', name: 'Bondi Junction Station', platform: 'Platform 2' },
    departure: at('10:07'),
    arrival: at('10:22'),
    cancelled: false
  });
  j.arrival = at('10:22');
  j.legs = 3;
  return j;
}

/* ---- ferries ----------------------------------------------------------- */

export const FERRY_NOW = Date.parse('2026-09-05T15:36:00+10:00');

const ferryTime = (hhmmss) => `2026-09-05T${hhmmss}+10:00`;
const ferryTimes = (scheduled, realtime = true) => ({
  scheduled: ferryTime(scheduled),
  estimated: realtime ? ferryTime(scheduled) : null
});

const CIRCULAR_QUAY = { id: '200020', name: 'Circular Quay' };
const MANLY_WHARF = { id: '209573', name: 'Manly Wharf' };

function ferryLeg({
  code, dep, arr, fromPlatform, toPlatform, realtime = true,
  from = CIRCULAR_QUAY, to = MANLY_WHARF, headsign = 'Manly'
}) {
  return {
    line: { name: code, mode: 'ferry' },
    headsign,
    from: { ...from, platform: fromPlatform },
    to: { ...to, platform: toPlatform },
    departure: ferryTimes(dep, realtime),
    arrival: ferryTimes(arr, realtime),
    cancelled: false
  };
}

function apiJourney(legDetail) {
  const first = legDetail[0];
  const last = legDetail[legDetail.length - 1];
  return {
    departure: { ...first.departure, platform: first.from.platform },
    arrival: { ...last.arrival },
    line: { ...first.line },
    destinationHeadsign: first.headsign,
    stopsAway: null,
    cancelled: false,
    legs: legDetail.length,
    legDetail
  };
}

export function privateFerryJourney() {
  return apiJourney([ferryLeg({
    code: 'MFF', dep: '15:40:00', arr: '16:00:00',
    fromPlatform: 'Wharf 2, Side A', toPlatform: 'Wharf 2', realtime: false
  })]);
}

export function ferryJourneys() {
  return [
    privateFerryJourney(),
    apiJourney([ferryLeg({
      code: 'F1', dep: '15:45:00', arr: '16:07:00',
      fromPlatform: 'Wharf 3, Side A', toPlatform: 'Wharf 1'
    })]),
    apiJourney([ferryLeg({
      code: 'F1', dep: '15:50:00', arr: '16:20:00',
      fromPlatform: 'Wharf 3, Side B', toPlatform: 'Wharf 1'
    })])
  ];
}

export function ferryBody(overrides = {}) {
  return {
    from: { ...CIRCULAR_QUAY, modes: ['train', 'ferry'], location: { lat: -33.861351, lon: 151.210813 } },
    to: { ...MANLY_WHARF, modes: ['ferry'], location: { lat: -33.799541, lon: 151.284282 } },
    generatedAt: overrides.generatedAt || ferryTime('15:36:00'),
    journeys: overrides.journeys || ferryJourneys()
  };
}

function wynyardLeg() {
  return {
    line: { name: 'T8', mode: 'train' },
    headsign: 'Revesby via Airport',
    from: { id: '200080', name: 'Wynyard Station', platform: 'Platform 6' },
    to: { ...CIRCULAR_QUAY, platform: 'Platform 2' },
    departure: ferryTimes('15:28:30'),
    arrival: ferryTimes('15:31:00'),
    cancelled: false
  };
}

export function mixedJourneys() {
  return [
    apiJourney([wynyardLeg(), ferryLeg({
      code: 'MFF', dep: '15:40:00', arr: '16:00:00',
      fromPlatform: 'Wharf 2, Side A', toPlatform: 'Wharf 2', realtime: false
    })]),
    apiJourney([wynyardLeg(), ferryLeg({
      code: 'F1', dep: '15:45:00', arr: '16:07:00',
      fromPlatform: 'Wharf 3, Side A', toPlatform: 'Wharf 1'
    })])
  ];
}

export function mixedBody(overrides = {}) {
  return {
    from: { id: '200080', name: 'Wynyard Station', modes: ['train'], location: { lat: -33.8659, lon: 151.2057 } },
    to: { ...MANLY_WHARF, modes: ['ferry'], location: { lat: -33.799541, lon: 151.284282 } },
    generatedAt: overrides.generatedAt || ferryTime('15:25:00'),
    journeys: overrides.journeys || mixedJourneys()
  };
}

export function exceptionalFerryJourneys() {
  const balmainEast = { id: '20414', name: 'Balmain East Wharf' };
  const barangaroo = { id: '2000441', name: 'Barangaroo Wharf' };
  const cockatoo = { id: '20009', name: 'Cockatoo Island Wharf' };
  const balmain = { id: '204157', name: 'Balmain Wharf' };
  const direct = apiJourney([ferryLeg({
    code: 'F4', dep: '15:57:00', arr: '16:12:00', headsign: 'Balmain East',
    fromPlatform: 'Wharf 5, Side B', toPlatform: 'Side A', to: balmainEast
  })]);
  const train = {
    line: { name: 'T2', mode: 'train' }, headsign: 'Leppington',
    from: { ...CIRCULAR_QUAY, platform: 'Platform 1' },
    to: { id: '200080', name: 'Wynyard Station', platform: 'Platform 5' },
    departure: ferryTimes('16:03:30'), arrival: ferryTimes('16:05:18'), cancelled: false
  };
  const walkChange = apiJourney([train, ferryLeg({
    code: 'F4', dep: '16:16:00', arr: '16:21:00', headsign: 'Balmain East',
    fromPlatform: 'Wharf 2, Side B', toPlatform: 'Side A',
    from: barangaroo, to: balmainEast
  })]);
  const islandChange = apiJourney([
    ferryLeg({
      code: 'F3', dep: '15:58:00', arr: '16:07:00', headsign: 'Cockatoo Island',
      fromPlatform: 'Wharf 1, Side B', toPlatform: 'Side A',
      from: barangaroo, to: cockatoo
    }),
    ferryLeg({
      code: 'F8', dep: '16:19:00', arr: '16:35:00', headsign: 'Balmain',
      fromPlatform: 'Side A', toPlatform: 'Balmain Wharf',
      from: cockatoo, to: balmain
    })
  ]);
  return [direct, walkChange, islandChange];
}

export function balmainEastBody(overrides = {}) {
  const journeys = exceptionalFerryJourneys();
  return {
    from: { ...CIRCULAR_QUAY, modes: ['train', 'ferry'] },
    to: { id: '20414', name: 'Balmain East Wharf', modes: ['ferry'] },
    generatedAt: overrides.generatedAt || ferryTime('15:55:00'),
    journeys: overrides.journeys || journeys.slice(0, 2)
  };
}

export function cockatooBalmainBody(overrides = {}) {
  return {
    from: { id: '2000441', name: 'Barangaroo Wharf', modes: ['ferry'] },
    to: { id: '204157', name: 'Balmain Wharf', modes: ['ferry'] },
    generatedAt: overrides.generatedAt || ferryTime('15:55:00'),
    journeys: overrides.journeys || [exceptionalFerryJourneys()[2]]
  };
}


/* A dozen real stations with their real coordinates, standing in for the baked
   index. Every distance the location tests assert is arithmetic on these. */
export const STATIONS = {
  rhodes: { id: '213820', name: 'Rhodes Station', modes: ['train'], location: { lat: -33.8308, lon: 151.0879 } },
  meadowbank: { id: '211430', name: 'Meadowbank Station', modes: ['train'], location: { lat: -33.8175, lon: 151.0895 } },
  burwood: { id: '213410', name: 'Burwood Station', modes: ['train'], location: { lat: -33.8772, lon: 151.1040 } },
  strathfield: { id: '213510', name: 'Strathfield Station', modes: ['train'], location: { lat: -33.8720, lon: 151.0944 } },
  townhall: { id: '200070', name: 'Town Hall Station', modes: ['train'], location: { lat: -33.8735, lon: 151.2070 } },
  wynyard: { id: '200080', name: 'Wynyard Station', modes: ['train'], location: { lat: -33.8659, lon: 151.2064 } },
  central: { id: '200060', name: 'Central Station', modes: ['train'], location: { lat: -33.8832, lon: 151.2069 } },
  bondi: { id: '202210', name: 'Bondi Junction Station', modes: ['train'], location: { lat: -33.8915, lon: 151.2477 } },
  parramatta: { id: '215020', name: 'Parramatta Station', modes: ['train'], location: { lat: -33.8173, lon: 151.0053 } },
  olympicpark: { id: '212710', name: 'Olympic Park Station', modes: ['train'], location: { lat: -33.8471, lon: 151.0637 } },
  epping: { id: '212110', name: 'Epping Station', modes: ['train', 'metro'], location: { lat: -33.7726, lon: 151.0819 } },
  chatswood: { id: '206710', name: 'Chatswood Station', modes: ['train', 'metro'], location: { lat: -33.7967, lon: 151.1805 } }
};

export const INDEX = Object.values(STATIONS);

export function tripBetween(id, fromKey, toKey, createdAt = new Date(0).toISOString()) {
  return { id, from: STATIONS[fromKey], to: STATIONS[toKey], createdAt };
}
