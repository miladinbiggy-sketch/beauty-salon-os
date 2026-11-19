import { useEffect, useState } from "react";
import { api, downloadIntegrationExport } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { btnPrimary, btnSmall, cardCls, inputCls } from "../lib/ui";

interface Provider {
  id: string; country: "JP" | "CN" | "BOTH"; name: string;
  mode: string; bridgeConfigured: boolean; nativeConnected: boolean;
}
interface InboxEvent {
  id: string; provider: string; eventType: string; externalBookingRef: string;
  startAt: string | null; endAt: string | null; reviewState: string;
  linkedAppointmentId: string | null; createdAt: string;
}
const stateLabels: Record<string, { ja: string; zh: string }> = {
  pending: { ja: "確認待ち", zh: "待核对" },
  conflict: { ja: "予約重複の疑い", zh: "可能撞单" },
  needs_mapping: { ja: "担当者・メニュー未対応", zh: "待映射技师和项目" },
  linked: { ja: "既存予約と紐付け済", zh: "已关联预约" },
  ignored: { ja: "対応不要", zh: "已忽略" },
};
const providerModes: Record<string, { ja: string; zh: string }> = {
  manual_or_partner: { ja: "手動CSV／提携協議", zh: "手动导出／洽谈授权" },
  partner_approval: { ja: "パートナー審査・権限が必要", zh: "需申请平台合作权限" },
  official_api_separate: { ja: "公式APIは別途認証・開発", zh: "官方 API 需另行授权开发" },
  csv_ics_export: { ja: "CSV／ICSエクスポート", zh: "CSV／ICS 导出" },
  bridge_contract: { ja: "署名付き自社ブリッジ", zh: "签名合作方中转接口" },
};

export default function IntegrationsPage() {
  const { locale } = useI18n();
  const jp = locale === "ja";
  const [providers, setProviders] = useState<Provider[]>([]);
  const [inbox, setInbox] = useState<InboxEvent[]>([]);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ids, setIds] = useState<Record<string, string>>({});
  const [exportDate, setExportDate] = useState(() => new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date()));
  async function refresh() {
    setError("");
    try {
      const [p, e] = await Promise.all([
        api.get<Provider[]>("/admin/integrations/catalog"),
        api.get<InboxEvent[]>(`/admin/integrations/inbox?state=${encodeURIComponent(filter)}`),
      ]);
      setProviders(p); setInbox(e);
    } catch { setError(jp ? "接続状況を読み込めません" : "获取接入状态失败"); }
  }
  useEffect(() => { void refresh(); }, [filter]);
  async function resolve(event: InboxEvent, resolution: "linked" | "ignored") {
    setBusy(true); setError("");
    try {
      const body = resolution === "linked"
        ? { resolution, appointmentId: ids[event.id]?.trim() }
        : { resolution };
      await api.post(`/admin/integrations/inbox/${event.id}/resolve`, body);
      await refresh();
    } catch { setError(jp ? "照合に失敗しました。予約IDと時刻を確認してください" : "核对失败，请检查预约 UUID、所属门店和时间"); }
    finally { setBusy(false); }
  }
  async function exportFile(format: "csv" | "ics") {
    setBusy(true); setError("");
    try {
      const from = new Date(`${exportDate}T00:00:00+09:00`);
      const to = new Date(from.getTime() + 7 * 86400000);
      if (Number.isNaN(from.getTime())) throw new Error("Invalid date");
      await downloadIntegrationExport(format, from.toISOString(), to.toISOString());
    } catch { setError(jp ? "書き出しに失敗しました" : "导出失败"); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 pb-12">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-bold text-[#284b3c]">{jp ? "外部サービス連携" : "中日平台接入中心"}</h1>
      <p className="mt-1 text-xs text-slate-500">{jp ? "API・提携ブリッジ・CSV/ICSの接続窓口" : "官方 API、授权中转和 CSV/ICS 的统一入口"}</p></div>
      <button type="button" className={btnSmall} onClick={() => void refresh()}>{jp ? "更新" : "刷新"}</button>
    </div>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900">
      {jp ? "「設定済」は当サロンの署名ブリッジ鍵だけを示します。外部サービスとの公式接続や予約自動同期を意味しません。入った予約は承認待ちで、既存の予約表に自動登録されません。" :
        "“已配置”仅表示自有签名中转密钥就绪，不代表取得平台官方接口授权。外部预约先进入待核对队列，不自动占用技师、工位，也不会触发扣款。"}
    </div>
    <section className={`${cardCls} p-4`}>
      <h2 className="mb-3 text-sm font-bold text-[#375649]">{jp ? "日本・中国の接続候補" : "日本与中国平台适配目录"}</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {providers.map((p) => <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#e7ece7] p-3">
          <div className="min-w-0"><div className="text-xs font-bold text-[#315245]">{p.name} <span className="text-[10px] text-slate-400">{p.country}</span></div>
            <div className="mt-1 text-[11px] text-slate-500">{providerModes[p.mode]?.[jp ? "ja" : "zh"] ?? p.mode}</div></div>
          <span className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold ${p.bridgeConfigured ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {p.bridgeConfigured ? (jp ? "ブリッジ鍵設定済" : "中转密钥就绪") : (jp ? "未接続" : "尚未连接")}
          </span>
        </div>)}
      </div>
    </section>
    <section className={`${cardCls} p-4`}>
      <h2 className="mb-3 text-sm font-bold text-[#375649]">{jp ? "日時枠だけ書き出す（個人情報なし）" : "预约时间占用导出（无顾客信息）"}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-slate-600">{jp ? "開始日（日本時間）" : "起始日期（日本时间）"}
          <input aria-label={jp ? "開始日" : "起始日期"} type="date" className={`${inputCls} mt-1`} value={exportDate} onChange={(e) => setExportDate(e.target.value)}/></label>
        <button className={btnSmall} disabled={busy} onClick={() => void exportFile("csv")}>CSV / Excel</button>
        <button className={btnSmall} disabled={busy} onClick={() => void exportFile("ics")}>ICS / Google Calendar</button>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{jp ? "7日間の時刻・状態だけ。CSV/ICSを手動で読み込めます。同期は自動ではありません。" : "导出所选日期起 7 天的预约时段及状态。可手动导入支持 CSV/ICS 的平台，不是实时双向同步。"}</p>
    </section>
    <section className={`${cardCls} p-4`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-[#375649]">{jp ? "外部予約の照合待ち" : "外部预约待核对队列"}</h2>
        <select aria-label={jp ? "状態を絞る" : "筛选状态"} className="rounded-lg border p-2 text-xs" value={filter} onChange={(e)=>setFilter(e.target.value)}>
          <option value="all">{jp ? "すべて" : "全部"}</option>
          {Object.entries(stateLabels).map(([key,labels]) => <option key={key} value={key}>{jp ? labels.ja : labels.zh}</option>)}
        </select>
      </div>
      {inbox.length === 0 && <p className="text-xs text-slate-500">{jp ? "受信済みイベントなし" : "暂时没有外部预约事件"}</p>}
      <div className="space-y-3">{inbox.map((r) => <div key={r.id} className="rounded-xl border border-[#e4eae4] p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{r.provider}</strong><span>{stateLabels[r.reviewState]?.[jp ? "ja" : "zh"] ?? r.reviewState}</span></div>
        <p className="mt-1 break-all text-slate-500">{r.eventType} · {r.externalBookingRef}</p>
        <p className="mt-1 text-slate-600">{r.startAt ? new Date(r.startAt).toLocaleString(jp ? "ja-JP" : "zh-CN", {timeZone:"Asia/Tokyo"}) : "—"}</p>
        {!["ignored","linked"].includes(r.reviewState) && <div className="mt-3 flex flex-wrap items-center gap-2">
          <input aria-label={jp ? "既存予約UUID" : "已有预约 UUID"} className={`${inputCls} max-w-[300px]`} placeholder={jp ? "確認済の既存予約 UUID" : "已核对的本地预约 UUID"} value={ids[r.id] ?? ""} onChange={(e)=>setIds({...ids,[r.id]:e.target.value})}/>
          <button className={btnPrimary} disabled={busy || !ids[r.id]} onClick={()=>void resolve(r,"linked")}>{jp ? "既存予約に紐付け" : "关联已有预约"}</button>
          <button className={btnSmall} disabled={busy} onClick={()=>void resolve(r,"ignored")}>{jp ? "対応不要" : "忽略事件"}</button>
        </div>}
      </div>)}</div>
    </section>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
  </div>;
}
