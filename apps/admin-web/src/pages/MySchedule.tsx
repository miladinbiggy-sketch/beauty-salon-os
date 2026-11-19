import { useCallback, useEffect, useState } from "react";
import { fromIso, todayTokyo, tokyoTimeOf, type AppointmentStatus } from "@salon/shared";
import { api, type AppointmentDto, type StaffPerformance } from "../lib/api";
import { localizedName, useI18n } from "../lib/i18n";
import { btnPrimary, cardCls, inputCls, Loading, STATUS_TRANSITIONS, StatusBadge, useToast, useYen } from "../lib/ui";
import type { MessageKey } from "@salon/i18n";

const STAFF_ACTIONS: Partial<Record<AppointmentStatus, MessageKey>> = {
  arrived: "staff.markArrived",
  in_service: "staff.startService",
  completed: "staff.completeService",
};

export default function MySchedulePage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const yen = useYen();
  const [date, setDate] = useState(todayTokyo());
  const [rows, setRows] = useState<AppointmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [perf, setPerf] = useState<StaffPerformance | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<AppointmentDto[]>(`/staff/schedule?date=${date}`);
      setRows(data);
      setNotes((prev) => {
        const next = { ...prev };
        for (const a of data) {
          if (!(a.id in next)) next[a.id] = a.serviceNote ?? "";
        }
        return next;
      });
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const today = todayTokyo();
    const from = `${today.slice(0, 8)}01`;
    api
      .get<StaffPerformance>(`/staff/performance?from=${from}&to=${today}`)
      .then(setPerf)
      .catch(() => setPerf(null));
  }, []);

  async function act(appt: AppointmentDto, target: AppointmentStatus) {
    setBusyId(appt.id);
    try {
      await api.patch(`/admin/appointments/${appt.id}/status`, {
        status: target,
        serviceNote: notes[appt.id] ?? undefined,
      });
      toast(t("common.saved"));
      await load();
    } catch {
      toast(t("common.failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-800">{t("staff.todayTitle")}</h1>
        <input
          type="date"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
          value={date}
          onChange={(e) => {
            if (e.target.value) {
              setDate(e.target.value);
              setLoading(true);
            }
          }}
        />
      </div>

      {perf && (
        <div className="grid grid-cols-2 gap-3">
          <div className={`p-4 ${cardCls}`}>
            <div className="text-xs text-slate-400">{t("staff.myPerformance")} · {t("staff.completedCount")}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800">{perf.completedCount}</div>
          </div>
          <div className={`p-4 ${cardCls}`}>
            <div className="text-xs text-slate-400">{t("staff.myPerformance")} · {t("staff.revenue")}</div>
            <div className="mt-1 truncate text-2xl font-bold text-slate-800">{yen(perf.revenueJpy)}</div>
          </div>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className={`p-8 text-center text-sm text-slate-400 ${cardCls}`}>{t("staff.noAppointments")}</div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((a) => {
            const transitions = (STATUS_TRANSITIONS[a.status] ?? []).filter(
              (s) => s === "arrived" || s === "in_service" || s === "completed",
            );
            return (
              <article key={a.id} className={`p-4 ${cardCls}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold tabular-nums text-slate-800">
                    {tokyoTimeOf(fromIso(a.startAt))}–{tokyoTimeOf(fromIso(a.endAt))}
                  </span>
                  <StatusBadge status={a.status} />
                  <span className="ml-auto text-sm font-medium text-slate-700">{yen(a.totalPriceJpy)}</span>
                </div>
                <div className="mt-1.5 min-w-0 truncate text-sm font-medium text-slate-700">{a.customer.name}</div>
                <div className="truncate text-xs text-slate-400">{a.customer.phone}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {a.services.map((s) => (
                    <span key={s.appointmentServiceId} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {localizedName(locale, s.nameZh, s.nameJa)}
                      {s.resourceName ? ` · ${s.resourceName}` : ""}
                    </span>
                  ))}
                </div>
                {a.customerNote && <div className="mt-2 text-xs text-slate-400">{a.customerNote}</div>}
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">{t("staff.serviceNote")}</span>
                  <textarea
                    className={inputCls}
                    rows={2}
                    value={notes[a.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [a.id]: e.target.value }))}
                  />
                </label>
                {/* 服务备注随状态按钮的 PATCH 一并提交保存（后端无独立备注接口） */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {transitions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={btnPrimary}
                      disabled={busyId === a.id}
                      onClick={() => void act(a, s)}
                    >
                      {t((STAFF_ACTIONS[s] ?? `status.${s}`) as MessageKey)}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
