/**
 * Weekly business-hours changes must not strand confirmed customers.
 * The booking engine checks customer end time, not cleanup buffer, against closing time.
 */
export interface WeeklyHour {
  weekday: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Require one real, ordered, local time window per day; no overnight windows. */
export function validWeeklyHours(hours: readonly WeeklyHour[]): boolean {
  if (hours.length !== 7 || new Set(hours.map((h) => h.weekday)).size !== 7) return false;
  return hours.every((h) =>
    Number.isInteger(h.weekday) && h.weekday >= 1 && h.weekday <= 7 &&
    HHMM.test(h.openTime) && HHMM.test(h.closeTime) &&
    (h.isClosed || h.openTime < h.closeTime),
  );
}

/** Widening hours is non-destructive, narrowing/closing requires a booked-customer check. */
export function narrowsBusinessHours(existing: WeeklyHour | undefined, next: WeeklyHour): boolean {
  if (!existing || existing.isClosed) return false;
  if (next.isClosed) return true;
  return next.openTime > existing.openTime || next.closeTime < existing.closeTime;
}

/** Pure time-window check used in unit tests and the API's conflict semantics. */
export function violatesBusinessHours(
  booking: { startTime: string; customerEndTime: string },
  desired: WeeklyHour,
): boolean {
  return desired.isClosed || booking.startTime < desired.openTime || booking.customerEndTime > desired.closeTime;
}
