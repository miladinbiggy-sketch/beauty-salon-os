import type { MessageKey } from "@salon/i18n";
import type { AppointmentStatus } from "@salon/shared";
import { fromIso, tokyoDateOf, tokyoTimeOf, weekdayOfTokyoDate } from "@salon/shared";
import { localizedName, type AppointmentDto } from "../lib/api";
import { useLocale } from "../lib/i18n";

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  booked: "bg-sky-100 text-sky-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  arrived: "bg-violet-100 text-violet-700",
  in_service: "bg-amber-100 text-amber-700",
  completed: "bg-slate-200 text-slate-600",
  cancelled: "bg-rose-100 text-rose-600",
  no_show: "bg-slate-200 text-slate-500",
};

/** 预约详情卡：成功页与查询页共用 */
export function AppointmentCard({ appointment }: { appointment: AppointmentDto }) {
  const { t, locale } = useLocale();
  const startMs = fromIso(appointment.startAt);
  const date = tokyoDateOf(startMs);
  const weekday = weekdayOfTokyoDate(date);
  const [, month, day] = date.split("-");

  return (
    <div className="min-w-0 rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">{t("customer.bookingCode")}</p>
          <p className="break-all text-lg font-bold tracking-wide text-slate-800">{appointment.bookingCode}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[appointment.status]}`}
        >
          {t(`status.${appointment.status}` as MessageKey)}
        </span>
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex gap-3">
          <dt className="w-14 shrink-0 text-slate-400">{t("customer.timeLabel")}</dt>
          <dd className="min-w-0 break-words font-medium text-slate-800">
            {Number(month)}/{Number(day)}（{t(`weekday.${weekday}` as MessageKey)}）{" "}
            {tokyoTimeOf(startMs)}–{tokyoTimeOf(fromIso(appointment.endAt))}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-14 shrink-0 text-slate-400">{t("customer.staffLabel")}</dt>
          <dd className="flex min-w-0 items-center gap-2 font-medium text-slate-800">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: appointment.staff.color }}
            />
            <span className="min-w-0 break-words">
              {localizedName(locale, { name: appointment.staff.name, nameJa: appointment.staff.nameJa })}
            </span>
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-14 shrink-0 pt-0.5 text-slate-400">{t("customer.servicesLabel")}</dt>
          <dd className="min-w-0 flex-1">
            <ul className="space-y-1.5">
              {appointment.services.map((svc) => (
                <li key={svc.appointmentServiceId} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words font-medium text-slate-800">
                      {localizedName(locale, svc)}
                    </span>
                    <span className="shrink-0 text-slate-600">{t("common.yen", { amount: svc.priceJpy })}</span>
                  </div>
                  {svc.addons.length > 0 && (
                    <p className="mt-0.5 break-words pl-3 text-xs text-slate-400">
                      {svc.addons.map((a) => localizedName(locale, a)).join(" / ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="flex items-baseline justify-between border-t border-dashed border-rose-100 pt-3">
          <dt className="text-slate-400">{t("common.total")}</dt>
          <dd className="text-base font-bold text-[#c2516f]">
            {t("common.yen", { amount: appointment.totalPriceJpy })}
          </dd>
        </div>
      </dl>
    </div>
  );
}
