import type { AvailabilityOption, ScheduleContext } from "./types.js";
import { findAvailability, type AvailabilityRequest } from "./engine.js";

/** Deterministic, explainable soft ranking applied ONLY to valid available slots. */
export type RecommendationStrategy = "earliest" | "compact" | "balanced";
export type RecommendationReason = "earliest_slot" | "reduces_fragments" | "balanced_load" | "no_new_fragments";
export type RecommendedSlot = AvailabilityOption & {
  score: number;
  reasons: RecommendationReason[];
  metrics: { fragmentMinutes: number; occupiedMinutes: number; dailyLoadPercent: number };
};

const MINUTE = 60_000;

/** Calculate minutes of unsellable gaps in the supplied working intervals. */
export function fragmentMinutes(
  open: number,
  close: number,
  busy: readonly { startMs: number; endMs: number }[],
  minSellableMinutes = 45,
): number {
  const ranges = busy
    .map((b) => ({ startMs: Math.max(open, b.startMs), endMs: Math.min(close, b.endMs) }))
    .filter((r) => r.startMs < r.endMs)
    .sort((a, b) => a.startMs - b.startMs);
  let cursor = open;
  let lost = 0;
  for (const range of ranges) {
    const gap = (range.startMs - cursor) / MINUTE;
    if (gap > 0 && gap < minSellableMinutes) lost += gap;
    cursor = Math.max(cursor, range.endMs);
  }
  const tail = (close - cursor) / MINUTE;
  if (tail > 0 && tail < minSellableMinutes) lost += tail;
  return Math.round(lost);
}

export interface RecommendRequest extends AvailabilityRequest {
  strategy?: RecommendationStrategy;
  /** Default 45 minutes, configurable by shop. */
  minSellableMinutes?: number;
  /** Number of ranked results to return. */
  limit?: number;
}

/**
 * No external AI and no speculative capacity: findAvailability performs all hard checks.
 * Rankings are hints, not reservations; the booking API MUST revalidate inside its transaction.
 */
export function recommendAvailability(ctx: ScheduleContext, req: RecommendRequest): RecommendedSlot[] {
  const strategy = req.strategy ?? "compact";
  const minSellable = Math.max(5, Math.min(req.minSellableMinutes ?? 45, 240));
  const limit = Math.max(1, Math.min(req.limit ?? 8, 30));
  const valid = findAvailability(ctx, { ...req, maxResults: Math.min(5000, req.maxResults ?? 2000) });
  const earliest = valid[0]?.startMs ?? ctx.storeOpenMs;
  const totals = new Map<string, { busyMinutes: number; workingMinutes: number; intervals: { startMs: number; endMs: number }[] }>();

  for (const staff of ctx.staff) {
    const shifts = ctx.shifts.filter((s) => s.staffId === staff.id);
    const workingMinutes = shifts.reduce((sum, s) => sum + Math.max(0, (s.endMs - s.startMs) / MINUTE), 0);
    const intervals = [
      ...ctx.staffBusy.filter((b) => b.staffId === staff.id),
      ...ctx.blocked.filter((b) => b.staffId === staff.id),
      ...shifts.flatMap((s) => s.breaks),
    ];
    // Sum existing busy time clipped to business hours; do not count absent shift time as load.
    const busyMinutes = ctx.staffBusy.filter((b) => b.staffId === staff.id).reduce((sum, b) => {
      return sum + Math.max(0, Math.min(b.endMs, ctx.storeCloseMs) - Math.max(b.startMs, ctx.storeOpenMs)) / MINUTE;
    }, 0);
    totals.set(staff.id, { busyMinutes, workingMinutes, intervals });
  }

  return valid.map((slot) => {
    const { busyMinutes, workingMinutes, intervals } = totals.get(slot.staffId) ?? { busyMinutes: 0, workingMinutes: 0, intervals: [] };
    const before = fragmentMinutes(ctx.storeOpenMs, ctx.storeCloseMs, intervals, minSellable);
    const after = fragmentMinutes(ctx.storeOpenMs, ctx.storeCloseMs, [...intervals, { startMs: slot.startMs, endMs: slot.blockedEndMs }], minSellable);
    const fragmentationDelta = before - after;
    const newFragments = Math.max(0, after - before);
    const currentLoad = workingMinutes > 0 ? Math.min(1, busyMinutes / workingMinutes) : 1;
    const minutesFromEarliest = Math.max(0, (slot.startMs - earliest) / MINUTE);
    const earliestScore = Math.max(0, 100 - minutesFromEarliest / 10);
    // Soft objectives only. No score can override a hard scheduling conflict.
    const compactScore = Math.max(0, Math.min(100, 65 + fragmentationDelta * 0.75));
    const balancedScore = Math.max(0, 100 - currentLoad * 100);
    const score = strategy === "earliest"
      ? 0.75 * earliestScore + 0.15 * compactScore + 0.10 * balancedScore
      : strategy === "balanced"
        ? 0.15 * earliestScore + 0.15 * compactScore + 0.70 * balancedScore
        : 0.15 * earliestScore + 0.70 * compactScore + 0.15 * balancedScore;
    const reasons: RecommendationReason[] = [];
    if (slot.startMs === earliest) reasons.push("earliest_slot");
    if (fragmentationDelta > 0) reasons.push("reduces_fragments");
    if (currentLoad <= 0.4) reasons.push("balanced_load");
    if (!newFragments) reasons.push("no_new_fragments");
    return {
      ...slot,
      score: Math.round(score * 100) / 100,
      reasons,
      metrics: {
        fragmentMinutes: after,
        occupiedMinutes: Math.round(busyMinutes),
        dailyLoadPercent: workingMinutes > 0 ? Math.min(100, Math.round((busyMinutes / workingMinutes) * 100)) : 100,
      },
    };
  }).sort((a, b) => b.score - a.score || a.startMs - b.startMs || a.staffId.localeCompare(b.staffId)).slice(0, limit);
}
