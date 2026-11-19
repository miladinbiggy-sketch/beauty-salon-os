import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMethodTotals, isValidBusinessDate } from '../apps/api/src/services/cash-summary.ts';

test('日结来自完整支付渠道汇总，退款不被重复扣除', () => {
  const s = summarizeMethodTotals([
    { method: 'cash', received_jpy: '9000', refunded_jpy: '3000', transaction_count: '4' },
    { method: 'card', received_jpy: '7000', refunded_jpy: '500', transaction_count: '2' },
  ]);
  assert.equal(s.receivedJpy, 16000);
  assert.equal(s.refundedJpy, 3500);
  assert.equal(s.netJpy, 12500);
  assert.equal(s.cashNetJpy, 6000);
  assert.equal(s.transactionCount, 6);
  assert.equal(s.methods[0].netJpy, 6000);
});
test('没有现金收款，现金净流入为零', () => {
  assert.equal(summarizeMethodTotals([]).cashNetJpy, 0);
  assert.equal(summarizeMethodTotals([{ method: 'card', received_jpy: 100, refunded_jpy: 0, transaction_count: 1 }]).cashNetJpy, 0);
});
test('防止无效日期与金额溢出', () => {
  assert.equal(isValidBusinessDate('2026-02-30'), false);
  assert.equal(isValidBusinessDate('2026-11-19'), true);
  assert.equal(isValidBusinessDate('2024-02-29'), true);
  assert.equal(isValidBusinessDate('not-a-date'), false);
  assert.throws(() => summarizeMethodTotals([{method:'cash', received_jpy:'9007199254740992', refunded_jpy:0, transaction_count:1}]), /safe integer/);
});
