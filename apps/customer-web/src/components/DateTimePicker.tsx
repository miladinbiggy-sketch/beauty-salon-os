import { useEffect, useMemo, useState } from "react";
import type { MessageKey } from "@salon/i18n";
import { addDaysTokyo, fromIso, tokyoTimeOf, todayTokyo, weekdayOfTokyoDate } from "@salon/shared";
import { api, type AvailabilityOption, type Selection, type StoreInfo } from "../lib/api";
import { useLocale } from "../lib/i18n";

interface DateTimePickerProps {
  store: StoreInfo;
  selections: Selection[];
  /** 指定技师时只查该技师；不指定则查全部并按开始时间去重 */
  staffId?: string;
  selectedStartAt: string | null;
  onSelect: (option: AvailabilityOption | null) => void;
  /** 变化时强制重新拉取可用时间（如 409 冲突后刷新） */
  refreshKey?: number;
  /** 当前选中日期变化时通知父组件（如等候名单登记需要日期） */
  onDateChange?: (date: string) => void;
  /** 当前日期的可约时段数量变化时通知父组件 */
  onAvailabilityChange?: (count: number) => void;
}

interface DayOption {
  date: string;
  weekday: number;
  closed: boolean;
}

/**
 * 日期条 + 空闲时间片选择。日期范围 = 今天起 bookingWindowDays 天，
 * 休息日（businessHours.isClosed 或无记录）禁用。时间按 Asia/Tokyo 显示。
 */
export function DateTimePicker({
  store,
  selections,
  staffId,
  selectedStartAt,
  onSelect,
  refreshKey = 0,
  onDateChange,
  onAvailabilityChange,
}: DateTimePickerProps) {
  const { t, locale } = useLocale();

  const days = useMemo<DayOption[]>(() => {
    const byWeekday = new Map(store.businessHours.map((h) => [h.weekday, h]));
    const today = todayTokyo();
    const out: DayOption[] = [];
    for (let i = 0; i < store.booking.bookingWindowDays; i++) {
      const date = addDaysTokyo(today, i);
      const weekday = weekdayOfTokyoDate(date);
      const hours = byWeekday.get(weekday);
      out.push({ date, weekday, closed: !hours || hours.isClosed });
    }
    return out;
  }, [store]);

  const firstOpen = days.find((d) => !d.closed)?.date ?? days[0]?.date ?? todayTokyo();
  const [date, setDate] = useState<string>(firstOpen);
  const [options, setOptions] = useState<AvailabilityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  // 选择组合序列化后作为依赖，避免引用变化导致重复请求
  const selKey = JSON.stringify(selections);

  useEffect(() => { onDateChange?.(date); }, [date, onDateChange]);
  useEffect(() => { onAvailabilityChange?.(options.length); }, [options, onAvailabilityChange]);

  useEffect(() => {
    setDate((prev) => (days.some((d) => d.date === prev && !d.closed) ? prev : firstOpen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, firstOpen]);

  useEffect(() => {
    if (selections.length === 0) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    api
      .getAvailability({ storeId: store.id, date, selections: JSON.parse(selKey) as Selection[], staffId })
      .then((rows) => {
        if (cancelled) return;
        // 按开始时间去重（不指定技师时同一时间可能有多个技师可选）
        const byStart = new Map<string, AvailabilityOption>();
        for (const row of rows) if (!byStart.has(row.startAt)) byStart.set(row.startAt, row);
        setOptions([...byStart.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)));
      })
      .catch(() => {
        if (!cancelled) {
          setOptions([]);
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, date, selKey, staffId, refreshKey, retry]);

  return (
    <div className="min-w-0">
      {/* 日期条 */}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {days.map((d) => {
          const [, month, day] = d.date.split("-");
          const active = d.date === date;
          return (
            <button
              key={d.date}
              type="button"
              disabled={d.closed}
              onClick={() => {setDate(d.date);setOptions([]);onSelect(null);}}
              className={`flex min-h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl border text-center transition ${
                d.closed
                  ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                  : active
                    ? "border-transparent bg-[#8f596b] text-white shadow-md shadow-[#ebced1]"
                    : "border-[#eee1df] bg-white text-[#7a6266] hover:border-[#8f596b]"
              }`}
            >
              <span className="text-[11px] leading-tight">
                {Number(month)}/{Number(day)}
              </span>
              <span className="text-sm font-semibold leading-tight">
                {t(`weekday.${d.weekday}` as MessageKey).replace("周", "")}
              </span>
            </button>
          );
        })}
      </div>

      {/* 时间片 */}
      <div className="mt-4 min-w-0">
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">{t("common.loading")}</p>
        ) : loadFailed ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center text-sm text-[#a47d87]"><p>{t("common.failed")}</p><button type="button" className="rounded-full border border-[#e5cbd1] bg-white px-5 py-2 text-xs font-bold text-[#845263]" onClick={()=>setRetry(v=>v+1)}>{locale === "ja" ? "再試行" : "重试"}</button></div>
        ) : options.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">{t("customer.noSlots")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {options.map((opt) => {
              const active = opt.startAt === selectedStartAt;
              return (
                <button
                  key={opt.startAt}
                  type="button"
                  onClick={() => onSelect(opt)}
                  aria-pressed={active}
                  className={`min-h-11 min-w-20 rounded-full border px-4 text-sm font-medium transition ${
                    active
                      ? "border-transparent bg-[#8f596b] text-white shadow-md shadow-[#ebced1]"
                      : "border-[#eee1df] bg-white text-[#7a6266] hover:border-[#8f596b]"
                  }`}
                >
                  {tokyoTimeOf(fromIso(opt.startAt))}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
