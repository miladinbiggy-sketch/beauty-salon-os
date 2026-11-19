/** Deterministic, dependency-free checks for local Japan schedules and temporary blocks. */
export interface ShiftBreakInput {
  startTime: string;
  endTime: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function minutes(time: string): number {
  if (!HHMM.test(time)) throw new Error("Time must be HH:mm");
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Tokyo date is a real Gregorian calendar day (not only a regex match). */
export function assertBusinessDate(date: string): void {
  const match = DATE.exec(date);
  if (!match) throw new Error("Date must be YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || year > 2100 || utc.getUTCFullYear() !== year || utc.getUTCMonth() + 1 !== month || utc.getUTCDate() !== day) {
    throw new Error("Invalid business date");
  }
}

/** Overnight shifts are intentionally unsupported. Breaks must be inside and disjoint. */
export function assertShiftWindow(startTime: string, endTime: string, breaks: readonly ShiftBreakInput[] = []): void {
  const start = minutes(startTime);
  const end = minutes(endTime);
  if (start >= end) throw new Error("Shift must end after it begins (overnight shifts are not supported)");
  let previous = start;
  for (const interval of [...breaks].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    const bStart = minutes(interval.startTime);
    const bEnd = minutes(interval.endTime);
    if (bStart >= bEnd || bStart < start || bEnd > end || bStart < previous) {
      throw new Error("Shift breaks must be inside the shift and must not overlap");
    }
    previous = bEnd;
  }
}

/** Bound resource downtime so accidental multi-year/past-infinity blocks cannot disable a store. */
export function assertBlockedWindow(startMs: number, endMs: number): void {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    throw new Error("endAt must be after startAt");
  }
  if (endMs - startMs > DAY_MS * 366) {
    throw new Error("A blocked time cannot exceed 366 days");
  }
}
