/**
 * Beauty Salon OS — 领域共享类型。
 * 前后端、排单引擎、数据库层共同使用，避免各层各自定义导致漂移。
 */

export const BUSINESS_TIMEZONE = "Asia/Tokyo" as const;

export type UserRole = "owner" | "manager" | "staff";

export type ServiceCategory = "nail" | "lash" | "beauty" | "other";

export type ResourceType = "nail_table" | "lash_bed" | "beauty_bed" | "chair" | "room";

/** 预约状态流转：booked → confirmed → arrived → in_service → completed；任意未完成状态可 → cancelled / no_show */
export type AppointmentStatus =
  | "booked"
  | "confirmed"
  | "arrived"
  | "in_service"
  | "completed"
  | "cancelled"
  | "no_show";

/** 仍占用技师/工位时间的状态（取消、爽约后立即释放） */
export const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  "booked",
  "confirmed",
  "arrived",
  "in_service",
  "completed",
] as const;

export type PaymentStatus = "paid" | "refunded" | "partially_refunded";

/** 只做记录，不保存任何银行卡敏感信息；card 仅记录“已通过合规服务商收款”的外部凭证号 */
export type PaymentMethod = "cash" | "card" | "paypay" | "line_pay" | "bank_transfer" | "other";

export type BlockedTimeType = "leave" | "sick" | "training" | "maintenance" | "other";

export type NotificationChannel = "line" | "email" | "sms" | "mock";
export type NotificationType =
  | "booking_created"
  | "booking_cancelled"
  | "booking_rescheduled"
  | "reminder_1day"
  | "reminder_3hours";
export type NotificationStatus = "queued" | "sending" | "sent" | "failed" | "skipped";

export type Locale = "zh-CN" | "ja";
export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-CN", "ja"] as const;

export interface StoreSettings {
  /** 预约提醒开关与提前量（分钟） */
  reminderOffsetsMinutes: number[];
  /** 顾客可提前预约的天数 */
  bookingWindowDays: number;
  /** 顾客最晚可提前多少分钟预约 */
  minLeadMinutes: number;
  /** 顾客可免费取消的截止：开始前多少分钟 */
  freeCancelBeforeMinutes: number;
  /** 排单时间粒度（分钟） */
  slotStepMinutes: number;
  /** LINE 官方账号是否已配置（仅标记，密钥不下发前端） */
  lineConfigured: boolean;
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  reminderOffsetsMinutes: [24 * 60, 3 * 60],
  bookingWindowDays: 60,
  minLeadMinutes: 60,
  freeCancelBeforeMinutes: 24 * 60,
  slotStepMinutes: 15,
  lineConfigured: false,
};

/** 以分为单位的金额一律用整数日元，避免浮点误差 */
export type JpyAmount = number;

export interface TimeRangeMs {
  startMs: number;
  endMs: number;
}

export function rangesOverlap(a: TimeRangeMs, b: TimeRangeMs): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}
