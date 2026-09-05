const test = require('node:test');
const assert = require('node:assert/strict');
const { failures } = require('../measure-open.js');

const good = {
  fcpMs: 20, apiResponseEndMs: 100, apiStatus: 200, offline: false,
  dataAgeMs: 1000, rowsOnScreen: 6, serviceWorker: 'controlling'
};

test('the experience bar requires measured paint and a successful fresh API response', () => {
  assert.deepEqual(failures(good), []);
  for (const bad of [
    { fcpMs: null }, { apiResponseEndMs: null }, { fcpMs: 0 },
    { apiStatus: 404 }, { apiStatus: 502 }, { offline: true },
    { dataAgeMs: null }, { dataAgeMs: 90_001 }, { rowsOnScreen: 0 },
    { serviceWorker: 'none' }, { fcpMs: 500 }, { apiResponseEndMs: 2000 }
  ]) assert.ok(failures({ ...good, ...bad }).length, JSON.stringify(bad));
});
