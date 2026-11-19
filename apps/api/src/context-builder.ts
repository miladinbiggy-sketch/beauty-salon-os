import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { schema, type Database } from "@salon/database";
import type { ScheduleContext, SchedulerService } from "@salon/scheduler";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  addDaysTokyo,
  tokyoDateOf,
  tokyoDayRangeMs,
  tokyoMs,
  weekdayOfTokyoDate,
  type ResourceType,
} from "@salon/shared";

const hhmm = (time: string) => time.slice(0, 5);

/**
 * 把数据库里某门店某一天（Tokyo 日期）的数据读成排单引擎快照。
 * 占用一律以 resource_allocations 为准（已含清洁缓冲），
 * 且只统计仍处于有效状态的预约（取消/爽约的占用行已被置为 inactive）。
 */
export async function buildContextForDate(
  db: Database,
  storeId: string,
  date: string,
): Promise<ScheduleContext> {
  const { startMs: dayStart, endMs: dayEnd } = tokyoDayRangeMs(date);
  const weekday = weekdayOfTokyoDate(date);

  const [hours] = await db
    .select()
    .from(schema.businessHours)
    .where(and(eq(schema.businessHours.storeId, storeId), eq(schema.businessHours.weekday, weekday)));

  let openMs = dayStart;
  let closeMs = dayStart; // 无营业时间记录或休息日 → 开=关，任何预约都会被判 outside_business_hours
  if (hours && !hours.isClosed) {
    openMs = tokyoMs(date, hhmm(hours.openTime));
    closeMs = tokyoMs(date, hhmm(hours.closeTime));
  }

  const [serviceRows, staffRows, resourceRows, shiftRows, blockedRows] = await Promise.all([
    db.select().from(schema.services).where(and(eq(schema.services.storeId, storeId), eq(schema.services.active, true))),
    db.select().from(schema.staff).where(and(eq(schema.staff.storeId, storeId), eq(schema.staff.active, true))),
    db.select().from(schema.resources).where(and(eq(schema.resources.storeId, storeId), eq(schema.resources.active, true))),
    db.select().from(schema.shifts).where(and(eq(schema.shifts.storeId, storeId), eq(schema.shifts.date, date))),
    db
      .select()
      .from(schema.blockedTimes)
      .where(
        and(
          eq(schema.blockedTimes.storeId, storeId),
          lte(schema.blockedTimes.startAt, new Date(dayEnd)),
          gte(schema.blockedTimes.endAt, new Date(dayStart)),
        ),
      ),
  ]);

  const staffIds = staffRows.map((s) => s.id);
  const skillRows = staffIds.length
    ? await db.select().from(schema.staffSkills).where(inArray(schema.staffSkills.staffId, staffIds))
    : [];
  const shiftIds = shiftRows.map((s) => s.id);
  const breakRows = shiftIds.length
    ? await db.select().from(schema.shiftBreaks).where(inArray(schema.shiftBreaks.shiftId, shiftIds))
    : [];

  const allocRows = await db
    .select({
      id: schema.resourceAllocations.id,
      appointmentId: schema.resourceAllocations.appointmentId,
      staffId: schema.resourceAllocations.staffId,
      resourceId: schema.resourceAllocations.resourceId,
      startAt: schema.resourceAllocations.startAt,
      endAt: schema.resourceAllocations.endAt,
    })
    .from(schema.resourceAllocations)
    .innerJoin(schema.appointments, eq(schema.resourceAllocations.appointmentId, schema.appointments.id))
    .where(
      and(
        eq(schema.appointments.storeId, storeId),
        eq(schema.resourceAllocations.active, true),
        inArray(schema.appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        lte(schema.resourceAllocations.startAt, new Date(dayEnd)),
        gte(schema.resourceAllocations.endAt, new Date(dayStart)),
      ),
    );

  const services = new Map<string, SchedulerService>();
  for (const s of serviceRows) {
    services.set(s.id, {
      id: s.id,
      durationMinutes: s.durationMinutes,
      bufferMinutes: s.bufferMinutes,
      resourceType: (s.resourceType as ResourceType | null) ?? null,
      priceJpy: s.priceJpy,
    });
  }

  const skillsByStaff = new Map<string, string[]>();
  for (const row of skillRows) {
    const arr = skillsByStaff.get(row.staffId) ?? [];
    arr.push(row.serviceId);
    skillsByStaff.set(row.staffId, arr);
  }

  const breaksByShift = new Map<string, { startMs: number; endMs: number }[]>();
  for (const b of breakRows) {
    const arr = breaksByShift.get(b.shiftId) ?? [];
    arr.push({ startMs: tokyoMs(date, hhmm(b.startTime)), endMs: tokyoMs(date, hhmm(b.endTime)) });
    breaksByShift.set(b.shiftId, arr);
  }

  return {
    storeOpenMs: openMs,
    storeCloseMs: closeMs,
    services,
    staff: staffRows.map((s) => ({ id: s.id, skillServiceIds: skillsByStaff.get(s.id) ?? [] })),
    resources: resourceRows.map((r) => ({ id: r.id, type: r.type as ResourceType })),
    shifts: shiftRows.map((s) => ({
      staffId: s.staffId,
      startMs: tokyoMs(date, hhmm(s.startTime)),
      endMs: tokyoMs(date, hhmm(s.endTime)),
      breaks: breaksByShift.get(s.id) ?? [],
    })),
    blocked: blockedRows.map((b) => ({
      staffId: b.staffId ?? undefined,
      resourceId: b.resourceId ?? undefined,
      startMs: b.startAt.getTime(),
      endMs: b.endAt.getTime(),
    })),
    staffBusy: allocRows
      .filter((a) => a.staffId)
      .map((a) => ({
        staffId: a.staffId!,
        appointmentId: a.appointmentId,
        startMs: a.startAt.getTime(),
        endMs: a.endAt.getTime(),
      })),
    resourceBusy: allocRows
      .filter((a) => a.resourceId)
      .map((a) => ({
        resourceId: a.resourceId!,
        appointmentId: a.appointmentId,
        startMs: a.startAt.getTime(),
        endMs: a.endAt.getTime(),
      })),
  };
}

/** 校验/预约只涉及单日；跨日窗口（周视图可用性）由 API 逐日调用。 */
export function datesBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  let d = fromDate;
  while (d <= toDate && out.length <= 62) {
    out.push(d);
    d = addDaysTokyo(d, 1);
  }
  return out;
}

export { tokyoDateOf };
