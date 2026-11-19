import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  api,
  STORE_ID,
  type AppointmentDto,
  type AvailabilityOption,
  type Selection,
  type StoreInfo,
} from "../lib/api";
import { useLocale } from "../lib/i18n";
import { AppointmentCard } from "../components/AppointmentCard";
import { DateTimePicker } from "../components/DateTimePicker";

const CANCELLABLE = new Set(["booked", "confirmed"]);

export function LookupPage() {
  const { t } = useLocale();

  const [store, setStore] = useState<StoreInfo | null>(null);
  const [bookingCode, setBookingCode] = useState("");
  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<AppointmentDto | null>(null);

  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [rescheduling, setRescheduling] = useState(false);
  const [newSlot, setNewSlot] = useState<AvailabilityOption | null>(null);
  const [rescheduleRefreshKey, setRescheduleRefreshKey] = useState(0);
  const [rescheduleBusy, setRescheduleBusy] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getStore(STORE_ID)
      .then((s) => {
        if (!cancelled) setStore(s);
      })
      .catch(() => {
        /* 门店信息仅用于改期选时间，失败时隐藏改期入口 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 用原预约的项目与附加项重建选择，供改期查可用时间 */
  const originalSelections = useMemo<Selection[]>(() => {
    if (!appointment) return [];
    return appointment.services.map((svc) => ({
      serviceId: svc.serviceId,
      addonIds: svc.addons.map((a) => a.id),
    }));
  }, [appointment]);

  async function search() {
    if (searching) return;
    setSearching(true);
    setError(null);
    setNotice(null);
    setAppointment(null);
    setConfirmingCancel(false);
    setRescheduling(false);
    try {
      const dto = await api.lookupAppointment({
        storeId: STORE_ID,
        bookingCode: bookingCode.trim(),
        phone: phone.trim(),
      });
      setAppointment(dto);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? t("customer.notFound") : t("common.failed"));
    } finally {
      setSearching(false);
    }
  }

  async function doCancel() {
    if (!appointment || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const dto = await api.cancelAppointment({
        storeId: STORE_ID,
        bookingCode: appointment.bookingCode,
        phone: phone.trim(),
      });
      setAppointment(dto);
      setConfirmingCancel(false);
      setRescheduling(false);
      setNotice(t("customer.cancelledOk"));
    } catch {
      setError(t("common.failed"));
    } finally {
      setCancelling(false);
    }
  }

  async function doReschedule() {
    if (!appointment || !newSlot || rescheduleBusy) return;
    setRescheduleBusy(true);
    setRescheduleError(null);
    try {
      const dto = await api.rescheduleAppointment({
        storeId: STORE_ID,
        bookingCode: appointment.bookingCode,
        phone: phone.trim(),
        startAt: newSlot.startAt,
      });
      setAppointment(dto);
      setRescheduling(false);
      setNewSlot(null);
      setNotice(t("customer.rescheduledOk"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setRescheduleError(t("customer.conflict"));
        setNewSlot(null);
        setRescheduleRefreshKey((k) => k + 1);
      } else {
        setRescheduleError(t("common.failed"));
      }
    } finally {
      setRescheduleBusy(false);
    }
  }

  const canModify = appointment !== null && CANCELLABLE.has(appointment.status);

  return (
    <div className="min-w-0">
      <div className="text-center">
        <h1 className="text-xl font-bold text-slate-800">{t("customer.lookupTitle")}</h1>
        <p className="mt-1 text-sm text-slate-400">{t("customer.lookupHint")}</p>
      </div>

      <form
        className="mt-5 space-y-3 rounded-2xl border border-rose-100 bg-white p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label className="block min-w-0">
          <span className="text-xs font-medium text-slate-500">{t("customer.bookingCode")}</span>
          <input
            value={bookingCode}
            onChange={(e) => setBookingCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            className="mt-1 min-h-11 w-full rounded-xl border border-rose-100 bg-[#faf8f6] px-3 text-base uppercase tracking-wider text-slate-800 outline-none focus:border-[#c2516f]"
          />
        </label>
        <label className="block min-w-0">
          <span className="text-xs font-medium text-slate-500">{t("common.phone")}</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            className="mt-1 min-h-11 w-full rounded-xl border border-rose-100 bg-[#faf8f6] px-3 text-base text-slate-800 outline-none focus:border-[#c2516f]"
          />
        </label>
        <button
          type="submit"
          disabled={!bookingCode.trim() || !phone.trim() || searching}
          className="min-h-12 w-full rounded-full bg-[#c2516f] text-sm font-bold text-white shadow-md shadow-rose-200 transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
        >
          {searching ? t("common.loading") : t("customer.lookup")}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-[#a63f5a]" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700" role="status">
          {notice}
        </div>
      )}

      {appointment && (
        <div className="mt-5 min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-slate-600">{t("customer.myBooking")}</h2>
          <AppointmentCard appointment={appointment} />

          {canModify && (
            <div className="mt-4 space-y-3">
              {/* 改期面板 */}
              {rescheduling && store ? (
                <div className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-slate-700">{t("customer.pickNewTime")}</p>
                  <div className="mt-3">
                    <DateTimePicker
                      store={store}
                      selections={originalSelections}
                      selectedStartAt={newSlot?.startAt ?? null}
                      onSelect={setNewSlot}
                      refreshKey={rescheduleRefreshKey}
                    />
                  </div>
                  {rescheduleError && (
                    <p className="mt-3 text-sm text-[#a63f5a]" role="alert">
                      {rescheduleError}
                    </p>
                  )}
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setRescheduling(false);
                        setNewSlot(null);
                        setRescheduleError(null);
                      }}
                      className="min-h-11 flex-1 rounded-full border border-rose-200 bg-white px-4 text-sm font-semibold text-slate-600"
                    >
                      {t("common.back")}
                    </button>
                    <button
                      type="button"
                      disabled={!newSlot || rescheduleBusy}
                      onClick={doReschedule}
                      className="min-h-11 flex-1 rounded-full bg-[#c2516f] px-4 text-sm font-bold text-white shadow-md shadow-rose-200 transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    >
                      {rescheduleBusy ? t("common.loading") : t("common.confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  {store && (
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setConfirmingCancel(false);
                        setRescheduling(true);
                      }}
                      className="min-h-12 flex-1 rounded-full border border-[#c2516f] bg-white text-sm font-semibold text-[#c2516f]"
                    >
                      {t("customer.reschedule")}
                    </button>
                  )}
                  {!confirmingCancel ? (
                    <button
                      type="button"
                      onClick={() => setConfirmingCancel(true)}
                      className="min-h-12 flex-1 rounded-full border border-rose-200 bg-white text-sm font-semibold text-rose-500"
                    >
                      {t("customer.cancelBooking")}
                    </button>
                  ) : null}
                </div>
              )}

              {/* 取消二次确认 */}
              {confirmingCancel && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-sm font-medium text-slate-700">{t("customer.confirmCancel")}</p>
                  <div className="mt-3 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setConfirmingCancel(false)}
                      className="min-h-11 flex-1 rounded-full border border-rose-200 bg-white px-4 text-sm font-semibold text-slate-600"
                    >
                      {t("common.back")}
                    </button>
                    <button
                      type="button"
                      disabled={cancelling}
                      onClick={doCancel}
                      className="min-h-11 flex-1 rounded-full bg-rose-500 px-4 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {cancelling ? t("common.loading") : t("customer.cancelBooking")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
