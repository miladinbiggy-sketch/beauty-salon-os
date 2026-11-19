import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { MessageKey } from "@salon/i18n";
import type { ServiceCategory } from "@salon/shared";
import { fromIso, tokyoDateOf, tokyoTimeOf, weekdayOfTokyoDate } from "@salon/shared";
import {
  ApiError,
  api,
  computeTotals,
  localizedName,
  STORE_ID,
  type AppointmentDto,
  type AvailabilityOption,
  type Selection,
  type Service,
  type StaffMember,
  type StoreInfo,
} from "../lib/api";
import { useLocale } from "../lib/i18n";
import { DateTimePicker } from "../components/DateTimePicker";
import { WaitlistForm } from "../components/WaitlistForm";
import { AppointmentCard } from "../components/AppointmentCard";

const CATEGORY_ORDER: ServiceCategory[] = ["nail", "lash", "beauty", "other"];
const STEP_KEYS: MessageKey[] = [
  "customer.step.services",
  "customer.step.staff",
  "customer.step.datetime",
  "customer.step.info",
];

export function BookingPage() {
  const { t, locale } = useLocale();

  const [store, setStore] = useState<StoreInfo | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const [step, setStep] = useState(1);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [staffChoice, setStaffChoice] = useState<string | null>(null); // null = 不指定
  const [slot, setSlot] = useState<AvailabilityOption | null>(null);
  const [slotRefreshKey, setSlotRefreshKey] = useState(0);
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [slotCount, setSlotCount] = useState(-1);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AppointmentDto | null>(null);
  // Never put PII or idempotency keys in localStorage: same-page retries reuse the key.
  const pendingSubmission = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getStore(STORE_ID), api.getServices(STORE_ID), api.getStaff(STORE_ID)])
      .then(([s, svcs, staff]) => {
        if (cancelled) return;
        setStore(s);
        setServices(svcs);
        setStaffList(staff);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => computeTotals(services, selections), [services, selections]);
  const selectedServiceIds = useMemo(() => new Set(selections.map((s) => s.serviceId)), [selections]);

  const grouped = useMemo(() => {
    const map = new Map<ServiceCategory, Service[]>();
    for (const svc of services) {
      const list = map.get(svc.category) ?? [];
      list.push(svc);
      map.set(svc.category, list);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
  }, [services]);

  const chosenStaff = staffChoice ? staffList.find((s) => s.id === staffChoice) : undefined;

  function toggleService(svc: Service) {
    setSlot(null);
    setSelections((prev) =>
      prev.some((s) => s.serviceId === svc.id)
        ? prev.filter((s) => s.serviceId !== svc.id)
        : [...prev, { serviceId: svc.id, addonIds: [] }],
    );
  }

  function toggleAddon(serviceId: string, addonId: string) {
    setSlot(null);
    setSelections((prev) =>
      prev.map((s) =>
        s.serviceId === serviceId
          ? {
              ...s,
              addonIds: s.addonIds.includes(addonId)
                ? s.addonIds.filter((a) => a !== addonId)
                : [...s.addonIds, addonId],
            }
          : s,
      ),
    );
  }

  function staffCanServe(staff: StaffMember): boolean {
    return selections.every((sel) => staff.skillServiceIds.includes(sel.serviceId));
  }

  async function submit() {
    if (!slot || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        storeId: STORE_ID,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() ? email.trim() : undefined,
        staffId: staffChoice ?? undefined,
        startAt: slot.startAt,
        selections,
        note: note.trim() ? note.trim() : undefined,
        locale,
      };
      const signature = JSON.stringify(payload);
      const key = pendingSubmission.current?.signature === signature
        ? pendingSubmission.current.key
        : crypto.randomUUID();
      pendingSubmission.current = { signature, key };
      const dto = await api.createAppointment(payload, key);
      pendingSubmission.current = null;
      setCreated(dto);
      setStep(5);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        pendingSubmission.current = null;
        // 时间刚被约满：回时间步并刷新可用时间
        setError(t("customer.conflict"));
        setSlot(null);
        setSlotRefreshKey((k) => k + 1);
        setStep(3);
      } else if (e instanceof ApiError && e.status === 0) {
        // The server might have committed. Same request and UUID will recover its receipt.
        setError(locale === "ja"
          ? "通信が不安定です。再度「予約を確定」を押しても重複予約にはなりません。"
          : "网络不稳定，请点击原按钮重试；同一预约请求不会重复下单。");
      } else {
        setError(t("common.failed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadFailed) {
    return <p className="py-16 text-center text-sm text-slate-500">{t("common.failed")}</p>;
  }
  if (!store) {
    return <p className="py-16 text-center text-sm text-[#aa9a9e]">{t("common.loading")}</p>;
  }

  const storeName = locale === "zh-CN" ? store.name : (store.nameJa ?? store.name);

  return (
    <div className="min-w-0">
      {/* 日本美容门店预约导览，实际门店名称来自 API */}
      <div className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(115deg,#f9efed,#fff9f7_58%,#edf4ee)] p-5 sm:p-7">
        <div className="mb-3 flex items-center gap-2"><span className="inline-flex items-center gap-1 rounded-full border border-[#e8d7d5] bg-white/80 px-3 py-1 text-[10px] font-bold tracking-[.08em] text-[#946575]">✦ {locale === "ja" ? "ONLINE RESERVATION" : "线上预约"}</span><span className="text-[10px] tracking-widest text-[#ae9496]">BEAUTY STUDIO</span></div>
        <h1 className="break-words text-[23px] font-extrabold tracking-[-.035em] text-[#664b53] sm:text-[29px]">{storeName}</h1>
        <p className="mt-1 text-xs leading-relaxed text-[#a18a90]">{t("app.tagline")}</p>
        <h2 className="mt-5 text-[17px] font-bold text-[#704f5a] sm:text-xl">{step===5 ? (locale === "ja" ? "ご予約ありがとうございます" : "感谢您的预约") : t("customer.title")}</h2>
        <p className="mt-1 text-xs text-[#a88f95]">{t("customer.subtitle")}</p>
        <div className="pointer-events-none absolute -right-7 -top-7 size-28 rounded-full border border-[#ebd7d9]/60" aria-hidden="true"/>
        <div className="pointer-events-none absolute -right-12 -top-12 size-44 rounded-full border border-[#ebd7d9]/35" aria-hidden="true"/>
      </div>

      {/* 进度可视化，仅在预约步骤展示；步骤文字完整保留。 */}
      {step<=4 && <div className="mt-6 rounded-[18px] border border-[#f1e9e5] bg-white px-3 py-4 sm:px-5">
        <div className="mb-3 flex gap-1.5" aria-label={locale === "ja" ? `ステップ ${step}/4` : `第 ${step} 步，共 4 步`}>
          {STEP_KEYS.map((k,i)=><span key={k} className="customer-progress-step" data-done={i<step} />)}
        </div>
        <ol className="grid grid-cols-4 gap-1.5">
          {STEP_KEYS.map((key,i)=>{const n=i+1;const active=n===step;const done=n<step;return <li key={key} className="min-w-0 text-center"><span className={`mx-auto mb-1.5 grid size-7 place-items-center rounded-full text-xs font-bold ${active?"bg-[#8d5266] text-white":done?"bg-[#efe0e3] text-[#845263]":"bg-[#f6f3f2] text-[#b5aba9]"}`}>{done?"✓":n}</span><span className={`block break-words text-[10px] leading-4 sm:text-xs ${active?"font-bold text-[#805263]":"font-medium text-[#aa9e9c]"}`}>{t(key)}</span></li>})}
        </ol>
      </div>}

      {error && (
        <div className="mt-4 rounded-xl bg-[#faf1f1] px-4 py-3 text-sm text-[#784658]" role="alert">
          {error}
        </div>
      )}

      {/* 步骤 1：选项目 */}
      {step === 1 && (
        <section className="mt-5 min-w-0">
          <p className="text-sm font-medium text-slate-700">{t("customer.chooseServices")}</p>
          {grouped.map(({ category, items }) => (
            <div key={category} className="mt-5 min-w-0">
              <h3 className="text-sm font-bold tracking-wide text-slate-500">
                {t(`category.${category}` as MessageKey)}
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {items.map((svc) => {
                  const selected = selectedServiceIds.has(svc.id);
                  const sel = selections.find((s) => s.serviceId === svc.id);
                  return (
                    <div
                      key={svc.id}
                      data-selected={selected} className="customer-service min-w-0 p-4"
                    >
                      <button
                        type="button"
                        onClick={() => toggleService(svc)}
                        className="flex min-h-11 w-full min-w-0 items-start gap-3 text-left"
                        aria-pressed={selected}
                      >
                        <span
                          className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: svc.color }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-semibold text-[#57434a]">
                            {localizedName(locale, svc)}
                          </span>
                          {(locale === "zh-CN" ? svc.descriptionZh : svc.descriptionJa) && (
                            <span className="mt-0.5 block break-words text-xs text-[#aa9a9e]">
                              {locale === "zh-CN" ? svc.descriptionZh : svc.descriptionJa}
                            </span>
                          )}
                          <span className="mt-1 block text-xs text-[#aa9a9e]">
                            {t("common.minutes", { n: svc.durationMinutes })}
                          </span>
                        </span>
                        <span className="shrink-0 font-bold text-[#925b6c]">
                          {t("common.yen", { amount: svc.priceJpy })}
                        </span>
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm ${
                            selected
                              ? "border-transparent bg-[#925b6c] text-white"
                              : "border-slate-200 text-transparent"
                          }`}
                          aria-hidden
                        >
                          ✓
                        </span>
                      </button>

                      {/* 附加项目（选中后展开） */}
                      {selected && svc.addons.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2 border-t border-dashed border-[#f0e1e1] pt-3">
                          {svc.addons.map((addon) => {
                            const on = sel?.addonIds.includes(addon.id) ?? false;
                            return (
                              <button
                                key={addon.id}
                                type="button"
                                onClick={() => toggleAddon(svc.id, addon.id)}
                                aria-pressed={on}
                                className={`min-h-9 max-w-full rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                  on
                                    ? "border-transparent bg-[#925b6c] text-white"
                                    : "border-[#e5d0d2] bg-[#faf1f1]/50 text-slate-600"
                                }`}
                              >
                                <span className="break-words">{localizedName(locale, addon)}</span>
                                {" · "}
                                {t("common.yen", { amount: addon.priceJpy })}
                                {" · "}
                                {t("common.minutes", { n: addon.durationMinutes })}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 步骤 2：选技师 */}
      {step === 2 && (
        <section className="mt-5 min-w-0">
          <p className="text-sm font-medium text-slate-700">{t("customer.chooseStaff")}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setStaffChoice(null);
                setSlot(null);
              }}
              aria-pressed={staffChoice === null}
              className={`flex min-h-16 flex-col items-center justify-center rounded-2xl border bg-white p-3 shadow-sm transition ${
                staffChoice === null ? "border-[#925b6c] ring-1 ring-[#925b6c]" : "border-[#f0e1e1]"
              }`}
            >
              <span className="text-sm font-semibold text-[#57434a]">{t("common.any")}</span>
            </button>
            {staffList.map((staff) => {
              const can = staffCanServe(staff);
              const active = staffChoice === staff.id;
              return (
                <button
                  key={staff.id}
                  type="button"
                  disabled={!can}
                  onClick={() => {
                    setStaffChoice(staff.id);
                    setSlot(null);
                  }}
                  aria-pressed={active}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl border bg-white p-3 shadow-sm transition ${
                    !can
                      ? "cursor-not-allowed border-slate-100 opacity-40"
                      : active
                        ? "border-[#925b6c] ring-1 ring-[#925b6c]"
                        : "border-[#f0e1e1]"
                  }`}
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: staff.color }} />
                  <span className="max-w-full break-words text-center text-sm font-semibold text-[#57434a]">
                    {localizedName(locale, staff)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 步骤 3：选时间 */}
      {step === 3 && (
        <section className="mt-5 min-w-0">
          <p className="text-sm font-medium text-slate-700">{t("customer.chooseDateTime")}</p>
          <div className="mt-3 rounded-2xl border border-[#f0e1e1] bg-white p-4 shadow-sm">
            <DateTimePicker
              store={store}
              selections={selections}
              staffId={staffChoice ?? undefined}
              selectedStartAt={slot?.startAt ?? null}
              onSelect={setSlot}
              refreshKey={slotRefreshKey}
              onDateChange={setPickedDate}
              onAvailabilityChange={setSlotCount}
            />
            {slotCount === 0 && pickedDate && (
              <WaitlistForm
                store={store}
                date={pickedDate}
                serviceId={selections[0]?.serviceId ?? null}
                staffId={staffChoice}
                name={name}
                phone={phone}
                onNameChange={setName}
                onPhoneChange={setPhone}
              />
            )}
          </div>
        </section>
      )}

      {/* 步骤 4：填信息 */}
      {step === 4 && slot && (
        <section className="mt-5 min-w-0">
          <p className="text-sm font-medium text-slate-700">{t("customer.yourInfo")}</p>
          <div className="mt-3 space-y-3 rounded-2xl border border-[#f0e1e1] bg-white p-4 shadow-sm">
            <label className="block min-w-0">
              <span className="text-xs font-medium text-slate-500">
                {t("customer.nameLabel")} <span className="text-[#925b6c]">*</span>
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="mt-1 min-h-11 w-full rounded-xl border border-[#f0e1e1] bg-[#fdfaf9] px-3 text-base text-[#57434a] outline-none focus:border-[#925b6c]"
              />
            </label>
            <label className="block min-w-0">
              <span className="text-xs font-medium text-slate-500">
                {t("customer.phoneLabel")} <span className="text-[#925b6c]">*</span>
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                className="mt-1 min-h-11 w-full rounded-xl border border-[#f0e1e1] bg-[#fdfaf9] px-3 text-base text-[#57434a] outline-none focus:border-[#925b6c]"
              />
            </label>
            <label className="block min-w-0">
              <span className="text-xs font-medium text-slate-500">{t("customer.emailLabel")}</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                inputMode="email"
                className="mt-1 min-h-11 w-full rounded-xl border border-[#f0e1e1] bg-[#fdfaf9] px-3 text-base text-[#57434a] outline-none focus:border-[#925b6c]"
              />
            </label>
            <label className="block min-w-0">
              <span className="text-xs font-medium text-slate-500">{t("customer.noteLabel")}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={500}
                className="mt-1 w-full rounded-xl border border-[#f0e1e1] bg-[#fdfaf9] px-3 py-2 text-base text-[#57434a] outline-none focus:border-[#925b6c]"
              />
            </label>
          </div>

          <p className="mt-3 rounded-xl bg-[#f8f4f2] px-3 py-2.5 text-[11px] leading-5 text-[#96828a]">{locale === "ja" ? "ご予約時間は日本標準時（JST）です。送信後に予約内容を確認してください。" : "所选时间为日本当地时间（JST）。提交后请核对预约详情，实际可预约情况以系统最终确认为准。"}</p>

          {/* 订单摘要 */}
          <div className="mt-4 rounded-2xl border border-[#f0e1e1] bg-white p-4 text-sm shadow-sm">
            <SummaryRows
              services={services}
              selections={selections}
              staffName={chosenStaff ? localizedName(locale, chosenStaff) : t("common.any")}
              slot={slot}
            />
          </div>
        </section>
      )}

      {/* 成功屏 */}
      {step === 5 && created && (
        <section className="mt-6 min-w-0 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#925b6c] text-3xl text-white shadow-lg shadow-[#ebced1]">
            ✓
          </div>
          <h2 className="mt-4 text-xl font-bold text-[#57434a]">{t("customer.successTitle")}</h2>
          <p className="mt-4 text-xs text-[#aa9a9e]">{t("customer.bookingCode")}</p>
          <p className="break-all text-4xl font-extrabold tracking-widest text-[#925b6c]">
            {created.bookingCode}
          </p>
          <p className="mx-auto mt-3 max-w-xs break-words text-sm text-slate-500">{t("customer.successBody")}</p>
          <div className="mt-5 text-left">
            <AppointmentCard appointment={created} />
          </div>
          <Link
            to="/lookup"
            className="mt-5 inline-flex min-h-11 items-center rounded-full border border-[#925b6c] px-6 text-sm font-semibold text-[#925b6c]"
          >
            {t("customer.lookupTitle")}
          </Link>
        </section>
      )}

      {/* 底部操作区 */}
      {step <= 4 && (
        <div className="sticky bottom-0 -mx-4 mt-6 border-t border-[#f0e1e1] bg-[#fdfaf9]/95 px-4 py-3 backdrop-blur">
          {step === 1 && selections.length === 0 && (
            <p className="mb-2 text-center text-xs text-[#aa9a9e]">{t("customer.selectServiceFirst")}</p>
          )}
          {step >= 1 && step <= 3 && (
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="text-slate-500">
                {t("customer.totalDuration")}：{t("common.minutes", { n: totals.totalDurationMinutes })}
              </span>
              <span className="font-bold text-[#925b6c]">
                {t("customer.totalPrice")}：{t("common.yen", { amount: totals.totalPriceJpy })}
              </span>
            </div>
          )}
          <div className="flex gap-3">
            {step > 1 && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep(step - 1);
                }}
                className="min-h-12 shrink-0 rounded-full border border-[#e5d0d2] bg-white px-6 text-sm font-semibold text-slate-600"
              >
                {t("common.back")}
              </button>
            )}
            {step === 1 && (
              <button
                type="button"
                disabled={selections.length === 0}
                onClick={() => {
                  if (selections.length === 0) {
                    setError(t("customer.selectServiceFirst"));
                    return;
                  }
                  setError(null);
                  setStep(2);
                }}
                className="min-h-12 flex-1 rounded-full bg-[#925b6c] text-sm font-bold text-white shadow-md shadow-[#ebced1] transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {t("common.next")}
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(3)}
                className="min-h-12 flex-1 rounded-full bg-[#925b6c] text-sm font-bold text-white shadow-md shadow-[#ebced1]"
              >
                {t("common.next")}
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                disabled={!slot}
                onClick={() => slot && setStep(4)}
                className="min-h-12 flex-1 rounded-full bg-[#925b6c] text-sm font-bold text-white shadow-md shadow-[#ebced1] transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {t("common.next")}
              </button>
            )}
            {step === 4 && (
              <button
                type="button"
                disabled={!name.trim() || !phone.trim() || submitting}
                onClick={submit}
                className="min-h-12 flex-1 rounded-full bg-[#925b6c] text-sm font-bold text-white shadow-md shadow-[#ebced1] transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {submitting ? t("customer.booking") : t("customer.bookNow")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRows({
  services,
  selections,
  staffName,
  slot,
}: {
  services: Service[];
  selections: Selection[];
  staffName: string;
  slot: AvailabilityOption;
}) {
  const { t, locale } = useLocale();
  const byId = new Map(services.map((s) => [s.id, s]));
  const startMs = fromIso(slot.startAt);
  const date = tokyoDateOf(startMs);
  const [, month, day] = date.split("-");
  return (
    <dl className="space-y-2">
      {selections.map((sel) => {
        const svc = byId.get(sel.serviceId);
        if (!svc) return null;
        const addons = svc.addons.filter((a) => sel.addonIds.includes(a.id));
        return (
          <div key={sel.serviceId} className="flex items-baseline justify-between gap-2">
            <dt className="min-w-0 break-words text-slate-600">
              {localizedName(locale, svc)}
              {addons.length > 0 && (
                <span className="text-xs text-[#aa9a9e]">
                  {"（"}
                  {addons.map((a) => localizedName(locale, a)).join(" / ")}
                  {"）"}
                </span>
              )}
            </dt>
            <dd className="shrink-0 font-medium text-[#57434a]">
              {t("common.yen", {
                amount: svc.priceJpy + addons.reduce((n, a) => n + a.priceJpy, 0),
              })}
            </dd>
          </div>
        );
      })}
      <div className="flex justify-between gap-2">
        <dt className="shrink-0 text-slate-500">{t("customer.staffLabel")}</dt>
        <dd className="min-w-0 break-words text-right font-medium text-[#57434a]">{staffName}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="shrink-0 text-slate-500">{t("customer.timeLabel")}</dt>
        <dd className="font-medium text-[#57434a]">
          {Number(month)}/{Number(day)}（{t(`weekday.${weekdayOfTokyoDate(date)}` as MessageKey)}）{" "}
          {tokyoTimeOf(startMs)}–{tokyoTimeOf(fromIso(slot.endAt))}
        </dd>
      </div>
      <div className="flex items-baseline justify-between border-t border-dashed border-[#f0e1e1] pt-2">
        <dt className="font-semibold text-slate-700">{t("common.total")}</dt>
        <dd className="text-base font-bold text-[#925b6c]">{t("common.yen", { amount: slot.totalPriceJpy })}</dd>
      </div>
    </dl>
  );
}
