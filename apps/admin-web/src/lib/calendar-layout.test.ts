import { describe, expect, it } from "vitest";
import { computeAppointmentLanes } from "./calendar-layout";
const at = (hour: number, min = 0) => new Date(Date.UTC(2027, 0, 4, hour, min)).toISOString();
const row = (id: string, from: number, to: number) => ({ id, startAt: at(from), endAt: at(to) });

describe("calendar overlapping cards", () => {
  it("puts concurrent appointments into distinct columns", () => {
    const lanes = computeAppointmentLanes([row("a", 10, 12), row("b", 10, 11), row("c", 11, 12)]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("c")).toEqual({ lane: 1, lanes: 2 });
  });
  it("does not treat adjacent appointments as overlapping", () => {
    const lanes = computeAppointmentLanes([row("a", 10, 11), row("b", 11, 12)]);
    expect(lanes.get("a")?.lanes).toBe(1);
    expect(lanes.get("b")?.lanes).toBe(1);
  });
  it("restores full width after a collision cluster", () => {
    const lanes = computeAppointmentLanes([row("a", 10, 12), row("b", 11, 13), row("c", 14, 15)]);
    expect(lanes.get("c")).toEqual({ lane: 0, lanes: 1 });
  });
  it("allocates the same result regardless of input order", () => {
    const a = [row("a", 10, 12), row("b", 10, 11), row("c", 11, 12)];
    expect([...computeAppointmentLanes(a)]).toEqual([...computeAppointmentLanes([...a].reverse())]);
  });
});
