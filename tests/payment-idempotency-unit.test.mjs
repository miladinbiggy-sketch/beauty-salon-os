import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentFingerprint, paymentRetryDisposition } from "../apps/api/src/services/payment-idempotency.ts";

const receipt = {operation:"receipt", appointmentId:"appt-a", amountJpy:7500, method:"card"};
test("unchanged receipt retransmission has stable SHA256", () => {
  const first = paymentFingerprint(receipt);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, paymentFingerprint({ ...receipt }));
  assert.equal(first, paymentFingerprint({ ...receipt, customerId:null, note:undefined }));
});
test("amount, method, customer and linked booking are part of receipt identity", () => {
  const original = paymentFingerprint(receipt);
  for (const other of [
    {...receipt,amountJpy:7600},
    {...receipt,method:"paypay"},
    {...receipt,customerId:"different-customer"},
    {...receipt,appointmentId:"other-booking"},
    {...receipt,providerRef:"external-txn"},
    {...receipt,note:"cash received"},
  ]) assert.notEqual(original,paymentFingerprint(other));
});
test("refund operation and original payment bind the request key", () => {
  const refund={operation:"refund",originalPaymentId:"receipt-a",amountJpy:3000};
  assert.notEqual(paymentFingerprint(refund),paymentFingerprint({...refund,originalPaymentId:"receipt-b"}));
  assert.notEqual(paymentFingerprint(refund),paymentFingerprint({...refund,operation:"receipt"}));
});
test("timestamp normalization is stable for identical instant", () => {
  const a = paymentFingerprint({...receipt,paidAt:"2026-11-17T10:00:00+09:00"});
  const b = paymentFingerprint({...receipt,paidAt:"2026-11-17T01:00:00.000Z"});
  assert.equal(a,b);
  assert.notEqual(a,paymentFingerprint({...receipt,paidAt:"2026-11-17T01:00:01Z"}));
});
test("a legacy/invalid fingerprint never silently becomes a replay", () => {
  const fp=paymentFingerprint(receipt);
  assert.equal(paymentRetryDisposition(fp,fp),"replay");
  assert.equal(paymentRetryDisposition("another",fp),"conflict");
  assert.equal(paymentRetryDisposition(null,fp),"conflict");
});
