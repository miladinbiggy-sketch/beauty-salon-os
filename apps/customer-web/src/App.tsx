import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import type { Locale } from "@salon/shared";
import { useLocale } from "./lib/i18n";
import { BookingPage } from "./pages/BookingPage";
import { LookupPage } from "./pages/LookupPage";

const LOCALES: { locale: Locale; label: string }[] = [{locale:"ja",label:"日本語"},{locale:"zh-CN",label:"中文"}];
export function App() {
  const {t,locale,setLocale}=useLocale();
  const lookup=useLocation().pathname==="/lookup";
  return <div className="customer-shell min-h-dvh">
    <header className="relative z-10 mx-auto flex w-full max-w-[1100px] items-center justify-between gap-3 px-4 py-5 sm:px-7 sm:py-7">
      <Link to="/" className="flex min-w-0 items-center gap-3" aria-label={t("app.name")}>
        <span className="grid size-10 shrink-0 place-items-center rounded-[15px] bg-[#8d5162] text-[#ffebe8] shadow-[0_8px_22px_-9px_#94515f]"><svg viewBox="0 0 24 24" width="23" height="23" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/><path d="m19 2 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"/></svg></span>
        <span className="min-w-0"><span className="block truncate text-[15px] font-extrabold tracking-[.04em] text-[#644a50]">{t("app.name")}</span><span className="block text-[9px] font-bold uppercase tracking-[.19em] text-[#b09597]">Beauty booking studio</span></span>
      </Link>
      <div className="flex shrink-0 items-center rounded-full border border-[#ebdcd9] bg-white/90 p-1 shadow-[0_5px_20px_-15px_#65474d]" role="group" aria-label={t("common.language")}>
        {LOCALES.map(o=><button key={o.locale} type="button" aria-pressed={locale===o.locale} onClick={()=>setLocale(o.locale)} className={`min-h-9 rounded-full px-3 text-[11px] font-bold transition ${locale===o.locale ? "bg-[#805460] text-white shadow-sm" : "text-[#a79898] hover:text-[#855d67]"}`}>{o.label}</button>)}
      </div>
    </header>
    <main className="relative mx-auto w-full max-w-[1000px] px-4 pb-14 pt-3 sm:px-7 sm:pt-6">
      <div className="mb-6 hidden items-center justify-between gap-3 rounded-[22px] border border-white/80 bg-white/35 px-6 py-3 text-xs text-[#9e8489] backdrop-blur sm:flex"><div className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#7cae94]"/>{locale === "ja" ? "オンライン予約受付" : "线上预约服务"}</div><span>{locale === "ja" ? "メニュー選択 → 担当者 → 日時 → お客様情報" : "选择项目 → 选择技师 → 预约日期 → 填写信息"}</span></div>
      <div className="customer-panel relative mx-auto w-full max-w-[790px] overflow-hidden rounded-[26px] border border-[#f0e5e2] bg-white/95 p-4 shadow-[0_24px_80px_-46px_#835d66] sm:rounded-[32px] sm:p-8">
        <Routes><Route path="/" element={<BookingPage/>}/><Route path="/lookup" element={<LookupPage/>}/></Routes>
      </div>
      <nav className="mt-6 flex items-center justify-center text-center">
        <NavLink to={lookup?"/":"/lookup"} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#e9dad8] bg-white/70 px-5 text-xs font-semibold text-[#835f67] hover:bg-white">
          <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h12M4 18h8"/></svg>
          {lookup?t("customer.title"):t("customer.goLookup")}
        </NavLink>
      </nav>
      <footer className="mt-8 text-center text-[10px] tracking-wide text-[#b69ea1]">BEAUTY SALON OS · JAPAN / ASIA-TOKYO</footer>
    </main>
  </div>;
}
