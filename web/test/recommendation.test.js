import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectRecommendation, recommendationCost, earliestAlternative, nextRecommendationCursor } from '../js/recommendation.js';
import { effectiveCap, preferencesOf } from '../js/preferences.js';

const fixture = JSON.parse(readFileSync(new URL('../../tools/fixtures/conformance/commute-feedback.json', import.meta.url)));
const epoch = fixture.epochMs;
const journey = raw => {
  const legs = raw.legs.map(([name, departure, arrival]) => ({ line: { name, mode: 'train' },
    departure: { scheduled: new Date(epoch + departure).toISOString() },
    arrival: { scheduled: new Date(epoch + arrival).toISOString() } }));
  return { id: raw.id, cancelled: raw.cancelled, legDetail: legs, legs: legs.length,
    departure: legs[0].departure, arrival: legs.at(-1).arrival };
};
for (const item of fixture.recommendations) test(item.id, () => {
  const candidates = item.journeys.map(journey);
  const chosen = selectRecommendation(candidates, epoch);
  assert.equal(chosen?.id, item.expected);
  assert.equal(recommendationCost(chosen), epoch + item.expectedCostDelta);
  if (item.alternative) assert.equal(earliestAlternative(candidates, chosen, epoch)?.id, item.alternative);
});
for (const item of fixture.preferences) test(item.id, () => {
  const doc = { flags: { transferLimit: item.flag }, preferences: { transferLimit: item.choice } };
  assert.equal(preferencesOf(doc).transferLimit, item.expectedChoice);
  assert.equal(effectiveCap(doc), item.expectedCap);
});

test('fresh observation owns its answer even when a stale candidate has lower cost', () => {
  const old = { journey: journey({id: 'old', legs: [['T1', 0, 600000]]}), stale: true, source: {generatedAt: 1} };
  const fresh = { journey: journey({id: 'fresh', legs: [['T9', 0, 1200000]]}), stale: false, source: {generatedAt: 2} };
  assert.equal(selectRecommendation([old, fresh], epoch), fresh);
  assert.equal(selectRecommendation([old], epoch), old);
});

test('R4 cursor uses raw greatest departure and preserves equal-cost boundary', () => {
  const body = {journeys: [journey({id:'one', legs:[['T1', 599999, 1200000]]})]};
  assert.equal(nextRecommendationCursor(body, epoch, epoch), epoch + 600000);
  assert.equal(nextRecommendationCursor(body, epoch + 600000, epoch), null);
  assert.equal(nextRecommendationCursor({journeys:[]}, epoch, epoch), null);
  const best = journey({id:'best', legs:[['T9', 0, 600000]]});
  assert.equal(nextRecommendationCursor(body, epoch, epoch, best), epoch + 600000);
  const far = {journeys:[journey({id:'far',legs:[['T1',7200000,8000000]]})]};
  assert.equal(nextRecommendationCursor(far, epoch, epoch), null);
});

test('P3/P4 direct-only and later-leg modes filter candidates before selection', () => {
  const direct = journey({id:'direct',legs:[['T9',600000,3840000]]});
  const change = journey({id:'change',legs:[['T1',0,600000],['M1',900000,1200000]]});
  change.legDetail[1].line.mode = 'metro';
  assert.equal(selectRecommendation([change,direct],epoch,{maxTransfers:0}),direct);
  assert.equal(selectRecommendation([change,direct],epoch,{modes:['train']}),direct);
  assert.equal(selectRecommendation([change,direct],epoch,{modes:[]}),null);
});

test('score follows the final leg estimate independently of an outdated summary', () => {
  const route = journey({id:'transfer',legs:[['T1',0,600000],['T2',900000,1200000]]});
  route.legDetail[1].arrival = {...route.legDetail[1].arrival,estimated:new Date(epoch+1800000).toISOString()};
  assert.equal(recommendationCost(route),epoch+2100000);
});

test('old cache without leg detail keeps its canonical service count and transfer cost', () => {
  const route = journey({id:'transfer',legs:[['T1',0,600000],['T2',900000,1200000]]});
  delete route.legDetail;
  assert.equal(recommendationCost(route),epoch+1500000);
  const direct = journey({id:'direct',legs:[['T9',300000,1440000]]});
  assert.equal(selectRecommendation([route,direct],epoch),direct);
  route.legs = 1.5;
  assert.equal(recommendationCost(route),null);
});

test('overlapping connections and disagreement with the mapped count cannot win', () => {
  const overlap = journey({id:'overlap',legs:[['T1',0,1200000],['T2',600000,1800000]]});
  assert.equal(recommendationCost(overlap),null);
  const mismatch = journey({id:'mismatch',legs:[['T1',0,1200000]]});
  mismatch.legs=2;
  assert.equal(recommendationCost(mismatch),null);
});
