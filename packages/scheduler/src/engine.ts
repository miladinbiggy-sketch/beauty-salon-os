import { rangesOverlap, type TimeRangeMs } from "@salon/shared";
import type {
  AvailabilityOption,
  ComboPlan,
  Conflict,
  ScheduleContext,
  ValidationResult,
} from "./types.js";

const MIN = 60_000;

/**
 * 把顾客选择的多个项目排成连续时间链：
 * 段与段之间插入上一段的清洁缓冲（技师做完一个项目要先清洁工位再接下一个），
 * 最后一段的缓冲计入占用但不计入顾客在店时长。
 */
export function planCombo(ctx: ScheduleContext, serviceIds: readonly string[]): ComboPlan | null {
  if (serviceIds.length === 0) return null;
  const segments: ComboPlan["segments"] = [];
  let cursor = 0;
  let totalPriceJpy = 0;
  for (const id of serviceIds) {
    const svc = ctx.services.get(id);
    if (!svc) return null;
    segments.push({
      serviceId: id,
      offsetStartMin: cursor,
      durationMinutes: svc.durationMinutes,
      bufferMinutes: svc.bufferMinutes,
      resourceType: svc.resourceType,
      priceJpy: svc.priceJpy,
    });
    totalPriceJpy += svc.priceJpy;
    cursor += svc.durationMinutes + svc.bufferMinutes;
  }
  const last = segments[segments.length - 1]!;
  return {
    segments,
    customerMinutes: last.offsetStartMin + last.durationMinutes,
    blockedMinutes: cursor,
    totalPriceJpy,
  };
}

interface PlacementRequest {
  staffId: string;
  serviceIds: readonly string[];
  startMs: number;
  /** 改期时排除自身（自己的旧占用不算冲突） */
  ignoreAppointmentId?: string;
}

/**
 * 核心校验：判断“某技师在 startMs 开始做这组项目”是否可行。
 * 规则（与产品规格一一对应）：
 *  1. 技师必须具备全部项目的技能；
 *  2. 服务时段必须落在营业时间内；
 *  3. 服务时段必须被某个班次覆盖，且不压午休；
 *  4. 服务时段不与请假/不可预约时间重叠；
 *  5. 技师占用区间（含缓冲）不与其他预约的占用区间重叠；
 *  6. 每个需要工位的段，都必须能分到一台全程（含缓冲）空闲的同类型工位，
 *     且该工位不在维护封锁中。
 * 缓冲尾巴允许越过班次结束/打烊/午休开始（做完后的清洁是常态），
 * 但不允许与其他预约的占用重叠。
 */
export function validatePlacement(ctx: ScheduleContext, req: PlacementRequest): ValidationResult {
  const conflicts: Conflict[] = [];
  const plan = planCombo(ctx, req.serviceIds);
  if (!plan) return { ok: false, conflicts: [{ code: "invalid_services" }] };

  const staff = ctx.staff.find((s) => s.id === req.staffId);
  if (!staff) return { ok: false, conflicts: [{ code: "staff_not_found" }] };

  for (const id of req.serviceIds) {
    if (!staff.skillServiceIds.includes(id)) {
      conflicts.push({ code: "skill_missing", serviceId: id });
    }
  }
  if (conflicts.length > 0) return { ok: false, conflicts };

  const startMs = req.startMs;
  const customerEndMs = startMs + plan.customerMinutes * MIN;
  const blockedEndMs = startMs + plan.blockedMinutes * MIN;
  const serviceRange: TimeRangeMs = { startMs, endMs: customerEndMs };
  const blockedRange: TimeRangeMs = { startMs, endMs: blockedEndMs };

  // 2. 营业时间（按顾客在店时段判断）
  if (startMs < ctx.storeOpenMs || customerEndMs > ctx.storeCloseMs) {
    conflicts.push({ code: "outside_business_hours" });
  }

  // 3. 班次与午休
  const shift = ctx.shifts.find(
    (s) => s.staffId === req.staffId && s.startMs <= startMs && customerEndMs <= s.endMs,
  );
  if (!shift) {
    conflicts.push({ code: "staff_not_working" });
  } else if (shift.breaks.some((b) => rangesOverlap(b, serviceRange))) {
    conflicts.push({ code: "staff_on_break" });
  }

  // 4. 请假 / 不可预约
  if (
    ctx.blocked.some(
      (b) => b.staffId === req.staffId && rangesOverlap(b, serviceRange),
    )
  ) {
    conflicts.push({ code: "staff_blocked" });
  }

  // 5. 技师占用冲突（含缓冲对含缓冲）
  const staffClash = ctx.staffBusy.find(
    (b) =>
      b.staffId === req.staffId &&
      b.appointmentId !== req.ignoreAppointmentId &&
      rangesOverlap(b, blockedRange),
  );
  if (staffClash) {
    conflicts.push({ code: "staff_busy", conflictingAppointmentId: staffClash.appointmentId });
  }

  // 6. 工位分配（逐段贪心：取第一台全程空闲的同类型工位）
  const resourceIds: (string | null)[] = [];
  const tentative: { resourceId: string; startMs: number; endMs: number }[] = [];
  for (const seg of plan.segments) {
    if (!seg.resourceType) {
      resourceIds.push(null);
      continue;
    }
    const segRange: TimeRangeMs = {
      startMs: startMs + seg.offsetStartMin * MIN,
      endMs: startMs + (seg.offsetStartMin + seg.durationMinutes + seg.bufferMinutes) * MIN,
    };
    const candidates = ctx.resources.filter((r) => r.type === seg.resourceType);
    let chosen: string | null = null;
    let blockedByMaintenance = false;
    for (const res of candidates) {
      const maintenance = ctx.blocked.some(
        (b) => b.resourceId === res.id && rangesOverlap(b, segRange),
      );
      if (maintenance) {
        blockedByMaintenance = true;
        continue;
      }
      const busy = ctx.resourceBusy.some(
        (b) =>
          b.resourceId === res.id &&
          b.appointmentId !== req.ignoreAppointmentId &&
          rangesOverlap(b, segRange),
      );
      const selfBusy = tentative.some((t) => t.resourceId === res.id && rangesOverlap(t, segRange));
      if (!busy && !selfBusy) {
        chosen = res.id;
        break;
      }
    }
    if (chosen) {
      tentative.push({ resourceId: chosen, ...segRange });
      resourceIds.push(chosen);
    } else {
      resourceIds.push(null);
      conflicts.push({
        code: blockedByMaintenance && candidates.length > 0 ? "resource_blocked" : "resource_busy",
        serviceId: seg.serviceId,
        resourceType: seg.resourceType,
      });
    }
  }

  if (conflicts.length > 0) return { ok: false, conflicts };
  return { ok: true, plan, resourceIds, customerEndMs, blockedEndMs };
}

export interface AvailabilityRequest {
  serviceIds: readonly string[];
  /** 指定技师；不指定则所有具备技能的技师都参与 */
  staffId?: string;
  /** 搜索窗口（毫秒）：开始时间不早于 windowStartMs，顾客离店不晚于 windowEndMs */
  windowStartMs: number;
  windowEndMs: number;
  stepMinutes: number;
  maxResults?: number;
}

/**
 * 计算可预约时间点。步长网格以营业开始时间为锚点对齐，
 * 与 CS 类排单软件“整点/刻钟”网格一致，顾客端展示稳定。
 */
export function findAvailability(
  ctx: ScheduleContext,
  req: AvailabilityRequest,
): AvailabilityOption[] {
  const plan = planCombo(ctx, req.serviceIds);
  if (!plan) return [];
  const staffCandidates = ctx.staff.filter(
    (s) =>
      (!req.staffId || s.id === req.staffId) &&
      req.serviceIds.every((id) => s.skillServiceIds.includes(id)),
  );
  if (staffCandidates.length === 0) return [];

  const stepMs = Math.max(1, req.stepMinutes) * MIN;
  const customerMs = plan.customerMinutes * MIN;
  // 以营业开始为锚点对齐网格
  const firstStart =
    ctx.storeOpenMs +
    Math.max(0, Math.ceil((req.windowStartMs - ctx.storeOpenMs) / stepMs)) * stepMs;
  const lastStart = Math.min(req.windowEndMs, ctx.storeCloseMs) - customerMs;

  const options: AvailabilityOption[] = [];
  const max = req.maxResults ?? 500;
  for (let start = firstStart; start <= lastStart && options.length < max; start += stepMs) {
    for (const staff of staffCandidates) {
      const res = validatePlacement(ctx, {
        staffId: staff.id,
        serviceIds: req.serviceIds,
        startMs: start,
      });
      if (res.ok) {
        options.push({
          staffId: staff.id,
          startMs: start,
          customerEndMs: res.customerEndMs,
          blockedEndMs: res.blockedEndMs,
          resourceIds: res.resourceIds,
          totalPriceJpy: plan.totalPriceJpy,
        });
        if (options.length >= max) break;
      }
    }
  }
  options.sort((a, b) => a.startMs - b.startMs || a.staffId.localeCompare(b.staffId));
  return options;
}
