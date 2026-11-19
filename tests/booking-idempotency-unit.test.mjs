import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingFingerprint } from "../apps/api/src/services/booking-idempotency.ts";
const booking = {
  storeId: "A", source: "online", customerName: "顾客", customerPhone: "09012341234",
  staffId: "S", startMs: 1795055000000, locale: "ja",
  selections: [{ serviceId: "nail", addonIds: ["design", "care"] }],
};
test("identical retries create an identical 64 hex fingerprint", () => {
  const a = bookingFingerprint(booking);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, bookingFingerprint({ ...booking }));
});
test("addon ordering is immaterial, but service/slot/customer changes are not", () => {
  const a = bookingFingerprint(booking);
  assert.equal(a, bookingFingerprint({ ...booking, selections: [{ serviceId: "nail", addonIds: ["care", "design"] }] }));
  assert.notEqual(a, bookingFingerprint({ ...booking, startMs: booking.startMs + 60000 }));
  assert.notEqual(a, bookingFingerprint({ ...booking, customerPhone: "09012349999" }));
  assert.notEqual(a, bookingFingerprint({ ...booking, selections: [{ serviceId: "lash" }] }));
});
test("actor and source are bound to the idempotency key", () => {
  const a = bookingFingerprint(booking);
  assert.notEqual(a, bookingFingerprint({ ...booking, actorUserId: "manager" }));
  assert.notEqual(a, bookingFingerprint({ ...booking, source: "walkin" }));
});
