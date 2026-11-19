import { DateTime } from "luxon";
import { BUSINESS_TIMEZONE } from "./types.js";

/**
 * 时间工具：数据库存 UTC（timestamptz），一切“营业日 / 营业时间 / 排班”语义
 * 都按 Asia/Tokyo 计算。排单引擎内部只用 epoch 毫秒做区间运算，
 * 时区换算只发生在本模块与 API 边界层。
 */

export const TZ = BUSINESS_TIMEZONE;

export function nowMs(): number {
  return Date.now();
}

/** 把 Tokyo 当地日期（YYYY-MM-DD）+ 当地时间（HH:mm）换成 epoch 毫秒 */
export function tokyoMs(date: string, time: string): number {
  const dt = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", { zone: TZ });
  if (!dt.isValid) throw new Error(`Invalid Tokyo datetime: ${date} ${time} (${String(dt.invalidReason)})`);
  return dt.toMillis();
}

/** Tokyo 当地某日的 [00:00, 次日00:00) 毫秒区间 */
export function tokyoDayRangeMs(date: string): { startMs: number; endMs: number } {
  const start = DateTime.fromFormat(date, "yyyy-MM-dd", { zone: TZ });
  if (!start.isValid) throw new Error(`Invalid date: ${date}`);
  return { startMs: start.toMillis(), endMs: start.plus({ days: 1 }).toMillis() };
}

/** epoch 毫秒 → Tokyo 当地日期 YYYY-MM-DD */
export function tokyoDateOf(ms: number): string {
  return DateTime.fromMillis(ms, { zone: TZ }).toFormat("yyyy-MM-dd");
}

/** epoch 毫秒 → Tokyo 当地时间 HH:mm */
export function tokyoTimeOf(ms: number): string {
  return DateTime.fromMillis(ms, { zone: TZ }).toFormat("HH:mm");
}

/** epoch 毫秒 → ISO 字符串（UTC，带 Z） */
export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** ISO 字符串 → epoch 毫秒 */
export function fromIso(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Invalid ISO datetime: ${iso}`);
  return ms;
}

/** Tokyo 当地日期加减天数 */
export function addDaysTokyo(date: string, days: number): string {
  const d = DateTime.fromFormat(date, "yyyy-MM-dd", { zone: TZ });
  if (!d.isValid) throw new Error(`Invalid date: ${date}`);
  return d.plus({ days }).toFormat("yyyy-MM-dd");
}

/** Tokyo 当地日期是星期几：1=周一 … 7=周日（与 shifts.weekday 约定一致） */
export function weekdayOfTokyoDate(date: string): number {
  const d = DateTime.fromFormat(date, "yyyy-MM-dd", { zone: TZ });
  if (!d.isValid) throw new Error(`Invalid date: ${date}`);
  return d.weekday;
}

/** 今天（Tokyo）YYYY-MM-DD */
export function todayTokyo(): string {
  return DateTime.now().setZone(TZ).toFormat("yyyy-MM-dd");
}

/** 把 HH:mm 拆成当日分钟数 */
export function hhmmToMinutes(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Invalid HH:mm: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToHhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
