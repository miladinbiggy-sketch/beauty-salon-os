import { useEffect, useState, type ReactNode } from "react";
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api, type StoreInfo } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { LocaleProvider, useI18n } from "./lib/i18n";
import { ToastProvider } from "./lib/ui";
import { Icon, type SalonIconName } from "./lib/icons";
import type { MessageKey } from "@salon/i18n";
import LoginPage from "./pages/Login";
import CalendarPage from "./pages/Calendar";
import ServicesPage from "./pages/Services";
import StaffPage from "./pages/Staff";
import CustomersPage, { CustomerDetailPage } from "./pages/Customers";
import ResourcesPage from "./pages/Resources";
import PaymentsPage from "./pages/Payments";
import CashClosePage from "./pages/CashClose";
import ReportsPage from "./pages/Reports";
import SettingsPage from "./pages/Settings";
import IntegrationsPage from "./pages/Integrations";
import WaitlistPage from "./pages/Waitlist";
import MySchedulePage from "./pages/MySchedule";

interface NavItem { to: string; key: MessageKey; icon: SalonIconName }
const MANAGER_NAV: NavItem[] = [
  { to: "/", key: "admin.nav.calendar", icon: "calendar" },
  { to: "/customers", key: "admin.nav.customers", icon: "users" },
  { to: "/services", key: "admin.nav.services", icon: "sparkles" },
  { to: "/staff", key: "admin.nav.staff", icon: "staff" },
  { to: "/resources", key: "admin.nav.resources", icon: "bed" },
  { to: "/payments", key: "admin.nav.payments", icon: "wallet" },
  { to: "/cash-close", key: "admin.nav.cashClose", icon: "wallet" },
  { to: "/reports", key: "admin.nav.reports", icon: "chart" },
  { to: "/integrations", key: "admin.nav.integrations", icon: "globe" },
  { to: "/waitlist", key: "admin.nav.waitlist", icon: "clock" },
  { to: "/settings", key: "admin.nav.settings", icon: "settings" },
];
const STAFF_NAV: NavItem[] = [
  { to: "/my-schedule", key: "admin.nav.mySchedule", icon: "clock" },
  { to: "/calendar", key: "admin.nav.calendar", icon: "calendar" },
];

function Layout({ children }: { children: ReactNode }) {
  const { user, logout, ready } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const location = useLocation();
  const [store, setStore] = useState<StoreInfo | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<StoreInfo>("/admin/store").then((s) => { if (alive) setStore(s); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!ready) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  const isStaff = user.role === "staff";
  const nav = isStaff ? STAFF_NAV : MANAGER_NAV;
  const storeName = store ? (locale === "ja" && store.nameJa ? store.nameJa : store.name) : "";
  const currentNav = [...MANAGER_NAV, ...STAFF_NAV].find((x) => x.to !== "/" && location.pathname.startsWith(x.to)) ?? nav[0]!;
  const pageName = t(currentNav.key);
  const mobileItems = (isStaff ? nav : [MANAGER_NAV[0], MANAGER_NAV[1], MANAGER_NAV[5], MANAGER_NAV[6]]) as NavItem[];
  const initial = user.name.trim().slice(0, 1).toLocaleUpperCase();
  const brand = <div className="flex items-center gap-3">
    <div className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-[#256959] text-white shadow-[0_7px_18px_-9px_#256959]"><Icon name="sparkles" size={23}/></div>
    <div className="min-w-0"><div className="text-[14px] font-extrabold tracking-[-.025em] text-[#244039]">BEAUTY <span className="text-[#6f9f8d]">SALON</span> OS</div><div className="text-[10px] font-semibold tracking-[.17em] text-[#9aaca4]">STUDIO MANAGEMENT</div></div>
  </div>;
  const navLink = (item: NavItem, mobile = false) => <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({isActive}) => mobile
    ? `flex min-w-[65px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold ${isActive ? "text-[#256959]" : "text-[#91a098]"}`
    : `salon-nav-item ${isActive ? "active" : ""}`}>
    <Icon name={item.icon} size={mobile ? 19 : 18}/><span className={mobile ? "max-w-[70px] truncate" : "truncate"}>{t(item.key)}</span>
  </NavLink>;
  return <div className="salon-shell flex min-h-dvh flex-col md:h-dvh md:flex-row">
    <aside className="salon-sidebar thin-scroll hidden w-[240px] shrink-0 flex-col overflow-y-auto border-r px-4 pb-5 pt-6 md:flex">
      <div className="px-2 pb-7">{brand}</div>
      <div className="px-3 pb-3 text-[10px] font-bold uppercase tracking-[.17em] text-[#9caea4]">{locale === "ja" ? "ワークスペース" : "工作空间"}</div>
      <nav aria-label={locale === "ja" ? "メインメニュー" : "主导航"} className="flex flex-col gap-1">{nav.map((item) => navLink(item))}</nav>
      <div className="mt-auto rounded-2xl border border-[#e2ebe5] bg-white/75 p-3">
        <div className="mb-3 flex items-center gap-2"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e3f0e8] font-semibold text-[#286958]">{initial}</div>
          <div className="min-w-0"><div className="truncate text-xs font-bold text-[#2e4c42]">{user.name}</div><div className="text-[11px] text-[#95a79d]">{t(`role.${user.role}`)}</div></div></div>
        <button type="button" className="salon-secondary w-full" onClick={() => void logout().catch(() => window.alert(locale === "ja" ? "ログアウトに失敗しました" : "退出失败，请检查网络"))}><Icon name="logout" size={15}/>{t("common.logout")}</button>
      </div>
      <div className="mt-4 px-2 text-[10px] text-[#b0beb6]">Asia/Tokyo · JST</div>
    </aside>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-30 flex min-h-[68px] items-center gap-3 border-b border-[#e4ebe5] bg-white/95 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="md:hidden">{brand}</div>
        <div className="hidden min-w-0 md:block"><div className="text-[11px] font-medium text-[#9ba9a1]">{storeName || t("app.name")} <span className="px-1">/</span> {locale === "ja" ? "店舗管理" : "门店管理"}</div><div className="truncate text-[17px] font-bold tracking-[-.04em] text-[#294238]">{pageName}</div></div>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden items-center gap-1 rounded-full bg-[#edf5ee] px-3 py-1.5 text-[11px] font-semibold text-[#4b7866] lg:flex"><span className="size-1.5 rounded-full bg-[#4ba177]"/>{locale === "ja" ? "店舗管理中" : "门店工作台"}</span>
          <div className="flex items-center rounded-xl border border-[#e5eae5] bg-[#f8faf8] p-0.5" aria-label={t("common.language")} role="group">
            <button type="button" aria-pressed={locale === "zh-CN"} onClick={() => setLocale("zh-CN")} className={`rounded-[9px] px-2.5 py-1.5 text-[11px] font-semibold ${locale === "zh-CN" ? "bg-white text-[#276b58] shadow-sm" : "text-[#94a59b]"}`}>中文</button>
            <button type="button" aria-pressed={locale === "ja"} onClick={() => setLocale("ja")} className={`rounded-[9px] px-2.5 py-1.5 text-[11px] font-semibold ${locale === "ja" ? "bg-white text-[#276b58] shadow-sm" : "text-[#94a59b]"}`}>日本語</button>
          </div>
          <span className="hidden size-9 place-items-center rounded-xl bg-[#edf5ee] text-xs font-bold text-[#256959] sm:grid" title={user.name}>{initial}</span>
          <button type="button" className="salon-secondary px-2.5 md:hidden" aria-label={t("common.logout")} title={t("common.logout")} onClick={() => void logout().catch(() => window.alert(locale === "ja" ? "ログアウトに失敗しました" : "退出失败，请检查网络"))}><Icon name="logout" size={17}/></button>
        </div>
      </header>
      <nav className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-[#e6ebe7] bg-white px-3 py-2 md:hidden" aria-label={locale === "ja" ? "すべてのメニュー" : "全部菜单"}>
        {nav.map((item) => <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({isActive})=>`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold ${isActive ? "bg-[#e5f1e8] text-[#256959]" : "text-[#7d8d84]"}`}>{t(item.key)}</NavLink>)}
      </nav>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-24 thin-scroll md:pb-0" id="main-content">{children}</main>
      <nav className="salon-bottom-safe fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-[#e6ebe7] bg-white/95 px-2 pt-1 shadow-[0_-7px_32px_-19px_#203c33] backdrop-blur-xl md:hidden" aria-label={locale === "ja" ? "クイックナビ" : "快捷导航"}>
        {mobileItems.map((item) => navLink(item,true))}
      </nav>
    </div>
  </div>;
}

function Protected({ children, managerOnly = false }: { children: ReactNode; managerOnly?: boolean }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="grid min-h-dvh place-items-center text-sm text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (managerOnly && user.role === "staff") return <Navigate to="/my-schedule" replace />;
  return <Layout>{children}</Layout>;
}
function HomeRoute() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="grid min-h-dvh place-items-center text-sm text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "staff") return <Navigate to="/my-schedule" replace />;
  return <Layout><CalendarPage /></Layout>;
}
export default function App() {
  return <LocaleProvider><AuthProvider><ToastProvider><HashRouter><Routes>
    <Route path="/login" element={<LoginPage/>}/>
    <Route path="/" element={<HomeRoute/>}/>
    <Route path="/calendar" element={<Protected><CalendarPage/></Protected>}/>
    <Route path="/my-schedule" element={<Protected><MySchedulePage/></Protected>}/>
    <Route path="/services" element={<Protected managerOnly><ServicesPage/></Protected>}/>
    <Route path="/staff" element={<Protected managerOnly><StaffPage/></Protected>}/>
    <Route path="/customers" element={<Protected managerOnly><CustomersPage/></Protected>}/>
    <Route path="/customers/:id" element={<Protected managerOnly><CustomerDetailPage/></Protected>}/>
    <Route path="/resources" element={<Protected managerOnly><ResourcesPage/></Protected>}/>
    <Route path="/payments" element={<Protected managerOnly><PaymentsPage/></Protected>}/>
    <Route path="/cash-close" element={<Protected managerOnly><CashClosePage/></Protected>}/>
    <Route path="/reports" element={<Protected managerOnly><ReportsPage/></Protected>}/>
    <Route path="/settings" element={<Protected managerOnly><SettingsPage/></Protected>}/>
    <Route path="/integrations" element={<Protected managerOnly><IntegrationsPage/></Protected>}/>
    <Route path="/waitlist" element={<Protected managerOnly><WaitlistPage/></Protected>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></HashRouter></ToastProvider></AuthProvider></LocaleProvider>;
}
