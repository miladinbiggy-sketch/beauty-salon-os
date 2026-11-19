import { describe, expect, it } from "vitest";
import { fragmentMinutes, recommendAvailability } from "./recommend.js";
import type { ScheduleContext } from "./types.js";
const M = 60000;
const createCtx = (): ScheduleContext => ({
  storeOpenMs: 0,
  storeCloseMs: 480 * M,
  services: new Map([["nail", { id: "nail", durationMinutes: 60, bufferMinutes: 0, priceJpy: 5000, resourceType: null }]]),
  staff: [{ id: "a", skillServiceIds: ["nail"] }, { id: "b", skillServiceIds: ["nail"] }],
  resources: [],
  shifts: [{ staffId: "a", startMs: 0, endMs: 480 * M, breaks: [] }, { staffId: "b", startMs: 0, endMs: 480 * M, breaks: [] }],
  blocked: [],
  staffBusy: [{ staffId: "a", appointmentId: "existing", startMs: 60 * M, endMs: 180 * M }],
  resourceBusy: [],
});
describe("V2 explainable recommendations", () => {
  it("counts unbookable gaps, merging overlaps", () => {
    expect(fragmentMinutes(0, 180*M, [{startMs:20*M,endMs:60*M},{startMs:50*M,endMs:120*M}],45)).toBe(20);
  });
  it("never recommends a hard-conflicting slot", () => {
    const results = recommendAvailability(createCtx(), { serviceIds: ["nail"], strategy: "compact", windowStartMs: 0, windowEndMs: 480*M, stepMinutes: 30 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(x => !(x.staffId === "a" && x.startMs < 180*M && x.blockedEndMs > 60*M))).toBe(true);
    expect(results.every(x => x.score >= 0 && x.score <= 100)).toBe(true);
  });
  it("balanced strategy prioritizes a less occupied employee at same time", () => {
    const results = recommendAvailability(createCtx(), { serviceIds: ["nail"], strategy: "balanced", windowStartMs: 180*M, windowEndMs: 360*M, stepMinutes: 60, limit: 20 });
    const at = results.filter(x => x.startMs === 180*M);
    expect(at.length).toBe(2);
    expect(at[0]?.staffId).toBe("b");
  });
  it("respects result caps and only uses existing valid options", () => {
    const results = recommendAvailability(createCtx(), { serviceIds: ["nail"], strategy: "earliest", windowStartMs: 0, windowEndMs: 480*M, stepMinutes: 60, limit: 3 });
    expect(results).toHaveLength(3);
    expect(results[0]?.startMs).toBe(0);
  });
});
