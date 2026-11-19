import type { ResourceType, TimeRangeMs } from "@salon/shared";

/**
 * 排单引擎的输入快照。引擎是纯函数：API 层在数据库事务内把某门店某时间窗的
 * 相关数据（排班、请假、已有预约、工位）读成快照，引擎只做区间运算，
 * 不碰数据库、不读时钟 —— 因此可完整单测，并发安全由事务 + 数据库约束兜底。
 */

export interface SchedulerService {
  id: string;
  durationMinutes: number;
  /** 服务结束后的清洁缓冲（分钟）：期间技师与工位仍被占用 */
  bufferMinutes: number;
  resourceType: ResourceType | null;
  priceJpy: number;
}

export interface SchedulerStaff {
  id: string;
  skillServiceIds: readonly string[];
}

export interface SchedulerResource {
  id: string;
  type: ResourceType;
}

export interface ShiftWindow extends TimeRangeMs {
  staffId: string;
  breaks: TimeRangeMs[];
}

/** 不可预约时间：员工请假（staffId）或工位维护（resourceId），二选一 */
export interface BlockedWindow extends TimeRangeMs {
  staffId?: string;
  resourceId?: string;
}

/** 已有预约对技师的占用（含清洁缓冲的完整占用区间） */
export interface StaffBusy extends TimeRangeMs {
  staffId: string;
  appointmentId: string;
}

/** 已有预约对工位的占用（含清洁缓冲） */
export interface ResourceBusy extends TimeRangeMs {
  resourceId: string;
  appointmentId: string;
}

export interface ScheduleContext {
  storeOpenMs: number;
  storeCloseMs: number;
  services: ReadonlyMap<string, SchedulerService>;
  staff: readonly SchedulerStaff[];
  resources: readonly SchedulerResource[];
  shifts: readonly ShiftWindow[];
  blocked: readonly BlockedWindow[];
  staffBusy: readonly StaffBusy[];
  resourceBusy: readonly ResourceBusy[];
}

/** 组合服务的一个段：按顾客选择顺序连续排布 */
export interface ComboSegment {
  serviceId: string;
  /** 相对预约开始的偏移（分钟） */
  offsetStartMin: number;
  durationMinutes: number;
  bufferMinutes: number;
  resourceType: ResourceType | null;
  priceJpy: number;
}

export interface ComboPlan {
  segments: ComboSegment[];
  /** 顾客实际在店时长（到最后一个项目结束，不含尾部清洁缓冲） */
  customerMinutes: number;
  /** 技师/工位被完整占用的时长（含尾部清洁缓冲） */
  blockedMinutes: number;
  totalPriceJpy: number;
}

export type ConflictCode =
  | "invalid_services"
  | "staff_not_found"
  | "skill_missing"
  | "outside_business_hours"
  | "staff_not_working"
  | "staff_on_break"
  | "staff_blocked"
  | "staff_busy"
  | "resource_busy"
  | "resource_blocked";

export interface Conflict {
  code: ConflictCode;
  serviceId?: string;
  resourceType?: ResourceType;
  conflictingAppointmentId?: string;
}

export type ValidationResult =
  | {
      ok: true;
      plan: ComboPlan;
      /** 与 segments 一一对应：分配到的工位 id（不需要工位时为 null） */
      resourceIds: (string | null)[];
      customerEndMs: number;
      blockedEndMs: number;
    }
  | { ok: false; conflicts: Conflict[] };

export interface AvailabilityOption {
  staffId: string;
  startMs: number;
  customerEndMs: number;
  blockedEndMs: number;
  resourceIds: (string | null)[];
  totalPriceJpy: number;
}
