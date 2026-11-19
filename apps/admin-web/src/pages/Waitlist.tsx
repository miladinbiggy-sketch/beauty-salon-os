import { useCallback, useEffect, useState } from "react";
import type { MessageKey } from "@salon/i18n";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { btnPrimary, btnSmall, cardCls, inputCls } from "../lib/ui";

interface WaitlistEntry {
  id: string;
  name: string;
  phone: string;
  serviceId: string | null;
  staffId: string | null;
  serviceNameZh: string | null;
  serviceNameJa: string | null;
  staffName: string | null;
  date: string;
  earliestTime: string;
  latestTime: string;
  status: "waiting" | "notified" | "booked" | "expired" | "cancelled";
  notifiedAt: string | null;
  createdAt: string;
}

const todayTokyo = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const STATUS_KEY: Record<WaitlistEntry["status"], string> = {
  waiting: "admin.waitlist.statusWaiting",
  notified: "admin.waitlist.statusNotified",
  booked: "admin.waitlist.statusBooked",
  expired: "admin.waitlist.statusExpired",
  cancelled: "admin.waitlist.statusCancelled",
};
const STATUS_CLS: Record<WaitlistEntry["status"], string> = {
  waiting: "bg-amber-50 text-amber-700 border-amber-200",
  notified: "bg-sky-50 text-sky-700 border-sky-200",
  booked: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expired: "bg-slate-100 text-slate-500 border-slate-200",
  cancelled: "bg-slate-100 text-slate-400 border-slate-200",
};

export default function WaitlistPage() {
  const { t, locale } = useI18n();
  const [date, setDate] = useState(todayTokyo);
  const [rows, setRows] = useState<WaitlistEntry[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [candTime, setCandTime] = useState("14:00");
  const [candidates, setCandidates] = useState<WaitlistEntry[] | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      setRows(await api.get<WaitlistEntry[]>(`/admin/waitlist?date=${encodeURIComponent(date)}`));
    } catch {
      setError(t("admin.waitlist.failed"));
    }
  }, [date, t]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function act(id: string, kind: "notify" | "booked" | "expired" | "cancelled") {
    setBusy(true);
    setError("");
    try {
      if (kind === "notify") await api.post(`/admin/waitlist/${id}/notify`, {});
      else await api.post(`/admin/waitlist/${id}/status`, { status: kind });
      await refresh();
      setCandidates(null);
    } catch {
      setError(t("admin.waitlist.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function searchCandidates() {
    setError("");
    try {
      setCandidates(await api.get<WaitlistEntry[]>(
        `/admin/waitlist/candidates?date=${encodeURIComponent(date)}&time=${encodeURIComponent(candTime)}`,
      ));
    } catch {
      setError(t("admin.waitlist.failed"));
    }
  }

  const renderRow = (r: WaitlistEntry) => (
    <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 py-3 last:border-0">
      <div className="min-w-36">
        <div className="text-sm font-semibold text-slate-800">{r.name}</div>
        <div className="text-xs text-slate-500">{r.phone}</div>
      </div>
      <div className="min-w-28 text-sm text-slate-600">
        {r.serviceId
          ? (locale === "ja" ? r.serviceNameJa ?? r.serviceNameZh : r.serviceNameZh ?? r.serviceNameJa) ?? "—"
          : t("admin.waitlist.anyService")}
        <span className="text-slate-400"> · {r.staffName ?? t("admin.waitlist.anyStaff")}</span>
      </div>
      <div className="text-sm tabular-nums text-slate-600">{r.earliestTime}–{r.latestTime}</div>
      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[r.status]}`}>
        {t(STATUS_KEY[r.status] as MessageKey)}
      </span>
      {(r.status === "waiting" || r.status === "notified") && (
        <div className="ml-auto flex flex-wrap gap-1.5">
          {r.status === "waiting" && (
            <button type="button" disabled={busy} className={btnSmall} onClick={() => void act(r.id, "notify")}>
              {t("admin.waitlist.notify")}
            </button>
          )}
          <button type="button" disabled={busy} className={btnSmall} onClick={() => void act(r.id, "booked")}>
            {t("admin.waitlist.booked")}
          </button>
          <button type="button" disabled={busy} className={btnSmall} onClick={() => void act(r.id, "expired")}>
            {t("admin.waitlist.expired")}
          </button>
          <button type="button" disabled={busy} className={btnSmall} onClick={() => void act(r.id, "cancelled")}>
            {t("admin.waitlist.cancelled")}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className={cardCls}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-bold text-slate-800">{t("admin.waitlist.title")}</h2>
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-500">
            {t("admin.waitlist.date")}
            <input type="date" className={inputCls} value={date} onChange={(e) => { setDate(e.target.value); setCandidates(null); }} />
          </label>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">{t("admin.waitlist.hint")}</p>
        {error && <p role="alert" className="mt-2 text-sm font-medium text-[#b3261e]">{error}</p>}
        <div className="mt-2">
          {rows.length === 0
            ? <p className="py-6 text-center text-sm text-slate-400">{t("admin.waitlist.empty")}</p>
            : rows.map(renderRow)}
        </div>
      </div>

      <div className={cardCls}>
        <h3 className="text-sm font-bold text-slate-800">{t("admin.waitlist.candidates")}</h3>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            {t("admin.waitlist.freedTime")}
            <input type="time" className={inputCls} value={candTime} onChange={(e) => setCandTime(e.target.value)} />
          </label>
          <button type="button" className={btnPrimary} onClick={() => void searchCandidates()}>
            {t("admin.waitlist.search")}
          </button>
        </div>
        {candidates !== null && (
          <div className="mt-2">
            {candidates.length === 0
              ? <p className="py-4 text-center text-sm text-slate-400">{t("admin.waitlist.noCandidates")}</p>
              : candidates.map(renderRow)}
          </div>
        )}
      </div>
    </div>
  );
}
