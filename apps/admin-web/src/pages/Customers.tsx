import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fromIso, tokyoDateOf, tokyoTimeOf } from "@salon/shared";
import { api, type Customer, type CustomerDetail } from "../lib/api";
import { useI18n } from "../lib/i18n";
import CareRecords from "./CareRecords";
import { saveCsv } from "../lib/export-csv";
import { Icon } from "../lib/icons";
import { btnPrimary, cardCls, Field, inputCls, Loading, StatusBadge, useToast, useYen } from "../lib/ui";

export default function CustomersPage() {
  const { t, locale } = useI18n();
  const yen = useYen();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const loadSequence = useRef(0);

  const load = useCallback(async (query: string) => {
    const request = ++loadSequence.current;
    try {
      const result = await api.get<Customer[]>(`/admin/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      if (request === loadSequence.current) {setRows(result);setLoadError(false);}
    } catch {
      if (request === loadSequence.current) {setRows([]);setLoadError(true);}
    } finally {
      if (request === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    void load(q.trim());
  }

  function exportRows() {
    saveCsv(`salon-customers-${new Date().toISOString().slice(0,10)}.csv`, [
      locale === "ja" ? ["氏名", "フリガナ", "電話", "メール", "来店回数", "累計購入額 (JPY)"] : ["姓名", "假名", "电话", "邮箱", "到店次数", "累计消费（日元）"],
      ...rows.map(c=>[c.name,c.nameKana,c.phone,c.email,c.visitCount,c.totalSpentJpy]),
    ]);
  }
  return (
    <div className="salon-page mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="mb-1 text-[11px] font-bold uppercase tracking-[.14em] text-[#79a28d]">CUSTOMER RELATIONSHIP</p><h1 className="text-2xl font-extrabold tracking-tight text-[#2f4c3d]">{t("admin.nav.customers")}</h1><p className="mt-1 text-xs text-[#91a599]">{locale === "ja" ? "お客様の来店履歴・カルテ・利用状況を確認" : "集中查看顾客档案、护理记录与到店消费历史"}</p></div>
        <button type="button" disabled={loading || loadError || rows.length===0} className="salon-secondary" onClick={exportRows}><Icon name="list" size={16}/>{locale === "ja" ? "表示中の一覧をCSV出力" : "导出当前客户名单 CSV"}</button>
      </div>
      <form className="salon-surface flex flex-wrap items-center gap-2 p-3" onSubmit={onSearch}>
        <div className="relative min-w-[175px] flex-1"><Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9cafa1]"/><input className={`${inputCls} !pl-9`} value={q} onChange={e=>setQ(e.target.value)} placeholder={`${t("common.name")} / ${t("common.phone")}`} aria-label={locale === "ja" ? "顧客検索" : "搜索客户"}/></div>
        <button type="submit" className={btnPrimary}><Icon name="search" size={16}/>{t("common.search")}</button>
        {q && <button type="button" className="salon-secondary" onClick={()=>{setQ("");setLoading(true);void load("");}}>{locale==="ja" ? "解除" : "清除"}</button>}
      </form>
      {loadError && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">{locale === "ja" ? "顧客データを取得できませんでした。" : "顾客数据加载失败，请检查网络后重试。"}<button type="button" className="font-bold underline" onClick={()=>{setLoading(true);void load(q.trim());}}>{locale === "ja" ? "再試行" : "重试"}</button></div>}
      {loading ? <Loading/> : !loadError && <section className="salon-surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#edf2ec] px-4 py-3"><h2 className="text-sm font-bold text-[#385749]">{locale === "ja" ? "顧客リスト" : "客户列表"}</h2><span className="salon-pill">{rows.length} {locale === "ja" ? "件" : "人"}</span></div>
        <div className="divide-y divide-[#f0f3ef] sm:hidden">{rows.map(c=><Link key={c.id} to={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[#f5f8f4]"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e7f2e9] text-sm font-bold text-[#42735c]">{c.name.slice(0,1)}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-[#335141]">{c.name}</div><div className="mt-0.5 text-xs text-[#91a298]">{c.phone}</div><div className="mt-1 text-[11px] text-[#698577]">{locale === "ja" ? "来店" : "到店"} {c.visitCount} · {yen(c.totalSpentJpy)}</div></div><Icon name="chevron-right" size={16} className="text-[#a5b6aa]"/></Link>)}</div>
        <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b border-[#edf2ec] bg-[#fbfcfb] text-left text-xs text-[#9bad9e]"><th className="px-5 py-3 font-medium">{t("common.name")}</th><th className="px-5 py-3 font-medium">{t("common.phone")}</th><th className="px-5 py-3 text-right font-medium">{t("admin.customers.visits")}</th><th className="px-5 py-3 text-right font-medium">{t("admin.customers.totalSpent")}</th><th className="px-5 py-3"/></tr></thead><tbody>{rows.map(c=><tr key={c.id} className="cursor-pointer border-b border-[#f2f5f1] transition hover:bg-[#f6faf7]" onClick={()=>navigate(`/customers/${c.id}`)}><td className="max-w-[240px] truncate px-5 py-3 font-bold text-[#385548]">{c.name}</td><td className="px-5 py-3 text-[#74877b]">{c.phone}</td><td className="px-5 py-3 text-right tabular-nums text-[#6e8677]">{c.visitCount}</td><td className="px-5 py-3 text-right font-semibold tabular-nums text-[#416352]">{yen(c.totalSpentJpy)}</td><td className="px-5 py-3 text-[#91ae9c]"><Icon name="chevron-right" size={15}/></td></tr>)}</tbody></table></div>
        {rows.length===0 && <div className="px-4 py-10 text-center text-xs text-[#9dada1]">{t("common.none")}</div>}
      </section>}
      <p className="text-[10px] leading-5 text-[#9aaca0]">{locale === "ja" ? "CSVには現在画面に読み込まれた顧客のみ出力されます。取扱いにはご注意ください。" : "CSV 仅导出当前已加载的客户记录，包含联系方式，请妥善保存并控制分享范围。"}</p>
    </div>
  );
}

export function CustomerDetailPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const yen = useYen();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", nameKana: "", phone: "", email: "", notes: "", tags: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api.get<CustomerDetail>(`/admin/customers/${id}`);
      setDetail(d);
      setForm({
        name: d.name,
        nameKana: d.nameKana ?? "",
        phone: d.phone,
        email: d.email ?? "",
        notes: d.notes ?? "",
        tags: (d.tags ?? []).join(", "),
      });
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setBusy(true);
    try {
      await api.put(`/admin/customers/${id}`, {
        name: form.name.trim(),
        nameKana: form.nameKana.trim() || null,
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
        tags: form.tags
          .split(/[,、]/)
          .map((x) => x.trim())
          .filter(Boolean),
      });
      toast(t("common.saved"));
      await load();
    } catch {
      toast(t("common.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (!detail) {
    return (
      <div className="p-4">
        <Link className="text-sm text-[#337b62]" to="/customers">
          ← {t("common.back")}
        </Link>
        <div className="py-10 text-center text-slate-300">{t("customer.notFound")}</div>
      </div>
    );
  }

  const lastVisit = detail.history.find((h) => h.status === "completed");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <div>
        <Link className="text-sm text-[#337b62]" to="/customers">
          ← {t("common.back")}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="min-w-0 truncate text-lg font-semibold text-slate-800">{detail.name}</h1>
        <span className="text-sm text-slate-500">{detail.phone}</span>
        <span className="text-sm text-slate-500">
          {t("admin.customers.visits")}: {detail.visitCount}
        </span>
        <span className="text-sm text-slate-500">
          {t("admin.customers.totalSpent")}: {yen(detail.totalSpentJpy)}
        </span>
        {lastVisit && (
          <span className="text-sm text-slate-500">
            {t("admin.customers.lastVisit")}: {tokyoDateOf(fromIso(lastVisit.startAt))}
          </span>
        )}
      </div>
      {(detail.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {detail.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-[#e6f2ea] px-2 py-0.5 text-xs text-[#337b62]">
              {tag}
            </span>
          ))}
        </div>
      )}

      <form className={`grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 ${cardCls}`} onSubmit={save}>
        <Field label={t("common.name")}>
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <Field label="kana">
          <input className={inputCls} value={form.nameKana} onChange={(e) => setForm({ ...form, nameKana: e.target.value })} />
        </Field>
        <Field label={t("common.phone")}>
          <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
        </Field>
        <Field label={t("common.email")}>
          <input type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("admin.customers.tags")}>
            <input className={inputCls} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="VIP, …" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t("common.note")}>
            <textarea className={inputCls} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" className={btnPrimary} disabled={busy}>
            {t("common.save")}
          </button>
        </div>
      </form>

      <CareRecords customerId={detail.id} />

      <section className={`p-4 ${cardCls}`}>
        <h2 className="mb-3 text-base font-semibold text-slate-800">{t("admin.customers.history")}</h2>
        <div className="flex flex-col gap-1.5">
          {detail.history.length === 0 && <div className="text-sm text-slate-300">{t("common.none")}</div>}
          {detail.history.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-600">
                {tokyoDateOf(fromIso(h.startAt))} {tokyoTimeOf(fromIso(h.startAt))}–{tokyoTimeOf(fromIso(h.endAt))}
              </span>
              <StatusBadge status={h.status} />
              <span className="ml-auto text-slate-700">{yen(h.totalPriceJpy)}</span>
              <span className="text-xs text-slate-300">{h.bookingCode}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
