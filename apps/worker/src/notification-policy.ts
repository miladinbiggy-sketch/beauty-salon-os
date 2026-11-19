/** Pure booking-state gate, evaluated immediately before attempting delivery.
 * This does not remove the unavoidable race between checking and an external
 * provider accepting the message. It suppresses already-known stale notices.
 */
export type NotificationGate = { allowed: true } | { allowed: false; reason: string };
const UPCOMING = new Set(["booked", "confirmed"]);
const ACTIVE_NOTICES = new Set(["booking_created", "booking_rescheduled", "reminder_1day", "reminder_3hours"]);

export function shouldSendBookingNotice(input: {
  type: string;
  status: string | null;
  payloadStartAt: string | undefined;
  currentStartAtMs: number | null;
  nowMs: number;
}): NotificationGate {
  const { type, status, payloadStartAt, currentStartAtMs, nowMs } = input;
  if (status === null || currentStartAtMs === null) return { allowed: false, reason: "appointment missing" };
  if (type === "booking_cancelled") {
    return status === "cancelled" ? { allowed: true } : { allowed: false, reason: "appointment is not cancelled" };
  }
  if (!ACTIVE_NOTICES.has(type)) return { allowed: false, reason: "unknown notification type" };
  if (!UPCOMING.has(status)) return { allowed: false, reason: `appointment no longer upcoming (${status})` };
  const claimedStartMs = typeof payloadStartAt === "string" ? Date.parse(payloadStartAt) : NaN;
  if (!Number.isFinite(claimedStartMs) || claimedStartMs !== currentStartAtMs) {
    return { allowed: false, reason: "booking time changed after notice was queued" };
  }
  if (type.startsWith("reminder_") && currentStartAtMs <= nowMs) {
    return { allowed: false, reason: "reminder expired after appointment start" };
  }
  return { allowed: true };
}

/** Automatic LINE replay must finish safely within the provider's 24h dedupe window. */
export function retryDisposition(input: {
  attempts: number;
  firstAttemptMs: number | null;
  nowMs: number;
  permanent: boolean;
  maxAttempts?: number;
}): "retry" | "failed" {
  if (input.permanent || input.attempts >= (input.maxAttempts ?? 3)) return "failed";
  if (input.firstAttemptMs === null || !Number.isFinite(input.firstAttemptMs)) return "failed";
  const delayMs = 60_000 * input.attempts;
  return input.nowMs + delayMs - input.firstAttemptMs < 23 * 3_600_000 ? "retry" : "failed";
}
