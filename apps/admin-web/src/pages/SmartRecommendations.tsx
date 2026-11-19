import { useEffect, useState } from "react";
import { fromIso, tokyoDateOf, tokyoTimeOf } from "@salon/shared";
import { api, type Service, type StaffMember } from "../lib/api";
import { localizedName, useI18n } from "../lib/i18n";
import { btnGhost, btnPrimary, inputCls, useYen } from "../lib/ui";

type Strategy = "earliest" | "compact" | "balanced";
type Reason = "earliest_slot" | "reduces_fragments" | "balanced_load" | "no_new_fragments";
interface Suggestion { staffId: string; startAt: string; endAt: string; totalPriceJpy: number; score: number; reasons: Reason[]; metrics: { fragmentMinutes: number; occupiedMinutes: number; dailyLoadPercent: number } }

/** Management-only slot recommender. Clicking a slot opens the existing booking form; no hidden auto-booking. */
export default function SmartRecommendations({ date, services, staff, onPick }: {
  date: string; services: Service[]; staff: StaffMember[];
  onPick: (value: { date: string; time: string; staffId?: string; serviceId?: string }) => void;
}) {
  const { locale } = useI18n();
  const yen = useYen();
  const ja = locale === "ja";
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [strategy, setStrategy] = useState<Strategy>("compact");
  const [slots, setSlots] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setSlots([]); setError(""); }, [date, serviceId, staffId, strategy]);
  async function search() {
    if (!serviceId) return;
    setBusy(true); setError("");
    try {
      const data = await api.post<{ slots: Suggestion[] }>("/admin/schedule/recommendations", {
        date, selections: [{ serviceId }], ...(staffId ? { staffId } : {}), strategy, limit: 8,
      });
      setSlots(data.slots);
    } catch { setError(ja ? "候補時間の取得に失敗しました" : "获取推荐时间失败"); }
    finally { setBusy(false); }
  }
  const reasons: Record<Reason, string> = ja
    ? { earliest_slot: "最短予約", reduces_fragments: "空き時間を改善", balanced_load: "担当負荷を分散", no_new_fragments: "短い空きを作らない" }
    : { earliest_slot: "最早可约", reduces_fragments: "减少碎片空档", balanced_load: "均衡技师负载", no_new_fragments: "不产生短碎片" };
  return <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
    <button type="button" aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen(!open)}>
      <span className="text-sm font-semibold text-slate-800">✦ {ja ? "スマート空き時間提案" : "智能空档推荐"}</span>
      <span className="text-xs text-slate-500">{open ? "−" : "+"}</span>
    </button>
    {open && <div className="flex flex-col gap-3 border-t border-slate-100 px-4 pb-4 pt-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600">{ja ? "施術メニュー" : "选择项目"}
          <select className={inputCls} value={serviceId} onChange={e => setServiceId(e.target.value)}>
            <option value="">{ja ? "選択してください" : "请选择项目"}</option>
            {services.filter(x => x.active).map(s => <option key={s.id} value={s.id}>{localizedName(locale,s.nameZh,s.nameJa)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">{ja ? "担当者" : "技师"}
          <select className={inputCls} value={staffId} onChange={e => setStaffId(e.target.value)}>
            <option value="">{ja ? "おまかせ" : "智能分配"}</option>
            {staff.filter(x => x.active).map(s => <option key={s.id} value={s.id}>{s.nameJa || s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">{ja ? "最適化モード" : "优化策略"}
          <select className={inputCls} value={strategy} onChange={e => setStrategy(e.target.value as Strategy)}>
            <option value="compact">{ja ? "空き時間を有効活用" : "减少碎片空档"}</option>
            <option value="earliest">{ja ? "最も早い予約" : "优先最早可约"}</option>
            <option value="balanced">{ja ? "担当者の負荷を均等化" : "均衡技师负载"}</option>
          </select>
        </label>
      </div>
      <button type="button" className={`${btnPrimary} self-start`} disabled={!serviceId || busy} onClick={() => void search()}>{busy ? "…" : ja ? "空き枠を検索" : "计算推荐时间"}</button>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {slots.map(slot => <button type="button" key={`${slot.staffId}:${slot.startAt}`} className="rounded-xl border border-slate-200 p-3 text-left transition hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-500"
          onClick={() => onPick({ date: tokyoDateOf(fromIso(slot.startAt)), time: tokyoTimeOf(fromIso(slot.startAt)), staffId: slot.staffId, serviceId })}>
          <div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-800">{tokyoTimeOf(fromIso(slot.startAt))}–{tokyoTimeOf(fromIso(slot.endAt))}</span><span className="text-xs font-semibold text-blue-600">{Math.round(slot.score)}</span></div>
          <div className="mt-1 text-xs text-slate-500">{staff.find(x => x.id === slot.staffId)?.nameJa || staff.find(x => x.id === slot.staffId)?.name} · {yen(slot.totalPriceJpy)}</div>
          <div className="mt-2 flex flex-wrap gap-1">{slot.reasons.map(r => <span key={r} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{reasons[r]}</span>)}</div>
        </button>)}
      </div>
      {slots.length === 0 && !busy && !error && <p className="text-xs text-slate-500">{ja ? "条件を設定して検索してください。提案枠は予約確定ではありません。" : "选择条件后搜索；推荐时间不代表已经锁定，提交预约仍会再次校验。"}</p>}
      <button className={`${btnGhost} self-end text-xs`} type="button" onClick={() => setOpen(false)}>{ja ? "閉じる" : "收起"}</button>
    </div>}
  </section>;
}
