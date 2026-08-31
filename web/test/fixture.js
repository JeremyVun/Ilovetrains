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
