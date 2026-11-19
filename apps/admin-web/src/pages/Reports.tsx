import { useCallback, useEffect, useRef, useState } from "react";
import { todayTokyo, type AppointmentStatus } from "@salon/shared";
import { api, type ReportSummary } from "../lib/api";
import { localizedName, useI18n } from "../lib/i18n";
import { cardCls, Field, inputCls, Loading, StatusBadge, useYen } from "../lib/ui";
import { Icon } from "../lib/icons";

const ALL_STATUSES: AppointmentStatus[] = ["booked", "confirmed", "arrived", "in_service", "completed", "cancelled", "no_show"];

export default function ReportsPage() {
  const { t, locale } = useI18n();
  const yen = useYen();
  const [from, setFrom] = useState(() => `${todayTokyo().slice(0, 8)}01`);
  const [to, setTo] = useState(todayTokyo());
  const [data, setData] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const request = ++loadSequence.current;
    if (from > to) {setData(null);setLoadError(false);setLoading(false);return;}
    try {
      const result = await api.get<ReportSummary>(`/admin/reports/summary?from=${from}&to=${to}`);
      if (request === loadSequence.current) {setData(result);setLoadError(false);}
    } catch {
      if (request === loadSequence.current) {setData(null);setLoadError(true);}
    } finally {
      if (request === loadSequence.current) setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxDay = data ? Math.max(1, ...data.revenueByDay.map((d) => d.revenueJpy)) : 1;

  return (
    <div className="salon-page mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div><p className="mb-1 text-[11px] font-bold uppercase tracking-[.14em] text-[#79a28d]">SALON ANALYTICS</p><h1 className="text-2xl font-extrabold tracking-tight text-[#2f4c3d]">{t("admin.nav.reports")}</h1><p className="mt-1 text-xs text-[#91a599]">{locale === "ja" ? "収支と予約状況から、店舗の現状を正確に把握" : "根据实际收银记录与预约数据分析经营状况"}</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <Field label={t("admin.reports.from")}>
            <input type="date" className={inputCls} value={from} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setLoading(true); } }} />
          </Field>
        </div>
        <div className="w-40">
          <Field label={t("admin.reports.to")}>
            <input type="date" className={inputCls} value={to} onChange={(e) => { if (e.target.value) { setTo(e.target.value); setLoading(true); } }} />
          </Field>
        </div>
      </div>

      {from > to && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{locale === "ja" ? "開始日は終了日より後にできません" : "开始日期不能晚于结束日期"}</div>}
      {loadError && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><Icon name="info" size={16}/>{locale === "ja" ? "レポートを取得できませんでした。" : "经营报表加载失败，不能将错误显示成零营业额。"}<button type="button" className="font-bold underline" onClick={()=>{setLoading(true);void load();}}>{locale === "ja" ? "再試行" : "重试"}</button></div>}
      {loading ? (
        <Loading />
      ) : !data ? (
        !loadError && from<=to && <div className="py-10 text-center text-sm text-slate-400">{t("common.none")}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={`p-5 ${cardCls}`}>
              <div className="text-xs text-slate-400">{t("admin.reports.revenue")}</div>
              <div className="mt-2 truncate text-2xl font-extrabold tabular-nums tracking-tight text-[#2e5c47]">{yen(data.revenueJpy)}</div>
            </div>
            <div className={`p-5 ${cardCls}`}>
              <div className="text-xs text-slate-400">{t("admin.reports.appointments")}</div>
              <div className="mt-2 text-2xl font-extrabold tabular-nums tracking-tight text-[#2e5c47]">{data.appointmentsTotal}</div>
            </div>
            <div className={`col-span-2 p-4 ${cardCls}`}>
              <div className="mb-2 text-xs text-slate-400">{t("common.status")}</div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_STATUSES.filter((s) => (data.appointmentsByStatus[s] ?? 0) > 0).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <StatusBadge status={s} />
                    <span className="text-sm text-slate-600">{data.appointmentsByStatus[s]}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <section className={`p-5 ${cardCls}`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-600">{t("admin.reports.revenue")}</h2>
            {data.revenueByDay.length === 0 ? (
              <div className="text-sm text-slate-300">{t("common.none")}</div>
            ) : (
              <div className="flex h-36 items-end gap-1 overflow-x-auto pb-1">
                {data.revenueByDay.map((d) => (
                  <div key={d.date} className="flex min-w-7 flex-1 flex-col items-center gap-1" title={`${d.date}: ${yen(d.revenueJpy)}`}>
                    <div className="text-[10px] tabular-nums text-slate-400">{d.revenueJpy > 0 ? Math.round(d.revenueJpy / 1000) : ""}</div>
                    <div
                      className="w-full max-w-10 rounded-t bg-[#6b9d80]"
                      style={{ height: `${Math.max((d.revenueJpy / maxDay) * 100, d.revenueJpy > 0 ? 4 : 1)}%`, minHeight: 2 }}
                    />
                    <div className="whitespace-nowrap text-[10px] text-slate-400">{d.date.slice(5)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className={`p-5 ${cardCls}`}>
              <h2 className="mb-3 text-sm font-semibold text-slate-600">{t("admin.reports.staffPerformance")}</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="py-2 font-medium">{t("admin.staff.name")}</th>
                    <th className="py-2 text-right font-medium">{t("staff.completedCount")}</th>
                    <th className="py-2 text-right font-medium">{t("admin.reports.revenue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staffPerformance.map((r) => (
                    <tr key={r.staffId} className="border-b border-slate-50">
                      <td className="max-w-40 truncate py-2 font-medium text-slate-700">{r.name}</td>
                      <td className="py-2 text-right text-slate-500">{r.completedCount}</td>
                      <td className="py-2 text-right text-slate-700">{yen(r.revenueJpy)}</td>
                    </tr>
                  ))}
                  {data.staffPerformance.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-slate-300">
                        {t("common.none")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <section className={`p-5 ${cardCls}`}>
              <h2 className="mb-3 text-sm font-semibold text-slate-600">{t("admin.reports.serviceRanking")}</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="py-2 font-medium">{t("admin.appointment.services")}</th>
                    <th className="py-2 text-right font-medium">{t("admin.reports.appointments")}</th>
                    <th className="py-2 text-right font-medium">{t("admin.reports.revenue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.serviceRanking.map((r) => (
                    <tr key={r.serviceId} className="border-b border-slate-50">
                      <td className="max-w-40 truncate py-2 font-medium text-slate-700">{localizedName(locale, r.nameZh, r.nameJa)}</td>
                      <td className="py-2 text-right text-slate-500">{r.count}</td>
                      <td className="py-2 text-right text-slate-700">{yen(r.revenueJpy)}</td>
                    </tr>
                  ))}
                  {data.serviceRanking.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-slate-300">
                        {t("common.none")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
