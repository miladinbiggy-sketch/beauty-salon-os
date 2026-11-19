import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Icon } from "../lib/icons";
import { Field, inputCls } from "../lib/ui";

export default function LoginPage() {
  const {user,login,ready}=useAuth();
  const {t,locale,setLocale}=useI18n();
  const navigate=useNavigate();
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [showPassword,setShowPassword]=useState(false);
  if (!ready) return <div className="grid min-h-dvh place-items-center text-sm text-slate-500">Loading…</div>;
  if (user) return <Navigate to="/" replace/>;
  async function onSubmit(e: FormEvent) {
    e.preventDefault();setBusy(true);setError(null);
    try {await login(email.trim(),password);navigate("/",{replace:true});}
    catch {setError(t("auth.loginFailed"));}
    finally {setBusy(false);}
  }
  return <div className="grid min-h-dvh bg-[#f5f8f4] lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden flex-col justify-between overflow-hidden bg-[#1f574b] p-12 text-white lg:flex">
      <div className="pointer-events-none absolute -right-40 -top-44 size-[620px] rounded-full border border-white/10"/>
      <div className="pointer-events-none absolute -right-24 -top-16 size-[450px] rounded-full border border-white/10"/>
      <div className="relative z-10 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-white/15"><Icon name="sparkles" size={24}/></span><div><span className="block text-lg font-extrabold tracking-tight">BEAUTY SALON OS</span><span className="text-[10px] font-semibold tracking-[.2em] text-white/60">STUDIO MANAGEMENT</span></div></div>
      <div className="relative z-10 max-w-xl"><div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[11px] font-semibold tracking-wide"><Icon name="shield" size={15}/>{locale==="ja"?"サロン運営をひとつに":"让每一次预约井然有序"}</div><h1 className="text-5xl font-extrabold leading-[1.23] tracking-[-.055em]">{locale==="ja"?<>美しさを届ける時間を、<br/>もっと自由に。</>:<>让门店经营，<br/>变得优雅而高效。</>}</h1><p className="mt-6 max-w-md text-base leading-8 text-white/65">{locale==="ja"?"予約管理・スタッフ配置・お客様対応・売上管理。現場の動きをひとつのワークスペースに。":"预约排单、技师安排、顾客档案和门店经营数据，集中在一个清晰、可靠的工作空间。"}</p></div>
      <div className="relative z-10 flex gap-6 text-xs text-white/55"><span className="flex items-center gap-2"><Icon name="calendar" size={16}/> Scheduling</span><span className="flex items-center gap-2"><Icon name="users" size={16}/> Clients</span><span className="flex items-center gap-2"><Icon name="chart" size={16}/> Insights</span></div>
    </section>
    <section className="flex min-h-dvh flex-col justify-center px-5 py-10 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-[425px]">
        <div className="mb-10 flex items-center gap-3 lg:hidden"><span className="grid size-10 place-items-center rounded-xl bg-[#286958] text-white"><Icon name="sparkles" size={22}/></span><strong className="text-lg tracking-tight text-[#29483b]">BEAUTY SALON OS</strong></div>
        <div className="mb-7"><p className="mb-3 text-[11px] font-bold uppercase tracking-[.17em] text-[#65a086]">{locale==="ja"?"STAFF PORTAL":"STAFF PORTAL"}</p><h2 className="text-[29px] font-extrabold tracking-[-.05em] text-[#27453b]">{t("auth.loginTitle")}</h2><p className="mt-2 text-sm leading-relaxed text-[#91a39a]">{locale==="ja"?"スタッフアカウントでログインしてください。":"使用你的门店员工账号安全登录。"}</p></div>
        <form onSubmit={onSubmit} className="salon-surface flex flex-col gap-4 !rounded-[22px] !p-6 sm:!p-8">
          <Field label={t("common.email")}><input className={inputCls} type="email" autoComplete="username" placeholder={t("auth.emailPlaceholder")} value={email} onChange={(e)=>setEmail(e.target.value)} required/></Field>
          <Field label={t("common.password")}><div className="relative"><input className={`${inputCls} pr-20`} type={showPassword?"text":"password"} autoComplete="current-password" placeholder={t("auth.passwordPlaceholder")} value={password} onChange={(e)=>setPassword(e.target.value)} required/><button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#528a74]" aria-pressed={showPassword} onClick={()=>setShowPassword(v=>!v)}>{showPassword?(locale==="ja"?"隠す":"隐藏"):(locale==="ja"?"表示":"显示")}</button></div></Field>
          {error&&<div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <button type="submit" disabled={busy} className="salon-action mt-2 min-h-12 w-full">{busy?(locale==="ja"?"認証中…":"正在验证…"):t("common.login")}<Icon name="arrow-up-right" size={16}/></button>
        </form>
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-[#8b9d91]"><Icon name="globe" size={15}/><span>{t("common.language")}</span><button type="button" onClick={()=>setLocale("ja")} className={locale==="ja"?"font-bold text-[#2a745d]":"hover:text-[#2a745d]"}>日本語</button><span>/</span><button type="button" onClick={()=>setLocale("zh-CN")} className={locale==="zh-CN"?"font-bold text-[#2a745d]":"hover:text-[#2a745d]"}>中文</button></div>
        <p className="mt-10 text-center text-[10px] text-[#acb8ae]">© Beauty Salon OS · {locale==="ja"?"日本時間 (JST)":"日本时间 (JST)"}</p>
      </div>
    </section>
  </div>;
}
