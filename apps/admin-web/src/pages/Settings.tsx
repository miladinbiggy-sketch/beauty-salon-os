import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type BusinessHour, type StoreInfo } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { btnPrimary, cardCls, Field, inputCls, Loading, useToast } from "../lib/ui";
import type { MessageKey } from "@salon/i18n";

interface NotificationRow {
  id: string;
  type: string;
  status: string;
  channel: string;
  recipient: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  scheduledAt: string;
  sentAt: string | null;
}

interface HourRow {
  weekday: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export default function SettingsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [nameJa, setNameJa] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState<HourRow[]>([]);
  const [bookingWindowDays, setBookingWindowDays] = useState("60");
  const [minLeadMinutes, setMinLeadMinutes] = useState("60");
  const [reminders, setReminders] = useState("1440, 180");
  const [slotStepMinutes, setSlotStepMinutes] = useState("15");
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [noticesBusy, setNoticesBusy] = useState(false);
  const [noticesError, setNoticesError] = useState(false);
  const [noticeFilter, setNoticeFilter] = useState<"failed" | "all">("failed");

  async function refreshNotices() {
    setNoticesBusy(true);
    setNoticesError(false);
    try { setNotifications(await api.get<NotificationRow[]>("/admin/notifications")); }
    catch { setNoticesError(true); }
    finally { setNoticesBusy(false); }
  }

  useEffect(() => { void refreshNotices(); }, []);

  useEffect(() => {
    api
      .get<StoreInfo>("/admin/store")
      .then((s) => {
        setStore(s);
        setName(s.name);
        setNameJa(s.nameJa ?? "");
        setPhone(s.phone ?? "");
        setAddress(s.address ?? "");
        const rows: HourRow[] = [1, 2, 3, 4, 5, 6, 7].map((wd) => {
          const h: BusinessHour | undefined = s.businessHours.find((b) => b.weekday === wd);
          return h
            ? { weekday: wd, openTime: h.openTime, closeTime: h.closeTime, isClosed: h.isClosed }
            : { weekday: wd, openTime: "10:00", closeTime: "20:00", isClosed: wd === 1 };
        });
        setHours(rows);
        setBookingWindowDays(String(s.settings.bookingWindowDays));
        setMinLeadMinutes(String(s.settings.minLeadMinutes));
        setReminders(s.settings.reminderOffsetsMinutes.join(", "));
        setSlotStepMinutes(String(s.settings.slotStepMinutes));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const reminderOffsets = reminders
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0);
    try {
      await api.put("/admin/store", {
        name: name.trim(),
        nameJa: nameJa.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        settings: {
          bookingWindowDays: Number(bookingWindowDays),
          minLeadMinutes: Number(minLeadMinutes),
          reminderOffsetsMinutes: reminderOffsets,
          slotStepMinutes: Number(slotStepMinutes),
        },
        businessHours: hours,
      });
      toast(t("admin.settings.savedOk"));
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? t("admin.settings.hoursConflict") : t("common.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (!store) return <div className="py-10 text-center text-sm text-slate-300">{t("common.none")}</div>;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold text-slate-800">{t("admin.nav.settings")}</h1>
      <form className="flex flex-col gap-4" onSubmit={save}>
        <section className={`flex flex-col gap-3 p-4 ${cardCls}`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("admin.settings.storeName")}>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label={t("admin.services.nameJa")}>
              <input className={inputCls} value={nameJa} onChange={(e) => setNameJa(e.target.value)} />
            </Field>
            <Field label={t("common.phone")}>
              <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            {/* 地址：i18n 词条中无对应 key，仅渲染输入框本身 */}
            <div className="flex items-end">
              <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} aria-label="address" />
            </div>
          </div>
        </section>

        <section className={`p-4 ${cardCls}`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-600">{t("admin.settings.businessHours")}</h2>
          <div className="flex flex-col gap-2">
            {hours.map((h, idx) => (
              <div key={h.weekday} className="flex flex-wrap items-center gap-2">
                <span className="w-12 shrink-0 text-sm text-slate-600">{t(`weekday.${h.weekday}` as MessageKey)}</span>
                <input
                  type="time"
                  className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-40"
                  value={h.openTime}
                  disabled={h.isClosed}
                  onChange={(e) => setHours((prev) => prev.map((x, i) => (i === idx ? { ...x, openTime: e.target.value } : x)))}
                />
                <span className="text-slate-300">–</span>
                <input
                  type="time"
                  className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-40"
                  value={h.closeTime}
                  disabled={h.isClosed}
                  onChange={(e) => setHours((prev) => prev.map((x, i) => (i === idx ? { ...x, closeTime: e.target.value } : x)))}
                />
                <label className="flex items-center gap-1.5 text-sm text-slate-500">
                  <input
                    type="checkbox"
                    checked={h.isClosed}
                    onChange={(e) => setHours((prev) => prev.map((x, i) => (i === idx ? { ...x, isClosed: e.target.checked } : x)))}
                  />
                  {t("common.inactive")}
                </label>
              </div>
            ))}
          </div>
        </section>

        <section className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 ${cardCls}`}>
          <Field label={t("admin.settings.bookingWindow")}>
            <input type="number" min={1} className={inputCls} value={bookingWindowDays} onChange={(e) => setBookingWindowDays(e.target.value)} />
          </Field>
          <Field label={t("admin.settings.minLead")}>
            <input type="number" min={0} className={inputCls} value={minLeadMinutes} onChange={(e) => setMinLeadMinutes(e.target.value)} />
          </Field>
          <Field label={t("admin.settings.reminders")}>
            <input className={inputCls} value={reminders} onChange={(e) => setReminders(e.target.value)} />
          </Field>
          <Field label={t("common.time")}>
            <input type="number" min={5} max={60} className={inputCls} value={slotStepMinutes} onChange={(e) => setSlotStepMinutes(e.target.value)} />
          </Field>
        </section>

        <section className={`p-4 ${cardCls}`}>
          <h2 className="mb-1 text-sm font-semibold text-slate-600">{t("admin.settings.line")}</h2>
          <p className="text-sm text-slate-500">{t("admin.settings.lineHint")}</p>
          <p className="mt-1 text-sm text-slate-500">
            {t("common.status")}: {store.settings.lineConfigured ? t("common.yes") : t("common.no")}
          </p>
        </section>

        <div>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {t("common.save")}
          </button>
        </div>
      </form>
      <section className={`p-4 ${cardCls}`} aria-label={t("admin.notifications.title")}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">{t("admin.notifications.title")}</h2>
            <p className="mt-1 text-xs text-slate-500">{t("admin.notifications.acceptedHint")}</p>
          </div>
          <button type="button" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50" onClick={() => void refreshNotices()} disabled={noticesBusy}>
            {noticesBusy ? t("common.loading") : t("admin.notifications.refresh")}
          </button>
        </div>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <button type="button" onClick={() => setNoticeFilter("failed")} className={`rounded-full border px-3 py-1.5 ${noticeFilter === "failed" ? "border-rose-300 bg-rose-50 text-rose-800" : "border-slate-200 text-slate-500"}`}>
            {t("admin.notifications.failed")} ({notifications.filter((r) => r.status === "failed").length})
          </button>
          <button type="button" onClick={() => setNoticeFilter("all")} className={`rounded-full border px-3 py-1.5 ${noticeFilter === "all" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-500"}`}>
            {t("admin.notifications.all")} ({notifications.length})
          </button>
        </div>
        {noticesError ? <p className="text-sm text-rose-700" role="alert">{t("admin.notifications.loadFailed")}</p> : null}
        {!noticesError && notifications.filter((n) => noticeFilter === "all" || n.status === "failed").length === 0 ?
          <p className="text-sm text-slate-500">{t("admin.notifications.empty")}</p> : null}
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {notifications.filter((n) => noticeFilter === "all" || n.status === "failed").map((n) => (
            <div key={n.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 font-semibold ${n.status === "failed" ? "bg-rose-100 text-rose-700" : n.status === "sent" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {n.status}
                </span>
                <span className="font-medium text-slate-700">{n.type}</span>
                <span className="text-slate-500">{n.channel} · {n.recipient ?? "–"}</span>
                <span className="ml-auto text-slate-500">{new Date(n.createdAt).toLocaleString()}</span>
              </div>
              {n.lastError ? <p className="mt-1 break-words text-slate-600">{n.lastError}</p> : null}
              <p className="mt-1 text-slate-400">{t("admin.notifications.attempts")}: {n.attempts}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">{t("admin.notifications.mockHint")}</p>
      </section>
    </div>
  );
}
