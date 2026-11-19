import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBusinessDate, assertShiftWindow, assertBlockedWindow } from '../apps/api/src/services/schedule-guards.ts';

test('Gregorian day accepts leap day but rejects invalid or noncanonical dates', () => {
  assert.doesNotThrow(() => assertBusinessDate('2028-02-29'));
  for (const date of ['2027-02-29', '2027-13-01', '2027-04-31', '2027-2-01', '0000-01-01', '2101-01-01']) {
    assert.throws(() => assertBusinessDate(date), date);
  }
});

test('non-overlapping adjacent breaks fit inside same-day shift', () => {
  assert.doesNotThrow(() => assertShiftWindow('09:00', '18:00', [
    { startTime: '14:00', endTime: '14:15' },
    { startTime: '12:00', endTime: '12:30' },
    { startTime: '12:30', endTime: '13:00' },
  ]));
});

test('reject overnight / empty shifts and invalid break definitions', () => {
  assert.throws(() => assertShiftWindow('18:00', '09:00', []), /Shift/);
  assert.throws(() => assertShiftWindow('10:00', '10:00', []), /Shift/);
  for (const bad of [
    [{ startTime: '09:30', endTime: '10:30' }],
    [{ startTime: '17:30', endTime: '18:30' }],
    [{ startTime: '12:00', endTime: '12:00' }],
    [{ startTime: '12:00', endTime: '12:45' }, { startTime: '12:30', endTime: '13:00' }],
    [{ startTime: '25:00', endTime: '13:00' }],
  ]) assert.throws(() => assertShiftWindow('10:00', '18:00', bad));
});

test('temporary block requires a finite, bounded, positive half-open interval', () => {
  assert.doesNotThrow(() => assertBlockedWindow(1000, 1001));
  assert.doesNotThrow(() => assertBlockedWindow(1000, 1000 + 366 * 86_400_000));
  for (const args of [[1000,1000], [1100,1000], [NaN,1100], [1000,Infinity], [0,367*86_400_000]]) {
    assert.throws(() => assertBlockedWindow(...args));
  }
});
