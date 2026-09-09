import test from 'node:test';
import assert from 'node:assert/strict';

import { FEEDBACK_BODY_LIMIT, FEEDBACK_LIMIT, createFeedbackDraft, feedbackPayload } from '../js/settings.js';

const bytes = (value) => new TextEncoder().encode(value).length;

function payloadFor(message) {
  const draft = createFeedbackDraft();
  draft.message = message;
  return feedbackPayload(draft);
}

const envelope = bytes(payloadFor('x').body) - 1;

test('the largest body the cap accepts is exactly the cap, and one byte more is refused', () => {
  const room = FEEDBACK_BODY_LIMIT - envelope;
  const message = '"'.repeat(Math.floor(room / 2)) + 'x'.repeat(room % 2);
  assert.ok(bytes(message) < FEEDBACK_LIMIT);
  const payload = payloadFor(message);
  assert.equal(bytes(payload.body), FEEDBACK_BODY_LIMIT);
  assert.equal(payload.error, undefined);
  const refused = payloadFor(message + 'x');
  assert.equal(refused.body, undefined);
  assert.match(String(refused.error), /too long/);
});

test('the largest multi-byte message fits the body cap', () => {
  const message = '\u{1F682}'.repeat(FEEDBACK_LIMIT / 4);
  assert.equal(bytes(message), FEEDBACK_LIMIT);
  const payload = payloadFor(message);
  assert.equal(payload.error, undefined);
  assert.ok(bytes(payload.body) <= FEEDBACK_BODY_LIMIT);
});

test('escaped worst cases are rejected by the body cap, not the message cap', () => {
  for (const glyph of ['"', '\\', '\n', '\u2028']) {
    const message = 'x' + glyph.repeat(Math.floor((FEEDBACK_LIMIT - 2) / bytes(glyph))) + 'x';
    assert.ok(bytes(message) <= FEEDBACK_LIMIT);
    const payload = payloadFor(message);
    const escaped = bytes(JSON.stringify(message)) - 2;
    if (escaped + envelope > FEEDBACK_BODY_LIMIT) assert.match(payload.error, /too long/, JSON.stringify(glyph));
    else assert.equal(payload.error, undefined, JSON.stringify(glyph));
  }
});
