import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { btnPrimary, cardCls, inputCls, useToast } from "../lib/ui";

export interface CareRecord {
  id: string;
  category: "nail" | "lash" | "beauty";
  details: Record<string, string | number>;
  memo: string | null;
  createdAt: string;
}
const CATEGORIES = ["nail", "lash", "beauty"] as const;
const FIELDS = {
  nail: ["shape", "design", "color", "products"],
  lash: ["curl", "lengthMm", "density", "style"],
  beauty: ["treatment", "products", "aftercare"],
} as const;
const LABELS: Record<string, [string, string]> = {
  nail: ["美甲", "ネイル"], lash: ["美睫", "まつげ"], beauty: ["美容", "エステ"],
  shape: ["甲型", "爪の形"], design: ["款式", "デザイン"], color: ["颜色", "カラー"], products: ["使用产品", "使用製品"],
  curl: ["卷翘", "カール"], lengthMm: ["长度（毫米）", "長さ（mm）"], density: ["密度", "本数・密度"],
  style: ["款式", "スタイル"], treatment: ["护理项目", "施術メニュー"], aftercare: ["后续护理建议", "アフターケア"],
};

/** Append-only service history; separate from basic customer notes and never available to the public booking site. */
export default function CareRecords({ customerId }: { customerId: string }) {
  const { locale } = useI18n(); const ja = locale === "ja";
  const { toast } = useToast();
  const label = (key: string) => LABELS[key]?.[ja ? 1 : 0] ?? key;
  const [items, setItems] = useState<CareRecord[]>([]);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("nail");
  const [values, setValues] = useState<Record<string, string>>({});
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    try { setItems(await api.get<CareRecord[]>(`/admin/customers/${customerId}/care-records`)); }
    catch { setError(ja ? "カルテの読み込みに失敗しました" : "护理记录加载失败"); }
  }, [customerId, ja]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function create(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError("");
    const details: Record<string, string | number> = {};
    for (const field of FIELDS[category]) {
      if (values[field]?.trim()) details[field] = field === "lengthMm" ? Number(values[field]) : values[field]!.trim();
    }
    try {
      await api.post(`/admin/customers/${customerId}/care-records`, { category, details, memo: memo.trim() || null });
      setValues({}); setMemo(""); await refresh();
      toast(ja ? "カルテを保存しました" : "护理记录已保存");
    } catch { setError(ja ? "保存に失敗しました" : "保存失败，请检查输入内容和权限"); }
    finally { setSaving(false); }
  }
  return <section className={`${cardCls} flex flex-col gap-4 p-4`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-800">{ja ? "電子カルテ・施術履歴" : "电子护理档案 · 服务记录"}</h2><span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{ja ? "スタッフ限定" : "仅授权员工可见"}</span></div>
    <p className="text-xs leading-relaxed text-slate-500">{ja ? "施術情報のみ記録してください。医療診断・不要な機微情報を入力しないでください。保存後は履歴として残ります。" : "仅记录必要的美容服务信息，不填写医疗诊断或不必要的敏感资料。已保存的记录会作为历史保留。"}</p>
    <form className="rounded-xl border border-slate-200 bg-slate-50/70 p-3" onSubmit={e => void create(e)}>
      <div className="mb-3 flex flex-wrap gap-2">{CATEGORIES.map(c => <button type="button" key={c} onClick={() => { setCategory(c); setValues({}); }} className={`rounded-full px-3 py-1.5 text-xs ${category === c ? "bg-slate-900 text-white" : "border bg-white text-slate-600"}`}>{label(c)}</button>)}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{FIELDS[category].map(k => <label key={k} className="flex flex-col gap-1 text-xs text-slate-600">{label(k)}<input type={k === "lengthMm" ? "number" : "text"} min={k === "lengthMm" ? 1 : undefined} max={k === "lengthMm" ? 30 : undefined} step={k === "lengthMm" ? 0.5 : undefined} className={inputCls} value={values[k] ?? ""} onChange={e => setValues({ ...values, [k]: e.target.value })}/></label>)}</div>
      <label className="mt-3 flex flex-col gap-1 text-xs text-slate-600">{ja ? "施術メモ" : "服务备注"}<textarea className={inputCls} rows={2} maxLength={1200} value={memo} onChange={e => setMemo(e.target.value)}/></label>
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      <button type="submit" className={`${btnPrimary} mt-3`} disabled={saving}>{saving ? "…" : ja ? "カルテを追加" : "新增护理记录"}</button>
    </form>
    <div className="space-y-3">{items.map(item => <article key={item.id} className="rounded-xl border border-slate-100 p-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><strong className="text-slate-800">{label(item.category)}</strong><time className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString(ja ? "ja-JP" : "zh-CN", { timeZone: "Asia/Tokyo" })}</time></div>
      <div className="mt-2 flex flex-wrap gap-2">{Object.entries(item.details).map(([k,v]) => <span key={k} className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">{label(k)}: {String(v)}</span>)}</div>
      {item.memo && <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{item.memo}</p>}
    </article>)}{items.length===0 && <p className="text-xs text-slate-400">{ja ? "カルテはまだありません" : "尚无护理记录"}</p>}</div>
  </section>;
}
