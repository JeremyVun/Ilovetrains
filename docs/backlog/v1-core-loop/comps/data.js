/* Real data lifted from tools/fixtures/trip_central_parramatta.json.
   UTC timestamps converted to Sydney local (UTC+10). Nothing invented:
   every time, platform, line name and headsign below is in the fixture.
   Clock is shifted only via NOW, as the brief permits. */

var NOW_MIN = 22 * 60 + 45; // 22:45 Sydney

var TRIP = { from: 'Central', to: 'Parramatta', savedCount: 3 };

/* Official TfNSW line colours (Transport for NSW brand/line-colour palette). */
var LINES = {
  T1:  { code: 'T1',  name: 'T1 North Shore & Western Line', color: '#F99D1C' },
  T2:  { code: 'T2',  name: 'T2 Inner West & Leppington Line', color: '#0098CD' },
  T3:  { code: 'T3',  name: 'T3 Liverpool via Regents Park Line', color: '#F37021' },
  T4:  { code: 'T4',  name: 'T4 Eastern Suburbs & Illawarra Line', color: '#005AA3' },
  T5:  { code: 'T5',  name: 'T5 Cumberland Line', color: '#C4258F' },
  T8:  { code: 'T8',  name: 'T8 Airport & South Line', color: '#00954C' },
  T9:  { code: 'T9',  name: 'T9 Northern Line', color: '#D11F2F' },
  M1:  { code: 'M1',  name: 'M1 Metro North West & Bankstown Line', color: '#168388' },
  BMT: { code: 'BMT', name: 'Blue Mountains Line', color: '#F99D1C' }
};

function hm(s) { var p = s.split(':'); return (+p[0]) * 60 + (+p[1]); }
function fmt(m) { m = ((m % 1440) + 1440) % 1440; var h = Math.floor(m / 60), n = m % 60; return (h < 10 ? '0' : '') + h + ':' + (n < 10 ? '0' : '') + n; }

/* The six journeys the fixture returns for Central -> Parramatta. */
var BASE = [
  { dep: '22:48', arr: '23:17', platform: '12', line: 'T1',  headsign: 'Penrith via Parramatta',       realtime: true },
  { dep: '23:03', arr: '23:34', platform: '8',  line: 'T1',  headsign: 'Penrith via Parramatta',       realtime: true },
  { dep: '23:12', arr: '23:36', platform: '7',  line: 'BMT', headsign: 'Mount Victoria via Parramatta', realtime: true },
  { dep: '23:18', arr: '23:47', platform: '13', line: 'T1',  headsign: 'Penrith via Parramatta',       realtime: true },
  { dep: '23:33', arr: '00:04', platform: '13', line: 'T1',  headsign: 'Penrith via Parramatta',       realtime: false },
  { dep: '23:48', arr: '00:17', platform: '12', line: 'T1',  headsign: 'Penrith via Parramatta',       realtime: false }
];

function clone(rows) { return rows.map(function (r) { return JSON.parse(JSON.stringify(r)); }); }

/* Scenarios. Every one is the same real board under different honest conditions. */
var SCENARIOS = {
  hero: function () { return { rows: clone(BASE), age: 4, offline: false }; },

  delayed: function () {
    var r = clone(BASE);
    r[0].estDep = '22:54'; r[0].estArr = '23:23'; // running 6 late
    r[3].estDep = '23:21'; r[3].estArr = '23:50'; // running 3 late
    return { rows: r, age: 6, offline: false };
  },

  /* Cancels the FIRST service on purpose: that is the case that forces a
     board to say what it is doing rather than quietly showing the next one. */
  cancelled: function () {
    var r = clone(BASE);
    r[0].cancelled = true;
    r[3].cancelled = true;
    return { rows: r, age: 9, offline: false };
  },

  scheduled: function () {
    var r = clone(BASE);
    r[0].realtime = false; r[1].realtime = false; r[2].realtime = false;
    return { rows: r, age: 11, offline: false };
  },

  stale: function () {
    var s = SCENARIOS.hero(); s.age = 247; s.offline = true; return s;
  },

  long: function () {
    var r = clone(BASE);
    r.forEach(function (x) { x.headsign = 'Mount Victoria via Parramatta'; x.platform = '12'; });
    r[0].line = 'T1'; r[1].line = 'BMT'; r[2].line = 'T1'; r[3].line = 'BMT';
    r[0].estDep = '22:54'; r[0].estArr = '23:23';
    r[2].cancelled = true;
    return { rows: r, age: 38, offline: false, longNames: true };
  }
};

function currentScenario() {
  var q = (location.search.match(/s=([a-z]+)/) || [])[1] || 'hero';
  var s = (SCENARIOS[q] || SCENARIOS.hero)();
  s.name = q;
  s.rows.forEach(function (r) {
    r.effDep = r.estDep || r.dep;
    r.effArr = r.estArr || r.arr;
    r.mins = hm(r.effDep) - NOW_MIN;
    if (r.mins < 0) r.mins += 1440;
    r.delayMin = r.estDep ? hm(r.estDep) - hm(r.dep) : 0;
    r.L = LINES[r.line];
    r.dur = (hm(r.effArr) - hm(r.effDep) + 1440) % 1440;
  });
  if (document.body) document.body.dataset.scenario = q;
  return s;
}

function ageLabel(age, offline) {
  if (offline) return 'Offline · last updated ' + (age >= 60 ? Math.round(age / 60) + ' h' : age + ' min') + ' ago';
  if (age > 60) return 'Last updated ' + Math.round(age / 60) + ' h ago';
  if (age > 45) return 'Last updated ' + age + ' min ago';
  return 'Updated ' + age + 's ago';
}
