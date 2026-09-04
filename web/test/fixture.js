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
        to: { id: '200080', name: 'Bondi Junction Station', platform: 'Platform ' + r.platform },
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
    to: { id: '200080', name: 'Bondi Junction Station' },
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
    to: { id: '200080', name: 'Bondi Junction Station', platform: 'Platform 2' },
    departure: at('10:07'),
    arrival: at('10:22'),
    cancelled: false
  });
  j.arrival = at('10:22');
  j.legs = 3;
  return j;
}
