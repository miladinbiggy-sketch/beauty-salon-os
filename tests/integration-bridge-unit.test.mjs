import test from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDERS, isProviderId, parseIntegrationKeys, integrationKey,
  signedPayload, verifySignedPayload, eventDigest, csvCell, bookingCsv,
} from "../apps/api/src/services/integration-contract.ts";

const store = "11111111-1111-4111-8111-111111111111";
const secretHex = "bd".repeat(32);
const secret = Buffer.from(secretHex, "hex");
const keyMap = JSON.stringify({ [`${store}:cn_meituan`]: secretHex });
const raw = Buffer.from(JSON.stringify({ eventId: "ev0001", bookingRef: "book-1" }));
const timestamp = 1795050000;

test("provider registry covers JP and CN with no claim of native connectivity", () => {
  assert.ok(PROVIDERS.some((p) => p.country === "JP"));
  assert.ok(PROVIDERS.some((p) => p.country === "CN"));
  assert.equal(isProviderId("jp_salonboard"), true);
  assert.equal(isProviderId("cn_meituan"), true);
  assert.equal(isProviderId("unknown_network"), false);
});
test("valid strict env key map provides per-store HMAC key", () => {
  const keys = parseIntegrationKeys(keyMap);
  assert.deepEqual(integrationKey(keys, store, "cn_meituan"), secret);
  assert.equal(integrationKey(keys, store, "jp_csnext"), null);
  assert.equal(integrationKey(keys, "22222222-2222-4222-8222-222222222222", "cn_meituan"), null);
});
test("reject config of short keys, typos and malformed JSON", () => {
  assert.throws(() => parseIntegrationKeys("invalid"));
  assert.throws(() => parseIntegrationKeys(JSON.stringify({ [`${store}:cn_meituan`]: "123" })));
  assert.throws(() => parseIntegrationKeys(JSON.stringify({ [`${store}:invented`]: secretHex })));
});
test("valid signature is accepted only during the five-minute window", () => {
  const sig = "sha256=" + signedPayload(secret, timestamp, raw);
  assert.equal(verifySignedPayload(secret, String(timestamp), sig, raw, timestamp * 1000), true);
  assert.equal(verifySignedPayload(secret, String(timestamp), sig, raw, (timestamp + 300) * 1000), true);
  assert.equal(verifySignedPayload(secret, String(timestamp), sig, raw, (timestamp + 301) * 1000), false);
});
test("tampered event body, timestamp, or signature fails", () => {
  const sig = "sha256=" + signedPayload(secret, timestamp, raw);
  assert.equal(verifySignedPayload(secret, String(timestamp), sig, Buffer.from("{}"), timestamp * 1000), false);
  assert.equal(verifySignedPayload(secret, String(timestamp + 1), sig, raw, timestamp * 1000), false);
  assert.equal(verifySignedPayload(secret, String(timestamp), sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0"), raw, timestamp * 1000), false);
  assert.equal(verifySignedPayload(null, String(timestamp), sig, raw, timestamp * 1000), false);
});
test("fingerprint changes with different bytes", () => {
  assert.match(eventDigest(raw), /^[0-9a-f]{64}$/);
  assert.notEqual(eventDigest(raw), eventDigest(Buffer.from("{}")));
});
test("CSV escapes formula injection, quotation marks and commas", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("\t+1"), '"\'\t+1"');
});
test("CSV excludes customer PII even if source object contains it", () => {
  const csv = bookingCsv([{id: "id1", bookingCode: "TEST123", source: "admin", status: "booked", startAt: new Date("2027-05-12T05:00:00Z"), endAt: new Date("2027-05-12T06:00:00Z"), staffId: "staff-1", customerName: "SECRET CUSTOMER", phone: "080xxx"}]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("TEST123"));
  assert.ok(!csv.includes("SECRET CUSTOMER"));
  assert.ok(!csv.includes("080xxx"));
});
