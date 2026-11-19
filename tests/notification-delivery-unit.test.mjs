import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushLineMessage, PermanentNotificationError } from '../apps/worker/src/line-delivery.ts';
import { retryDisposition, shouldSendBookingNotice } from '../apps/worker/src/notification-policy.ts';

const ID = '30b1ab70-0234-4272-9bf6-b7b75b7dca91';
const START = '2027-01-15T01:00:00.000Z';
const startMs = Date.parse(START);
const gate = (overrides = {}) => shouldSendBookingNotice({
  type: 'reminder_1day', status: 'booked', payloadStartAt: START,
  currentStartAtMs: startMs, nowMs: startMs - 3_600_000,
  ...overrides,
});

test('reminder is accepted when appointment remains valid and upcoming', () => {
  assert.deepEqual(gate(), { allowed: true });
});
test('reminder is suppressed when appointment cancelled, arrived, or completed', () => {
  for (const status of ['cancelled', 'arrived', 'in_service', 'completed', 'no_show']) {
    assert.equal(gate({ status }).allowed, false);
  }
});
test('stale reschedule and expired reminder are suppressed', () => {
  assert.equal(gate({ currentStartAtMs: startMs + 3_600_000 }).allowed, false);
  assert.equal(gate({ nowMs: startMs + 1 }).allowed, false);
  assert.equal(gate({ type: 'booking_rescheduled', currentStartAtMs: startMs + 1 }).allowed, false);
});
test('cancel message is sent only while truly cancelled', () => {
  assert.equal(gate({ type: 'booking_cancelled', status: 'cancelled' }).allowed, true);
  assert.equal(gate({ type: 'booking_cancelled', status: 'booked' }).allowed, false);
});
test('unknown type or missing appointment is not sent', () => {
  assert.equal(gate({ type: 'unknown_type' }).allowed, false);
  assert.equal(gate({ status: null }).allowed, false);
});
test('retry must stay within 23h and retry count; permanent errors stop', () => {
  const now = 1_800_000_000_000;
  assert.equal(retryDisposition({ attempts: 1, firstAttemptMs: now - 1000, nowMs: now, permanent: false }), 'retry');
  assert.equal(retryDisposition({ attempts: 3, firstAttemptMs: now, nowMs: now, permanent: false }), 'failed');
  assert.equal(retryDisposition({ attempts: 1, firstAttemptMs: now, nowMs: now, permanent: true }), 'failed');
  assert.equal(retryDisposition({ attempts: 1, firstAttemptMs: now - 23 * 3600_000, nowMs: now, permanent: false }), 'failed');
  assert.equal(retryDisposition({ attempts: 1, firstAttemptMs: null, nowMs: now, permanent: false }), 'failed');
});
test('LINE HTTP transport sends stable idempotency UUID, not a new UUID per retry', async () => {
  const captured = [];
  const request = async (_url, init) => {
    captured.push(init);
    return new Response('{}', { status: 200 });
  };
  for (let i = 0; i < 2; i++) await pushLineMessage(ID, 'Uabcdef', 'test', 'token', request);
  assert.equal(captured.length, 2);
  assert.equal(captured[0].headers['X-Line-Retry-Key'], ID);
  assert.equal(captured[1].headers['X-Line-Retry-Key'], ID);
  assert.equal(captured[0].body, captured[1].body);
  assert.equal(JSON.parse(captured[0].body).to, 'Uabcdef');
});
test('LINE already-accepted 409 is success only with accepted request header', async () => {
  const accepted = await pushLineMessage(ID, 'Uabcdef', 'test', 'token', async () =>
    new Response('{}', { status: 409, headers: { 'x-line-accepted-request-id': '1234' } }));
  assert.match(accepted.detail, /already accepted/);
  await assert.rejects(
    pushLineMessage(ID, 'Uabcdef', 'test', 'token', async () => new Response('{}', { status: 409 })),
    PermanentNotificationError,
  );
});
test('LINE 401 fails permanently, 5xx and timeout are retryable', async () => {
  await assert.rejects(pushLineMessage(ID, 'Uabcdef', 'test', 'token', async () => new Response('{}', { status: 401 })), PermanentNotificationError);
  await assert.rejects(pushLineMessage(ID, 'Uabcdef', 'test', 'token', async () => new Response('{}', { status: 503 })), /^Error: LINE API 503/);
  await assert.rejects(pushLineMessage(ID, 'Uabcdef', 'test', 'token', async () => { throw new Error('timeout'); }), /timeout/);
});
test('missing LINE config and invalid job key fail closed without HTTP call', async () => {
  await assert.rejects(pushLineMessage(ID, 'Uabcdef', 'test', undefined), PermanentNotificationError);
  await assert.rejects(pushLineMessage('not-uuid', 'Uabcdef', 'test', 'token'), PermanentNotificationError);
});
