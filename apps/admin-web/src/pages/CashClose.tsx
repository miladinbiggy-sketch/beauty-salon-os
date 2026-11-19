import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { todayTokyo } from "@salon/shared";
import { api, type CashClosePreview, type CashCloseSnapshot } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { btnGhost, btnPrimary, cardCls, Field, inputCls, Loading, Modal, useToast, useYen } from "../lib/ui";
import type { MessageKey } from "@salon/i18n";
import { Icon } from "../lib/icons";

/** Manager/owner ledger close: live database preview, explicit physical count, immutable snapshot. */
export default function CashClosePage() {
  const { locale, t } = useI18n();
  const ja = locale === "ja";
  const { toast } = useToast();
  const yen = useYen();
  const [date, setDate] = useState(todayTokyo());
  const [preview, setPreview] = useState<CashClosePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [opening, setOpening] = useState("0");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [askConfirm, setAskConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const req = ++seq.current;
    setLoading(true);
    try {
      const result = await api.get<CashClosePreview>(`/admin/cash-close/preview?date=${encodeURIComponent(date)}`);
      if (req !== seq.current) return;
      setPreview(result);
      setLoadError(false);
    } catch {
      if (req !== seq.current) return;
      setPreview(null);
      setLoadError(true);
    } finally {
      if (req === seq.current) setLoading(false);
    }
  }, [date]);
  useEffect(() => { void load(); return () => { seq.current++; }; }, [load]);

  const balance = preview?.summary.cashNetJpy ?? 0;
  const actualOpening = Number(opening);
  const actualCounted = Number(counted);
  const validAmounts = opening.trim() !== "" && counted.trim() !== ""
    && Number.isSafeInteger(actualOpening) && actualOpening >= 0 && actualOpening <= 100_000_000
    && Number.isSafeInteger(actualCounted) && actualCounted >= 0 && actualCounted <= 100_000_000;
  const expected = actualOpening + balance;
  const variance = actualCounted - expected;
  const canClose = preview?.date === date && !preview?.closed && !loading && !loadError && validAmounts && expected >= 0 && date <= todayTokyo()
    && (!variance || note.trim().length >= 3);

  async function confirmClose() {
    if (!canClose || !preview) return;
    setBusy(true);
    try {
      const snapshot = await api.post<CashCloseSnapshot>("/admin/cash-close", {
        date, openingCashJpy: actualOpening, countedCashJpy: actualCounted,
        expectedTransactionCount: preview.summary.transactionCount, note: note.trim(),
      });
      setAskConfirm(false);
      toast(ja ? "締め処理が完了しました" : "日结完成，账目已锁定");
      setPreview({ date, summary: preview.summary, closed: snapshot });
      await load();
    } catch {
      setAskConfirm(false);
      toast(ja ? "締め処理に失敗。最新の入出金を確認してください" : "日结失败：可能有新流水或已被他人锁账，请重新核对", "error");
      await load();
    } finally { setBusy(false); }
  }

  const closed = preview?.closed;
  const summary = preview?.summary;
  const showJpy = (value: number) => yen(value);
  function submit(e: FormEvent) { e.preventDefault(); if (canClose) setAskConfirm(true); }
  return <div className="salon-page mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="mb-1 text-[11px] font-extrabold uppercase tracking-[.18em] text-[#75a38a]">DAILY CASH CLOSE</p>
        <h1 className="text-2xl font-extrabold tracking-tight text-[#2a4d40]">{ja ? "日次締め・現金照合" : "营业日结 · 现金对账"}</h1>
        <p className="mt-2 text-sm text-[#7a9486]">{ja ? "入出金を確認し、実際の現金残高との誤差を記録して締めます。" : "核对收退款、清点实际现金，保存不能随意修改的日结记录。"}</p>
      </div>
      <div className="flex items-end gap-2">
        <Field label={ja ? "営業日（日本時間）" : "营业日期（日本时间）"}>
          <input type="date" className={inputCls} max={todayTokyo()} value={date} onChange={e=>{if(e.target.value){setDate(e.target.value);setCounted("");setNote("");}}}/>
        </Field>
        <button type="button" className={btnGhost} onClick={()=>void load()} disabled={loading} aria-label={ja ? "再読み込み" : "刷新日结"}><Icon name="clock" size={17}/></button>
      </div>
    </div>
    {loadError && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{ja ? "帳簿を取得できませんでした。締め処理はできません。" : "账簿数据加载失败，已禁用日结。"}</div>}
    {loading ? <Loading/> : summary && <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([
          [ja ? "入金総額" : "收入总额", summary.receivedJpy],
          [ja ? "返金総額" : "退款总额", -summary.refundedJpy],
          [ja ? "入出金差引" : "收付净额", summary.netJpy],
          [ja ? "現金差引" : "现金净流入", summary.cashNetJpy],
        ] as const).map(([label, amount])=><div key={label} className={`${cardCls} p-4`}><p className="text-xs font-semibold text-[#81998a]">{label}</p><p className="mt-2 text-2xl font-extrabold tabular-nums text-[#2b5443]">{showJpy(amount)}</p></div>)}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <section className={`${cardCls} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-[#e4ede5] px-5 py-4"><h2 className="text-base font-bold text-[#315344]">{ja ? "決済方法別内訳" : "按收款渠道核对"}</h2><span className="text-xs text-[#81978b]">{summary.transactionCount} {ja ? "取引" : "笔流水"}</span></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[350px] text-sm">
            <thead><tr className="border-b border-[#e5ece6] text-left text-xs text-[#8b9d91]"><th className="px-4 py-3">{ja ? "支払方法" : "支付方式"}</th><th className="px-4 py-3 text-right">{ja ? "入金" : "收入"}</th><th className="px-4 py-3 text-right">{ja ? "返金" : "退款"}</th><th className="px-4 py-3 text-right">{ja ? "差引" : "净额"}</th></tr></thead>
            <tbody>{summary.methods.map(m=><tr key={m.method} className="border-b border-[#f0f3ef]"><td className="px-4 py-3 font-medium text-[#4f705e]">{m.method in { cash:1,card:1,paypay:1,line_pay:1,bank_transfer:1,other:1 } ? t(`paymethod.${m.method}` as MessageKey) : m.method}</td><td className="px-4 py-3 text-right tabular-nums">{showJpy(m.receivedJpy)}</td><td className="px-4 py-3 text-right tabular-nums text-red-500">{showJpy(-m.refundedJpy)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{showJpy(m.netJpy)}</td></tr>)}</tbody>
          </table></div>
          {summary.methods.length === 0 && <p className="px-5 py-5 text-sm text-[#90a295]">{ja ? "この日の入出金はありません。" : "该营业日没有收退款流水。"}</p>}
          <p className="px-5 py-4 text-xs leading-5 text-[#829789]">{ja ? "この集計はサーバー側の全明細から作成し、画面の取引件数制限には依存しません。" : "汇总取自服务器全部流水，不受收银页面最多显示500笔的限制。"}</p>
        </section>
        <section className={`${cardCls} p-5`}>
          {closed ? <div className="space-y-3">
            <div className="flex items-center gap-2 text-[#37795c]"><Icon name="check" size={19}/><b>{ja ? "締め済み（編集不可）" : "已完成日结（锁账）"}</b></div>
            <p className="text-xs text-[#889c8f]">{ja ? "締め日時" : "结账时间"}: {new Date(closed.closedAt).toLocaleString(ja ? "ja-JP" : "zh-CN", { timeZone:"Asia/Tokyo" })}</p>
            <div className="grid grid-cols-2 gap-3 text-sm">{([
              [ja ? "釣銭準備金" : "开店备用金", closed.openingCashJpy],
              [ja ? "現金理論残高" : "应有现金", closed.expectedCashJpy],
              [ja ? "実際現金" : "实点现金", closed.countedCashJpy],
              [ja ? "過不足" : "现金差额", closed.varianceJpy],
            ] as const).map(([label,value])=><div key={label} className="rounded-xl bg-[#f5f8f5] p-3"><p className="text-xs text-[#8fa394]">{label}</p><b className={`mt-1 block tabular-nums ${label.includes("不足") || label.includes("差额") ? "text-[#a26431]" : "text-[#355645]"}`}>{showJpy(value)}</b></div>)}</div>
            {closed.note && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{closed.note}</p>}
            <p className="text-xs leading-6 text-[#789182]">{ja ? "締めた営業日には入金・返金の追記はできません。修正は別途承認された訂正手順が必要です。" : "已锁营业日不允许补记或倒填收退款；如需修正，应走单独审批流程。"}</p>
          </div> : <form className="space-y-4" onSubmit={submit}>
            <h2 className="text-base font-bold text-[#315344]">{ja ? "現金実査・締め確定" : "现金清点与锁账"}</h2>
            <Field label={ja ? "営業開始時の釣銭準備金 (¥)" : "开店备用现金（¥）"}><input type="number" min="0" max="100000000" step="1" className={inputCls} value={opening} onChange={e=>setOpening(e.target.value)} required/></Field>
            <div className="rounded-xl bg-[#f4f8f4] px-3 py-4"><p className="text-xs text-[#7d9786]">{ja ? "理論上の締め現金" : "理论应有现金"}</p><b className="mt-1 block text-xl tabular-nums text-[#2d5c47]">{validAmounts ? showJpy(expected) : showJpy(Number.isFinite(expected)?expected:0)}</b><p className="mt-1 text-xs text-[#9aa99e]">{ja ? "準備金 + 現金入出金差額" : "备用金＋当天现金净流入"}</p></div>
            <Field label={ja ? "実際に数えた現金 (¥)" : "实际清点现金（¥）"}><input type="number" min="0" max="100000000" step="1" className={inputCls} value={counted} onChange={e=>setCounted(e.target.value)} placeholder="0" required/></Field>
            {validAmounts && <p className={`rounded-xl p-3 text-sm ${variance===0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{ja ? "現金の過不足" : "现金盘点差额"}: <b>{showJpy(variance)}</b></p>}
            <Field label={ja ? "差額がある場合の理由（必須）" : "差额原因（有差额时必填）"}><textarea className={`${inputCls} min-h-[88px]`} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder={ja ? "差異の確認内容" : "交班备注／盘点差异原因"}/></Field>
            <button type="submit" className={`${btnPrimary} w-full justify-center`} disabled={!canClose || busy}><Icon name="check" size={16}/>{ja ? "日次締めを確定" : "确认日结并锁账"}</button>
            <p className="text-xs leading-5 text-[#ad8056]">{ja ? "確定すると同日の取引追記・変更はブロックされます。必ず営業終了後に行ってください。" : "确认后不能继续在该日期收款或退款，请务必在营业结束后操作。"}</p>
          </form>}
        </section>
      </div>
    </>}
    {askConfirm && <Modal title={ja ? "日次締めの最終確認" : "确认锁定当天账目"} onClose={()=>{if(!busy)setAskConfirm(false);}}>
      <div className="space-y-4 text-sm text-[#526c5b]">
        <p>{ja ? `${date} の帳簿を確定します。締め後に取引の追加はできません。` : `确认锁定 ${date} 的营业账目。锁账后不能再新增该日流水。`}</p>
        <div className="rounded-xl bg-[#eff6f0] p-3 font-semibold">{ja ? "現金差異" : "现金差异"}: {showJpy(variance)}</div>
        <div className="flex justify-end gap-2"><button className={btnGhost} type="button" onClick={()=>setAskConfirm(false)} disabled={busy}>{t("common.cancel")}</button><button type="button" className={btnPrimary} onClick={()=>void confirmClose()} disabled={busy}>{ja ? "確定する" : "最终确认"}</button></div>
      </div>
    </Modal>}
  </div>;
}
