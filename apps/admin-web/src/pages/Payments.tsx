import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fromIso, todayTokyo, tokyoDateOf, tokyoTimeOf, type PaymentMethod } from "@salon/shared";
import { api, type Payment } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { btnGhost, btnPrimary, btnSmall, cardCls, Field, inputCls, Loading, Modal, useToast, useYen } from "../lib/ui";
import type { MessageKey } from "@salon/i18n";
import { Icon } from "../lib/icons";
import { saveCsv } from "../lib/export-csv";
import { nextPaymentRetryHandle, type PaymentRetryHandle } from "../lib/payment-retry";

const METHODS: PaymentMethod[] = ["cash", "card", "paypay", "line_pay", "bank_transfer", "other"];

export default function PaymentsPage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const yen = useYen();
  const [from, setFrom] = useState(() => `${todayTokyo().slice(0, 8)}01`);
  const [to, setTo] = useState(todayTokyo());
  const [rows, setRows] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const loadSequence = useRef(0);
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [busy, setBusy] = useState(false);
  // Retain the UUID across transient network errors; edited form => new intent key.
  // Do not store customer/payment details or an operation UUID in localStorage.
  const receiptIntent = useRef<PaymentRetryHandle | null>(null);
  const refundIntent = useRef<PaymentRetryHandle | null>(null);
  function retryKey(ref: typeof receiptIntent, intent: unknown): string {
    ref.current = nextPaymentRetryHandle(ref.current, intent, () => crypto.randomUUID());
    return ref.current.key;
  }
  const [form, setForm] = useState({ appointmentId: "", amountJpy: "", method: "cash" as PaymentMethod, note: "" });

  const load = useCallback(async () => {
    const request = ++loadSequence.current;
    if (from > to) {setRows([]);setLoadError(false);setLoading(false);return;}
    try {
      const result = await api.get<Payment[]>(`/admin/payments?from=${from}&to=${to}`);
      if (request === loadSequence.current) {setRows(result);setLoadError(false);}
    } catch {
      if (request === loadSequence.current) {setRows([]);setLoadError(true);}
    } finally {if (request === loadSequence.current) setLoading(false);}
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(() => rows.reduce((s, p) => s + p.amountJpy, 0), [rows]);

  async function submitRecord(e: FormEvent) {
    e.preventDefault();
    const amount = Number(form.amountJpy);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (busy) return;
    const intent = {
      appointmentId: form.appointmentId.trim() || null,
      amountJpy: amount,
      method: form.method,
      note: form.note.trim() || undefined,
    };
    const key = retryKey(receiptIntent, intent);
    setBusy(true);
    try {
      await api.post("/admin/payments", intent, { idempotencyKey: key });
      // Clear ONLY after a confirmed server response. An ambiguous network failure
      // keeps the same UUID for a safe retry instead of silently double-charging.
      receiptIntent.current = null;
      toast(t("common.saved"));
      setForm({ appointmentId: "", amountJpy: "", method: "cash", note: "" });
      await load();
    } catch {
      toast(t("admin.payments.retrySafe"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function submitRefund() {
    if (!refundTarget) return;
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (busy) return;
    const intent = { amountJpy: amount };
    const key = retryKey(refundIntent, { ...intent, originalPaymentId: refundTarget.id });
    setBusy(true);
    try {
      await api.post(`/admin/payments/${refundTarget.id}/refund`, intent, { idempotencyKey: key });
      refundIntent.current = null;
      toast(t("common.saved"));
      setRefundTarget(null);
      await load();
    } catch {
      toast(t("admin.payments.retrySafe"), "error");
    } finally {
      setBusy(false);
    }
  }

  function exportPayments() {
    saveCsv(`salon-payments-${from}-${to}.csv`, [
      locale === "ja" ? ["決済日時", "金額 (JPY)", "方法", "状態", "予約ID", "決済ID"] : ["收款时间", "金额（日元）", "付款方式", "状态", "预约ID", "收款单ID"],
      ...rows.map(p=>[`${tokyoDateOf(fromIso(p.paidAt))} ${tokyoTimeOf(fromIso(p.paidAt))}`,p.amountJpy,p.method,p.status,p.appointmentId,p.id]),
    ]);
  }
  return (
    <div className="salon-page mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="mb-1 text-[11px] font-bold uppercase tracking-[.14em] text-[#79a28d]">PAYMENTS & RECONCILIATION</p><h1 className="text-2xl font-extrabold tracking-tight text-[#2f4c3d]">{t("admin.payments.title")}</h1><p className="mt-1 text-xs text-[#91a599]">{locale === "ja" ? "決済・返金履歴を管理" : "记录收款、追踪退款，核对实际流水"}</p></div><button type="button" className="salon-secondary" disabled={loading || loadError || rows.length===0} onClick={exportPayments}><Icon name="list" size={16}/>{locale === "ja" ? "表示中の取引をCSV出力" : "导出当前收款 CSV"}</button></div>

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
        {!loading && !loadError && from<=to && <div className="ml-auto rounded-xl border border-[#d9e8dd] bg-[#f1f8f2] px-4 py-2 text-sm text-[#43745b]">
          {locale === "ja" ? "表示中の取引合計（返金含む）" : "当前已加载流水合计（含退款）"}: <b className="ml-2 text-base font-extrabold tabular-nums text-[#245943]">{yen(total)}</b>
        </div>}
      </div>

      <form className={`flex flex-wrap items-end gap-2 p-4 ${cardCls}`} onSubmit={submitRecord}>
        <div className="min-w-44 flex-1">
          <Field label={`${t("admin.appointment.detail")} ID`}>
            <input className={inputCls} value={form.appointmentId} onChange={(e) => setForm({ ...form, appointmentId: e.target.value })} />
          </Field>
        </div>
        <div className="w-36">
          <Field label={t("admin.payments.amount")}>
            <input type="number" min={1} className={inputCls} value={form.amountJpy} onChange={(e) => setForm({ ...form, amountJpy: e.target.value })} required />
          </Field>
        </div>
        <div className="w-36">
          <Field label={t("admin.payments.method")}>
            <select className={inputCls} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`paymethod.${m}` as MessageKey)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="min-w-32 flex-1">
          <Field label={t("common.note")}>
            <input className={inputCls} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
        </div>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {t("admin.payments.record")}
        </button>
      </form>

      {from>to && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">{locale === "ja" ? "開始日は終了日以前にしてください" : "开始日期不能晚于结束日期"}</div>}
      {loadError && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><Icon name="info" size={16}/>{locale === "ja" ? "決済履歴を取得できませんでした" : "收银数据加载失败，无法核对金额"}<button type="button" className="font-bold underline" onClick={()=>{setLoading(true);void load();}}>{locale === "ja" ? "再試行" : "重试"}</button></div>}
      {loading ? (
        <Loading />
      ) : !loadError && from<=to && (
        <div className={`overflow-x-auto ${cardCls}`}>
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-4 py-2.5 font-medium">{t("common.time")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("admin.payments.amount")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.payments.method")}</th>
                <th className="px-4 py-2.5 font-medium">{t("common.status")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.appointment.detail")}</th>
                <th className="px-4 py-2.5 font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                    {tokyoDateOf(fromIso(p.paidAt))} {tokyoTimeOf(fromIso(p.paidAt))}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-medium ${p.amountJpy < 0 ? "text-red-500" : "text-slate-700"}`}>
                    {yen(p.amountJpy)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{t(`paymethod.${p.method}` as MessageKey)}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {p.amountJpy < 0 || p.status !== "paid" ? t("admin.payments.refund") : t("admin.payments.paid")}
                  </td>
                  <td className="max-w-36 truncate px-4 py-2.5 text-xs text-slate-400">{p.appointmentId ?? ""}</td>
                  <td className="px-4 py-2.5">
                    {p.amountJpy > 0 && p.status !== "refunded" && (
                      <button
                        type="button"
                        className={btnSmall}
                        onClick={() => {
                          setRefundTarget(p);
                          setRefundAmount(String(p.amountJpy));
                        }}
                      >
                        {t("admin.payments.refund")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-300">
                    {t("common.none")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {refundTarget && (
        <Modal title={t("admin.payments.refund")} onClose={() => setRefundTarget(null)}>
          <div className="flex flex-col gap-3">
            <div className="text-sm text-slate-500">
              {tokyoDateOf(fromIso(refundTarget.paidAt))} · {yen(refundTarget.amountJpy)} · {t(`paymethod.${refundTarget.method}` as MessageKey)}
            </div>
            <Field label={t("admin.payments.amount")}>
              <input type="number" min={1} max={refundTarget.amountJpy} className={inputCls} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setRefundTarget(null)}>
                {t("common.cancel")}
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void submitRefund()}>
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
