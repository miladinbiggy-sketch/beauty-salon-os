import { useEffect, useState } from "react";
import { weekdayOfTokyoDate } from "@salon/shared";
import { api, STORE_ID, type StoreInfo } from "../lib/api";
import { useLocale } from "../lib/i18n";

interface WaitlistFormProps {
  store: StoreInfo;
  date: string;
  serviceId?: string | null;
  staffId?: string | null;
  name: string;
  phone: string;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
}

/**
 * 等候名单登记卡：所选日期无空位时出现。登记只是"请联系我"的请求，
 * 不占任何时段；门店会在有取消时按登记顺序联系。
 */
export function WaitlistForm({ store, date, serviceId, staffId, name, phone, onNameChange, onPhoneChange }: WaitlistFormProps) {
  const { t } = useLocale();
  const hours = store.businessHours.find((h) => h.weekday === weekdayOfTokyoDate(date));
  const [earliest, setEarliest] = useState(hours?.openTime ?? "10:00");
  const [latest, setLatest] = useState(hours?.closeTime ?? "20:00");
  const [state, setState] = useState<"idle" | "submitting" | "done" | "duplicate" | "failed">("idle");

  useEffect(() => {
    setEarliest(hours?.openTime ?? "10:00");
    setLatest(hours?.closeTime ?? "20:00");
    setState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function submit() {
    if (state === "submitting") return;
    setState("submitting");
    try {
      const r = await api.joinWaitlist({
        storeId: STORE_ID, name: name.trim(), phone: phone.trim(),
        serviceId: serviceId ?? null, staffId: staffId ?? null,
        date, earliestTime: earliest, latestTime: latest,
      });
      setState(r.duplicate ? "duplicate" : "done");
    } catch {
      setState("failed");
    }
  }

  const inputCls = "min-h-11 w-full rounded-xl border border-[#eee1df] bg-white px-3 text-sm text-[#5c454a] outline-none focus:border-[#8f596b]";
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-[#e5cbd1] bg-[#fdf7f5] p-4">
      <p className="text-sm font-bold text-[#845263]">{t("customer.waitlist.title")}</p>
      <p className="mt-1 text-xs leading-relaxed text-[#a47d87]">{t("customer.waitlist.hint")}</p>
      {state === "done" ? (
        <p className="mt-3 rounded-xl bg-[#eef7f1] px-3 py-2 text-sm font-medium text-[#256959]">{t("customer.waitlist.done")}</p>
      ) : state === "duplicate" ? (
        <p className="mt-3 rounded-xl bg-[#eef7f1] px-3 py-2 text-sm font-medium text-[#256959]">{t("customer.waitlist.duplicate")}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-[#a47d87]">
              {t("customer.waitlist.name")}
              <input className={inputCls} value={name} onChange={(e) => onNameChange(e.target.value)} autoComplete="name" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#a47d87]">
              {t("customer.waitlist.phone")}
              <input className={inputCls} value={phone} onChange={(e) => onPhoneChange(e.target.value)} inputMode="tel" autoComplete="tel" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-[#a47d87]">
              {t("customer.waitlist.earliest")}
              <input type="time" className={inputCls} value={earliest} onChange={(e) => setEarliest(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#a47d87]">
              {t("customer.waitlist.latest")}
              <input type="time" className={inputCls} value={latest} onChange={(e) => setLatest(e.target.value)} />
            </label>
          </div>
          {state === "failed" && <p role="alert" className="text-xs font-medium text-[#b3261e]">{t("customer.waitlist.failed")}</p>}
          <button
            type="button"
            disabled={!name.trim() || phone.trim().length < 6 || earliest >= latest || state === "submitting"}
            onClick={() => void submit()}
            className="min-h-11 rounded-full bg-[#8f596b] px-5 text-sm font-bold text-white shadow-md shadow-[#ebced1] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state === "submitting" ? t("customer.waitlist.submitting") : t("customer.waitlist.submit")}
          </button>
        </div>
      )}
    </div>
  );
}
