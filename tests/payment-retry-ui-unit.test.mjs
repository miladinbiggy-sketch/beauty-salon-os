import { test } from "node:test";
import assert from "node:assert/strict";
import { nextPaymentRetryHandle } from "../apps/admin-web/src/lib/payment-retry.ts";

let n=0;
const newUuid=()=>`payment-key-${++n}`;
test("network timeout retries reuse the exact same operation UUID",()=>{
  const intent={amountJpy:7300,method:"card",appointmentId:"appt-one"};
  const first=nextPaymentRetryHandle(null,intent,newUuid);
  const retry=nextPaymentRetryHandle(first,{...intent},newUuid);
  assert.equal(first.key,retry.key);
  assert.equal(n,1);
});
test("editing amount or refund target generates another UUID",()=>{
  const a=nextPaymentRetryHandle(null,{amountJpy:3000,originalPaymentId:"p1"},newUuid);
  const b=nextPaymentRetryHandle(a,{amountJpy:3500,originalPaymentId:"p1"},newUuid);
  const c=nextPaymentRetryHandle(b,{amountJpy:3500,originalPaymentId:"p2"},newUuid);
  assert.notEqual(a.key,b.key);
  assert.notEqual(b.key,c.key);
});
test("successful confirmation clears handle, so a separate identical sale gets a fresh UUID",()=>{
  const intent={amountJpy:1000,method:"cash"};
  const first=nextPaymentRetryHandle(null,intent,newUuid);
  const second=nextPaymentRetryHandle(null,intent,newUuid);
  assert.notEqual(first.key,second.key);
});
