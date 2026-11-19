import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import {
  addDaysTokyo,
  fromIso,
  hhmmToMinutes,
  minutesToHhmm,
  toIso,
  todayTokyo,
  tokyoDateOf,
  tokyoDayRangeMs,
  tokyoMs,
  tokyoTimeOf,
  weekdayOfTokyoDate,
  type AppointmentStatus,
} from "@salon/shared";
import {
  api,
  ApiError,
  type AppointmentDto,
  type Customer,
  type Service,
  type StaffMember,
  type StoreInfo,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { localizedName, useI18n } from "../lib/i18n";
import {
  btnDanger,
  btnGhost,
  btnPrimary,
  btnSmall,
  Drawer,
  Field,
  inputCls,
  Loading,
  Modal,
  STATUS_TRANSITIONS,
  StatusBadge,
  useToast,
  useYen,
} from "../lib/ui";
import type { MessageKey } from "@salon/i18n";
import SmartRecommendations from "./SmartRecommendations";
import { Icon } from "../lib/icons";
import { computeAppointmentLanes, type CardLane } from "../lib/calendar-layout";

const PX_PER_MIN = 1.15;
const TERMINAL: AppointmentStatus[] = ["completed", "cancelled", "no_show"];

function dayRangeOf(store: StoreInfo | null, date: string): { open: number; close: number; isClosed: boolean } {
  const wd = weekdayOfTokyoDate(date);
  const h = store?.businessHours.find((b) => b.weekday === wd);
  if (!h) return { open: 600, close: 1200, isClosed: false };
  if (h.isClosed) return { open: 600, close: 1200, isClosed: true };
  const open = hhmmToMinutes(h.openTime);
  const close = hhmmToMinutes(h.closeTime);
  return close > open ? { open, close, isClosed: false } : { open: 600, close: 1200, isClosed: true };
}

function mondayOf(date: string): string {
  return addDaysTokyo(date, -(weekdayOfTokyoDate(date) - 1));
}

interface ColDef {
  key: string;
  date: string;
  staffId: string | null;
}

interface DragInfo {
  appt: AppointmentDto;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  active: boolean;
  width: number;
  height: number;
  grabDX: number;
  grabDY: number;
  originCol: number;
  targetCol: number;
  deltaMin: number;
}

export default function CalendarPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const isStaff = user?.role === "staff";
  const canManage = !!user && user.role !== "staff";

  const [view, setView] = useState<"day" | "week">("day");
  const [date, setDate] = useState<string>(todayTokyo());
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [staffs, setStaffs] = useState<StaffMember[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [appts, setAppts] = useState<AppointmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AppointmentDto | null>(null);
  const [createInit, setCreateInit] = useState<{ date: string; time: string; staffId?: string; serviceId?: string } | null>(null);
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const [pendingMove, setPendingMove] = useState<{ appt: AppointmentDto; newStartMs: number; staffId: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "finished" | "cancelled">("active");
  const [staffFilter, setStaffFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showAgenda, setShowAgenda] = useState(true);
  const [metadataError, setMetadataError] = useState(false);
  const [metadataVersion, setMetadataVersion] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const colRectsRef = useRef<DOMRect[]>([]);
  const dragRef = useRef<DragInfo | null>(null);
  const dragEndAtRef = useRef(0);
  const latestLoad = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<StoreInfo>("/admin/store"),
      api.get<StaffMember[]>("/admin/staff"),
      api.get<Service[]>("/admin/services"),
    ])
      .then(([s, st, sv]) => {
        if (!alive) return;
        setStore(s);
        setStaffs(st);
        setServices(sv);
        setMetadataError(false);
      })
      .catch(() => { if (alive) setMetadataError(true); });
    return () => {
      alive = false;
    };
  }, [metadataVersion]);

  const range = useMemo(() => {
    if (view === "day") return tokyoDayRangeMs(date);
    const mon = mondayOf(date);
    return { startMs: tokyoDayRangeMs(mon).startMs, endMs: tokyoDayRangeMs(addDaysTokyo(mon, 6)).endMs };
  }, [date, view]);

  const loadAppts = useCallback(async () => {
    const loadId = ++latestLoad.current;
    setRefreshing(true);
    setLoadError("");
    try {
      const rows = await api.get<AppointmentDto[]>(
        `/admin/appointments?from=${encodeURIComponent(toIso(range.startMs))}&to=${encodeURIComponent(toIso(range.endMs))}`,
      );
      if (loadId === latestLoad.current) setAppts(rows);
    } catch {
      if (loadId === latestLoad.current) {
        setAppts([]); // Don't display an old day's customer records under a new date.
        setLoadError(locale === "ja" ? "予約の読み込みに失敗しました" : "预约加载失败，请刷新重试");
      }
    } finally {
      if (loadId === latestLoad.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [range, locale]);

  useEffect(() => {
    setLoading(true);
    void loadAppts();
  }, [loadAppts]);

  useEffect(() => {
    const reload = () => { if (document.visibilityState === "visible" && !dragRef.current) void loadAppts(); };
    window.addEventListener("focus", reload);
    const interval = window.setInterval(reload, 45_000);
    return () => { window.removeEventListener("focus", reload); window.clearInterval(interval); };
  }, [loadAppts]);

  const visibleStaffs = useMemo(
    () => staffs.filter((s) => s.active && (!isStaff || s.id === user?.staffId) && (!staffFilter || s.id === staffFilter)),
    [staffs, isStaff, user, staffFilter],
  );

  const visibleAppts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return appts.filter((a) => {
      if (staffFilter && a.staff.id !== staffFilter) return false;
      if (statusFilter === "active" && (a.status === "cancelled" || a.status === "no_show")) return false;
      if (statusFilter === "finished" && a.status !== "completed") return false;
      if (statusFilter === "cancelled" && a.status !== "cancelled" && a.status !== "no_show") return false;
      if (!needle) return true;
      return [a.bookingCode, a.customer.name, a.customer.phone, a.staff.name,
        ...a.services.flatMap((item) => [item.nameZh, item.nameJa])]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [appts, query, statusFilter, staffFilter]);

  const overview = useMemo(() => {
    const relevant = appts.filter((a) => !staffFilter || a.staff.id === staffFilter);
    const active = relevant.filter((a) => a.status !== "cancelled" && a.status !== "no_show");
    return {
      total: active.length,
      finished: active.filter((a) => a.status === "completed").length,
      pending: active.filter((a) => a.status !== "completed").length,
      estimatedJpy: active.reduce((sum, a) => sum + a.totalPriceJpy, 0),
    };
  }, [appts, staffFilter]);

  const actionQueue = useMemo(() =>
    visibleAppts.filter((a) => a.status !== "cancelled" && a.status !== "no_show")
      .slice().sort((a,b) => fromIso(a.startAt) - fromIso(b.startAt)),
    [visibleAppts],
  );
  const needsAttention = useMemo(() => actionQueue.filter((a) =>
    a.status === "booked" || a.status === "arrived" || a.status === "in_service",
  ).length, [actionQueue]);

  const weekDays = useMemo(() => {
    const mon = mondayOf(date);
    return Array.from({ length: 7 }, (_, i) => addDaysTokyo(mon, i));
  }, [date]);

  const columns: ColDef[] = useMemo(() => {
    if (view === "day") return visibleStaffs.map((s) => ({ key: s.id, date, staffId: s.id }));
    return weekDays.map((d) => ({ key: d, date: d, staffId: null }));
  }, [view, visibleStaffs, date, weekDays]);

  const { open, close } = useMemo(() => {
    if (view === "day") return dayRangeOf(store, date);
    let o = 24 * 60;
    let c = 0;
    for (const d of weekDays) {
      const r = dayRangeOf(store, d);
      o = Math.min(o, r.open);
      c = Math.max(c, r.close);
    }
    return { open: o, close: c };
  }, [view, store, date, weekDays]);
  const totalMin = Math.max(close - open, 60);
  const colHeight = totalMin * PX_PER_MIN;
  const halfRows = Math.ceil(totalMin / 30);

  const serviceColor = useCallback(
    (appt: AppointmentDto): string => {
      const first = appt.services[0];
      const svc = first ? services.find((s) => s.id === first.serviceId) : undefined;
      return svc?.color ?? appt.staff.color ?? "#3b82f6";
    },
    [services],
  );

  const apptsInCol = useCallback(
    (col: ColDef): AppointmentDto[] =>
      visibleAppts.filter((a) => {
        if (view === "day") return a.staff.id === col.staffId && tokyoDateOf(fromIso(a.startAt)) === col.date;
        return tokyoDateOf(fromIso(a.startAt)) === col.date;
      }),
    [visibleAppts, view],
  );

  /* ---------- 拖动改期（Pointer Events，鼠标+触屏） ---------- */
  function startDrag(e: RPointerEvent<HTMLDivElement>, appt: AppointmentDto, colIdx: number) {
    if (!canManage || TERMINAL.includes(appt.status)) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    colRectsRef.current = colRefs.current.map((c) => c?.getBoundingClientRect() ?? new DOMRect());
    const info: DragInfo = {
      appt,
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      active: false,
      width: rect.width,
      height: rect.height,
      grabDX: e.clientX - rect.left,
      grabDY: e.clientY - rect.top,
      originCol: colIdx,
      targetCol: colIdx,
      deltaMin: 0,
    };
    dragRef.current = info;
    setDrag(info);
  }

  function moveDrag(e: RPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const active = d.active || Math.hypot(dx, dy) > 4;
    let targetCol = d.targetCol;
    if (active) {
      const rects = colRectsRef.current;
      const found = rects.findIndex((r) => e.clientX >= r.left && e.clientX <= r.right);
      if (found >= 0) targetCol = found;
      else if (rects.length > 0) {
        targetCol = e.clientX < (rects[0]?.left ?? 0) ? 0 : rects.length - 1;
      }
    }
    const next: DragInfo = {
      ...d,
      curX: e.clientX,
      curY: e.clientY,
      active,
      targetCol,
      deltaMin: active ? Math.round(dy / PX_PER_MIN / 5) * 5 : 0,
    };
    dragRef.current = next;
    setDrag(next);
  }

  async function endDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (!d.active) {
      setSelected(d.appt);
      return;
    }
    dragEndAtRef.current = Date.now();
    const startMs = fromIso(d.appt.startAt);
    const dayDelta = view === "week" ? d.targetCol - d.originCol : 0;
    const newDate = addDaysTokyo(tokyoDateOf(startMs), dayDelta);
    const startMin = Math.min(Math.max(hhmmToMinutes(tokyoTimeOf(startMs)) + d.deltaMin, 0), 1435);
    const newStartMs = tokyoMs(newDate, minutesToHhmm(startMin));
    const targetColDef = columns[d.targetCol];
    const newStaffId = view === "day" && targetColDef?.staffId ? targetColDef.staffId : d.appt.staff.id;
    if (newStartMs === startMs && newStaffId === d.appt.staff.id) return;
    // 拖拽只是预览，不立即写入，避免误触造成真实门店预约被悄悄改期。
    setPendingMove({ appt:d.appt, newStartMs, staffId:newStaffId });
  }

  async function confirmMove() {
    if (!pendingMove || moving) return;
    setMoving(true);
    try {
      await api.post(`/admin/appointments/${pendingMove.appt.id}/reschedule`, {
        startAt:toIso(pendingMove.newStartMs),staffId:pendingMove.staffId,
      });
      setPendingMove(null);
      await loadAppts();
      toast(t("common.saved"));
    } catch(err) {
      if (err instanceof ApiError && err.status===409) toast(t("admin.appointment.conflictOnMove"), "error");
      else toast(t("common.failed"), "error");
    } finally {setMoving(false);}
  }

  function onColClick(e: React.MouseEvent<HTMLDivElement>, col: ColDef) {
    if (!canManage) return;
    if (dayRangeOf(store, col.date).isClosed) {
      toast(locale === "ja" ? "休業日のため新規予約できません" : "当日休业，无法新增预约", "error");
      return;
    }
    if (Date.now() - dragEndAtRef.current < 200) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const raw = open + (y / rect.height) * totalMin;
    const snapped = Math.min(Math.max(Math.floor(raw / 5) * 5, open), close - 5);
    setCreateInit({ date: col.date, time: minutesToHhmm(snapped), staffId: col.staffId ?? undefined });
  }

  function renderBlock(appt: AppointmentDto, colIdx: number, lane: CardLane = { lane: 0, lanes: 1 }) {
    const startMs = fromIso(appt.startAt);
    const endMs = fromIso(appt.endAt);
    const startMin = hhmmToMinutes(tokyoTimeOf(startMs));
    const endMin = startMin + Math.max(Math.round((endMs - startMs) / 60000), 5);
    const top = ((startMin - open) / totalMin) * 100;
    const height = Math.max(((endMin - startMin) / totalMin) * 100, 2.2);
    const color = serviceColor(appt);
    const faded = appt.status === "cancelled" || appt.status === "no_show";
    const isDraggingThis = drag?.active && drag.appt.id === appt.id;
    const svcNames = appt.services.map((s) => localizedName(locale, s.nameZh, s.nameJa)).join(" / ");
    return (
      <div
        key={appt.id}
        role="button"
        tabIndex={0}
        aria-label={`${appt.customer.name} ${svcNames} ${tokyoTimeOf(startMs)}–${tokyoTimeOf(endMs)}`}
        title={`${appt.customer.name} · ${svcNames} · ${appt.staff.name}`}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(appt); } }}
        className={`salon-appt absolute touch-none overflow-hidden rounded-lg px-2 py-1 text-left shadow-[0_2px_9px_-6px_rgba(32,53,43,.25)] ${
          canManage && !TERMINAL.includes(appt.status) ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
        } ${faded ? "opacity-45" : ""} ${isDraggingThis ? "opacity-30" : ""}`}
        style={{
          top: `${top}%`,
          height: `${height}%`,
          left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
          width: `calc(${100 / lane.lanes}% - 4px)`,
          backgroundColor: `${color}24`,
          borderLeft: `4px solid ${color}`,
        }}
        onPointerDown={(e) => {
          if (!canManage || TERMINAL.includes(appt.status)) {
            setSelected(appt);
            return;
          }
          startDrag(e, appt, colIdx);
        }}
        onPointerMove={moveDrag}
        onPointerUp={() => void endDrag()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="truncate text-[11px] font-bold leading-tight text-[#30483f]">{appt.customer.name}</div>
        <div className="truncate text-[10px] leading-tight text-[#5f746a]">{svcNames}</div>
        <div className="truncate text-[10px] leading-tight text-slate-500">
          {tokyoTimeOf(startMs)}–{tokyoTimeOf(endMs)}
          {view === "week" ? ` · ${appt.staff.name}` : ""}
        </div>
      </div>
    );
  }

  const timeLabels: number[] = [];
  for (let m = open; m <= close; m += 30) timeLabels.push(m);

  return (
    <div className="salon-page mx-auto flex min-h-full max-w-[1800px] flex-col gap-3 p-3 sm:p-5 lg:p-7">
      {/* V5: 实际经营工作台；数据只来自 API，不伪造预约或收款。 */}
      <section className="flex flex-col gap-3 rounded-[22px] border border-[#e4eae5] bg-white px-4 py-4 shadow-[0_5px_27px_-22px_#274a3d] sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#8ba397]"><Icon name="sun" size={14}/>{locale === "ja" ? "サロンオペレーション" : "SALON OPERATIONS"}<span className="rounded-full bg-[#eef5ef] px-2 py-0.5 tracking-normal text-[#538572]">JST</span></div>
            <h1 className="text-[23px] font-bold tracking-[-.05em] text-[#263f36] sm:text-[27px]">{locale === "ja" ? "予約管理ボード" : "预约排单工作台"}</h1>
            <p className="mt-1 text-xs text-[#92a39b]">{locale === "ja" ? "予約・担当・施術時間をひとつの画面で管理" : "查看预约、安排技师、管理现场到店与服务进度"}</p>
          </div>
          {canManage && <button type="button" disabled={metadataError || staffs.length === 0 || services.length === 0} className="salon-action" onClick={() => setCreateInit({date,time:minutesToHhmm(open),staffId:undefined})}><Icon name="plus" size={17}/>{t("admin.calendar.newAppointment")}</button>}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[#eef2ee] pt-3">
          <div className="flex items-center gap-1 rounded-xl bg-[#f4f8f4] p-1">
            <button type="button" aria-label={t("admin.calendar.prev")} className="rounded-lg px-2.5 py-2 text-[#5e796b] hover:bg-white" onClick={() => setDate(addDaysTokyo(date,view === "day" ? -1 : -7))}><Icon name="chevron-left" size={17}/></button>
            <button type="button" className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#346b59] shadow-sm" onClick={() => setDate(todayTokyo())}>{t("common.today")}</button>
            <button type="button" aria-label={t("admin.calendar.next")} className="rounded-lg px-2.5 py-2 text-[#5e796b] hover:bg-white" onClick={() => setDate(addDaysTokyo(date,view === "day" ? 1 : 7))}><Icon name="chevron-right" size={17}/></button>
          </div>
          <input type="date" aria-label={t("common.date")} className="salon-control min-w-0 px-3 text-xs font-semibold text-[#39594c]" value={date} onChange={(e) => { if(e.target.value) setDate(e.target.value); }}/>
          <span className="hidden text-xs font-semibold text-[#71887a] sm:inline">{date} · {t(`weekday.${weekdayOfTokyoDate(date)}` as MessageKey)}</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-xl bg-[#f2f6f2] p-1" role="group" aria-label={locale === "ja" ? "表示切り替え" : "切换视图"}>
              <button type="button" aria-pressed={view === "day"} className={`rounded-[9px] px-3 py-1.5 text-xs font-semibold ${view === "day" ? "bg-white text-[#276957] shadow-sm" : "text-[#80948a]"}`} onClick={()=>setView("day")}>{t("admin.calendar.dayView")}</button>
              <button type="button" aria-pressed={view === "week"} className={`rounded-[9px] px-3 py-1.5 text-xs font-semibold ${view === "week" ? "bg-white text-[#276957] shadow-sm" : "text-[#80948a]"}`} onClick={()=>setView("week")}>{t("admin.calendar.weekView")}</button>
            </div>
          </div>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {label:locale === "ja" ? "有効予約" : "有效预约", value:String(overview.total), foot:locale === "ja" ? "対象期間の予約数" : "所选日期范围", icon:"calendar" as const},
          {label:locale === "ja" ? "対応待ち・施術中" : "待接待／服务中", value:String(overview.pending), foot:locale === "ja" ? "未完了の予約" : "未完成订单", icon:"clock" as const},
          {label:locale === "ja" ? "完了済み" : "已经完成", value:String(overview.finished), foot:locale === "ja" ? "施術完了" : "已完成服务", icon:"check" as const},
          {label:locale === "ja" ? "予約見込額" : "预约预计金额", value:`¥${overview.estimatedJpy.toLocaleString("ja-JP")}`, foot:locale === "ja" ? "実際の売上ではありません" : "并非实收营业额", icon:"wallet" as const},
        ].map((m) => <div key={m.label} className="salon-kpi"><div className="flex items-center justify-between gap-1 text-xs font-medium text-[#83978c]">{m.label}<Icon name={m.icon} size={17} className="text-[#80b29b]"/></div><div className="number mt-2 truncate">{m.value}</div><div className="mt-2 text-[10px] text-[#a0b0a6]">{m.foot}</div></div>)}
      </div>
      <section className="salon-surface flex flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[190px] flex-[2]">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#91a79a]"/>
            <input type="search" className={`${inputCls} !rounded-xl !border-[#dce7de] !pl-9`} value={query} onChange={(e)=>setQuery(e.target.value)} placeholder={locale === "ja" ? "名前・電話・予約番号・メニュー" : "搜索姓名、电话、预约码或项目"} aria-label={locale === "ja" ? "予約検索" : "搜索预约"}/>
          </div>
          <select className={`${inputCls} !w-auto !min-w-[118px] !rounded-xl !border-[#dce7de]`} value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as typeof statusFilter)} aria-label={locale === "ja" ? "状態" : "预约状态"}>
            <option value="active">{locale === "ja" ? "有効予約" : "有效预约"}</option><option value="all">{locale === "ja" ? "すべて" : "全部状态"}</option><option value="finished">{locale === "ja" ? "完了のみ" : "仅已完成"}</option><option value="cancelled">{locale === "ja" ? "取消・無断" : "取消／爽约"}</option>
          </select>
          {!isStaff && <select className={`${inputCls} !w-auto !min-w-[125px] !rounded-xl !border-[#dce7de]`} value={staffFilter} onChange={(e)=>setStaffFilter(e.target.value)} aria-label={locale === "ja" ? "スタッフ" : "筛选技师"}><option value="">{locale === "ja" ? "全スタッフ" : "全部技师"}</option>{staffs.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{locale === "ja" && a.nameJa ? a.nameJa : a.name}</option>)}</select>}
          {(query || staffFilter || statusFilter !== "active") && <button type="button" className="salon-secondary" onClick={()=>{setQuery("");setStaffFilter("");setStatusFilter("active");}}>{locale === "ja" ? "クリア" : "清除筛选"}</button>}
          <button type="button" className="salon-secondary" disabled={refreshing} onClick={()=>void loadAppts()}><Icon name="refresh" size={15} className={refreshing ? "animate-spin" : ""}/>{locale === "ja" ? "更新" : "刷新"}</button>
          <span role="status" className="ml-auto text-[11px] text-[#8a9c91]">{locale === "ja" ? `${visibleAppts.length} 件表示` : `显示 ${visibleAppts.length} 项`}</span>
        </div>
        {loadError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{loadError}</div>}
        {metadataError && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><Icon name="info" size={16}/>{locale === "ja" ? "店舗情報・スタッフ・メニューを取得できませんでした。" : "门店／员工／项目资料加载失败，暂不能安全创建预约。"}<button type="button" className="font-bold underline" onClick={()=>setMetadataVersion(v=>v+1)}>{locale === "ja" ? "再試行" : "重试"}</button></div>}
      </section>
      {/* 实际预约清单：数据源与下方日历一致，点击打开操作抽屉。 */}
      <section className="salon-surface overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2"><Icon name="list" size={17} className="text-[#488e73]"/><h2 className="text-sm font-bold text-[#30473d]">{locale === "ja" ? "受付・施術リスト" : "接待与服务清单"}</h2><span className="salon-pill">{actionQueue.length}</span>{needsAttention>0 && <span className="rounded-full bg-[#fff5e8] px-2 py-1 text-[10px] font-semibold text-[#b47a3e]">{locale === "ja" ? `要対応 ${needsAttention}` : `需处理 ${needsAttention}`}</span>}</div>
          <button type="button" aria-expanded={showAgenda} className="salon-secondary !min-h-[30px]" onClick={()=>setShowAgenda(v=>!v)}>{showAgenda ? (locale === "ja" ? "折りたたむ" : "收起") : (locale === "ja" ? "表示" : "展开")}</button>
        </div>
        {showAgenda && <div className="border-t border-[#eef1ec] px-2 pb-2 pt-1 sm:px-3">
          {actionQueue.length === 0 ? <div className="py-6 text-center text-xs text-[#9caca1]">{locale === "ja" ? "該当する予約はありません" : "当前筛选没有预约，调整日期或筛选条件后再试"}</div> :
            <div className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
              {actionQueue.slice(0,9).map(a=>{
                const start=fromIso(a.startAt);const color=serviceColor(a);
                return <button key={a.id} type="button" className="salon-agenda-item" onClick={()=>setSelected(a)}>
                  <div className="min-w-[66px] border-r border-[#edf2ec] pr-2"><div className="text-[14px] font-bold tabular-nums text-[#3c5c4c]">{tokyoTimeOf(start)}</div>{view==="week" && <div className="text-[10px] text-[#9ca99f]">{tokyoDateOf(start).slice(5)}</div>}</div>
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{backgroundColor:color}}/>
                  <div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-[#344d42]">{a.customer.name}</div><div className="mt-1 truncate text-[10px] text-[#91a297]">{locale === "ja" && a.staff.nameJa ? a.staff.nameJa : a.staff.name} · {a.services.map(v=>localizedName(locale,v.nameZh,v.nameJa)).join(" / ")}</div></div>
                  <StatusBadge status={a.status}/>
                </button>;
              })}
            </div>}
          {actionQueue.length>9 && <p className="px-3 py-2 text-[11px] text-[#91a297]">{locale === "ja" ? `先頭9件表示・全${actionQueue.length}件は下のカレンダーで確認` : `展示前 9 条，共 ${actionQueue.length} 条；其余请在下方排单日历查看`}</p>}
        </div>}
      </section>
      {canManage && !metadataError && <SmartRecommendations date={date} services={services} staff={visibleStaffs} onPick={setCreateInit} />}
      {visibleStaffs.length===0 && !metadataError && <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e7d9b2] bg-[#fffaf0] px-4 py-3 text-xs text-[#8d7540]">{locale === "ja" ? "表示できる担当者がいません。スタッフの稼働状況を確認してください。" : "当前没有可排单的在职技师，请检查技师启用状态或清除筛选。"}{canManage && <a href="#/staff" className="font-bold underline">{locale === "ja" ? "スタッフ管理" : "前往员工管理"}</a>}</div>}
      {/* 网格 */}
      <div className="salon-surface thin-scroll relative min-h-[420px] flex-1 overflow-auto !rounded-[20px]">
        {loading ? (
          <Loading />
        ) : (
          <div style={{ minWidth: `${columns.length * (view === "week" ? 224 : 178) + 52}px` }}>
            {/* 列头 */}
            <div className="salon-sticky-head sticky top-0 z-20 flex border-b border-[#e4ebe4]">
              <div className="w-[52px] shrink-0" />
              {columns.map((col) => {
                const staff = col.staffId ? staffs.find((s) => s.id === col.staffId) : null;
                return (
                  <div key={col.key} className="min-w-0 flex-1 border-l border-[#e6eee6] px-2 py-3 text-center">
                    {view === "day" ? (
                      <span className="flex items-center justify-center gap-1.5 text-sm font-medium text-slate-700">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: staff?.color ?? "#94a3b8" }} />
                        <span className="truncate">{locale === "ja" && staff?.nameJa ? staff.nameJa : staff?.name ?? ""}</span>
                      </span>
                    ) : (
                      <span className="text-sm font-medium text-slate-700">
                        {col.date.slice(5)}（{t(`weekday.${weekdayOfTokyoDate(col.date)}` as MessageKey)}）
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* 主体 */}
            <div className="flex">
              {/* 时间轴 */}
              <div className="relative w-[52px] shrink-0" style={{ height: colHeight }}>
                {timeLabels.map((m) => (
                  <div
                    key={m}
                    className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-slate-400"
                    style={{ top: `${((m - open) / totalMin) * 100}%` }}
                  >
                    {minutesToHhmm(m)}
                  </div>
                ))}
              </div>
              {/* 技师/日期列 */}
              {columns.map((col, colIdx) => (
                <div
                  key={col.key}
                  ref={(el) => {
                    colRefs.current[colIdx] = el;
                  }}
                  className={`cal-half-lines relative min-w-0 flex-1 border-l border-[#e6eee6] ${
                    drag?.active && drag.targetCol === colIdx ? "bg-emerald-50" : ""
                  } ${canManage ? "cursor-cell" : ""}`}
                  style={{ height: colHeight, "--rows": halfRows } as CSSProperties}
                  onClick={(e) => onColClick(e, col)}
                  title={canManage ? t("admin.calendar.clickToBook") : undefined}
                >
                  {tokyoDateOf(nowMs) === col.date && (hhmmToMinutes(tokyoTimeOf(nowMs)) >= open && hhmmToMinutes(tokyoTimeOf(nowMs)) <= close) && (
                    <div aria-label={locale === "ja" ? "現在時刻" : "当前时间"} className="salon-now pointer-events-none absolute inset-x-0 z-10 border-t-2 border-[#e66b66]"
                      style={{ top: `${((hhmmToMinutes(tokyoTimeOf(nowMs)) - open) / totalMin) * 100}%` }}>
                      <span className="absolute -top-2 right-0 rounded bg-red-500 px-1 text-[9px] text-white">{tokyoTimeOf(nowMs)}</span>
                    </div>
                  )}
                  {dayRangeOf(store, col.date).isClosed && (
                    <div className="pointer-events-none absolute inset-x-0 top-1 z-[5] text-center text-[10px] font-medium text-slate-400">
                      {locale === "ja" ? "定休日" : "休业日"}
                    </div>
                  )}
                  {(() => {
                    const rows = apptsInCol(col);
                    const lanes = computeAppointmentLanes(rows);
                    return rows.map((a) => renderBlock(a, colIdx, lanes.get(a.id)));
                  })()}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 拖动中的跟随块 */}
      {drag?.active && (
        <div
          className="pointer-events-none fixed z-50 overflow-hidden rounded-md px-1.5 py-0.5 opacity-80 shadow-lg"
          style={{
            left: drag.curX - drag.grabDX,
            top: drag.curY - drag.grabDY,
            width: drag.width,
            height: drag.height,
            backgroundColor: `${serviceColor(drag.appt)}45`,
            borderLeft: `3px solid ${serviceColor(drag.appt)}`,
          }}
        >
          <div className="truncate text-[11px] font-semibold text-slate-800">{drag.appt.customer.name}</div>
          <div className="truncate text-[10px] text-slate-600">
            {minutesToHhmm(hhmmToMinutes(tokyoTimeOf(fromIso(drag.appt.startAt))) + drag.deltaMin)}
          </div>
        </div>
      )}

      {pendingMove && <Modal title={locale === "ja" ? "予約変更の確認" : "确认调整预约"} onClose={()=>{if(!moving)setPendingMove(null);}}>
        <div className="space-y-4 text-sm text-[#526a5d]">
          <div className="rounded-xl bg-[#f3f8f4] p-4"><div className="font-bold text-[#294939]">{pendingMove.appt.customer.name}</div><div className="mt-1 text-xs">{pendingMove.appt.services.map(a=>localizedName(locale,a.nameZh,a.nameJa)).join(" / ")}</div></div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"><div className="min-w-0 rounded-xl border border-[#e5ece5] p-3"><div className="mb-1 text-[10px] text-[#96a69a]">{locale === "ja" ? "変更前" : "原预约"}</div><div className="font-bold tabular-nums">{tokyoDateOf(fromIso(pendingMove.appt.startAt))}<br/>{tokyoTimeOf(fromIso(pendingMove.appt.startAt))}</div><div className="mt-1 truncate text-xs">{pendingMove.appt.staff.name}</div></div><Icon name="chevron-right" size={16}/><div className="min-w-0 rounded-xl border border-[#a8ccb2] bg-[#f1f8f2] p-3"><div className="mb-1 text-[10px] text-[#649675]">{locale === "ja" ? "変更後" : "调整为"}</div><div className="font-bold tabular-nums text-[#256553]">{tokyoDateOf(pendingMove.newStartMs)}<br/>{tokyoTimeOf(pendingMove.newStartMs)}</div><div className="mt-1 truncate text-xs">{staffs.find(a=>a.id===pendingMove.staffId)?.name ?? pendingMove.appt.staff.name}</div></div></div>
          <p className="text-xs leading-5 text-[#8a9d90]">{locale === "ja" ? "確定時に最新の予約状況を再確認します。競合する場合は保存されません。" : "确认时服务器将重新检查技师及工位空档；如果时间已被占用，本次改期不会生效。"}</p>
          <div className="flex justify-end gap-2"><button type="button" disabled={moving} className={btnGhost} onClick={()=>setPendingMove(null)}>{t("common.cancel")}</button><button type="button" disabled={moving} className={btnPrimary} onClick={()=>void confirmMove()}>{moving ? (locale === "ja" ? "保存中…" : "保存中…") : t("common.confirm")}</button></div>
        </div>
      </Modal>}
      {createInit && (
        <CreateAppointmentModal
          init={createInit}
          staffs={visibleStaffs}
          services={services}
          onClose={() => setCreateInit(null)}
          onCreated={() => {
            setCreateInit(null);
            void loadAppts();
          }}
        />
      )}

      {selected && (
        <AppointmentDrawer
          key={selected.id}
          appt={selected}
          services={services}
          onClose={() => setSelected(null)}
          onChanged={() => void loadAppts()}
        />
      )}
    </div>
  );
}

/* ================= 新建预约弹窗 ================= */
function CreateAppointmentModal({
  init,
  staffs,
  services,
  onClose,
  onCreated,
}: {
  init: { date: string; time: string; staffId?: string; serviceId?: string };
  staffs: StaffMember[];
  services: Service[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const yen = useYen();
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [staffId, setStaffId] = useState(init.staffId ?? "");
  const [custQ, setCustQ] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  /** serviceId -> 已选 addonIds */
  const [sel, setSel] = useState<Record<string, string[]>>(init.serviceId ? { [init.serviceId]: [] } : {});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeServices = services.filter((s) => s.active);
  const totals = useMemo(() => {
    let price = 0;
    let duration = 0;
    for (const [sid, addonIds] of Object.entries(sel)) {
      const svc = services.find((s) => s.id === sid);
      if (!svc) continue;
      price += svc.priceJpy;
      duration += svc.durationMinutes + svc.bufferMinutes;
      for (const aid of addonIds) {
        const ad = svc.addons.find((a) => a.id === aid);
        if (ad) {
          price += ad.priceJpy;
          duration += ad.durationMinutes;
        }
      }
    }
    return { price, duration };
  }, [sel, services]);

  async function searchCustomers() {
    if (!custQ.trim()) return;
    try {
      const rows = await api.get<Customer[]>(`/admin/customers?q=${encodeURIComponent(custQ.trim())}`);
      setCustResults(rows);
    } catch {
      setCustResults([]);
    }
  }

  function toggleService(svc: Service, checked: boolean) {
    setSel((prev) => {
      const next = { ...prev };
      if (checked) next[svc.id] = [];
      else delete next[svc.id];
      return next;
    });
  }

  function toggleAddon(svc: Service, addonId: string, checked: boolean) {
    setSel((prev) => {
      const cur = prev[svc.id] ?? [];
      return { ...prev, [svc.id]: checked ? [...cur, addonId] : cur.filter((x) => x !== addonId) };
    });
  }

  async function submit() {
    setError(null);
    const selections = Object.entries(sel).map(([serviceId, addonIds]) => ({ serviceId, addonIds }));
    if (selections.length === 0) {
      setError(t("customer.selectServiceFirst"));
      return;
    }
    if (!customer && (!newName.trim() || !newPhone.trim())) {
      setError(t("common.failed"));
      return;
    }
    setBusy(true);
    try {
      await api.post<AppointmentDto>("/admin/appointments", {
        ...(customer ? { customerId: customer.id } : { customerName: newName.trim(), customerPhone: newPhone.trim() }),
        ...(staffId ? { staffId } : {}),
        startAt: toIso(tokyoMs(date, time)),
        selections,
        source: "admin",
        note: note.trim() || undefined,
        locale,
      });
      toast(t("common.saved"));
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError(t("customer.conflict"));
      else setError(t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("admin.appointment.createTitle")} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-slate-400">{t("admin.appointment.phoneSearch")}</p>
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={custQ}
            onChange={(e) => setCustQ(e.target.value)}
            placeholder={t("common.phone")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void searchCustomers();
              }
            }}
          />
          <button type="button" className={btnGhost} onClick={() => void searchCustomers()}>
            {t("common.search")}
          </button>
        </div>
        {custResults.length > 0 && !customer && (
          <div className="flex flex-col gap-1">
            {custResults.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => setCustomer(c)}
              >
                <span className="min-w-0 truncate font-medium text-slate-700">{c.name}</span>
                <span className="shrink-0 text-xs text-slate-400">{c.phone}</span>
              </button>
            ))}
          </div>
        )}
        {customer ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-slate-700">
            <span className="font-medium">{customer.name}</span>
            <span className="text-slate-500">{customer.phone}</span>
            <button type="button" className="ml-auto text-xs text-blue-600" onClick={() => setCustomer(null)}>
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("common.name")}>
              <input className={inputCls} value={newName} onChange={(e) => setNewName(e.target.value)} />
            </Field>
            <Field label={t("common.phone")}>
              <input className={inputCls} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.date")}>
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t("common.time")}>
            <input type="time" step={300} className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label={t("customer.staffLabel")}>
            <select className={inputCls} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">{t("common.any")}</option>
              {staffs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-500">{t("admin.appointment.services")}</span>
          {activeServices.map((svc) => {
            const checked = svc.id in sel;
            return (
              <div key={svc.id} className="rounded-xl border border-slate-200 px-3 py-2">
                <label className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked} onChange={(e) => toggleService(svc, e.target.checked)} />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: svc.color }} />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                    {localizedName(locale, svc.nameZh, svc.nameJa)}
                  </span>
                  <span className="text-xs text-slate-400">
                    {t("common.minutes", { n: svc.durationMinutes })} · {yen(svc.priceJpy)}
                  </span>
                </label>
                {checked && svc.addons.filter((a) => a.active).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2 pl-6">
                    {svc.addons
                      .filter((a) => a.active)
                      .map((ad) => (
                        <label
                          key={ad.id}
                          className="flex cursor-pointer items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
                        >
                          <input
                            type="checkbox"
                            checked={(sel[svc.id] ?? []).includes(ad.id)}
                            onChange={(e) => toggleAddon(svc, ad.id, e.target.checked)}
                          />
                          {localizedName(locale, ad.nameZh, ad.nameJa)} +{yen(ad.priceJpy)}
                        </label>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Field label={t("common.note")}>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          <span>
            {t("customer.totalPrice")}: <b>{yen(totals.price)}</b>
          </span>
          <span>
            {t("customer.totalDuration")}: <b>{t("common.minutes", { n: totals.duration })}</b>
          </span>
        </div>
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
            {t("admin.calendar.newAppointment")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ================= 预约详情抽屉 ================= */
function AppointmentDrawer({
  appt: initial,
  onClose,
  onChanged,
}: {
  appt: AppointmentDto;
  services: Service[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const yen = useYen();
  const isStaff = user?.role === "staff";
  const [appt, setAppt] = useState<AppointmentDto>(initial);
  const [busy, setBusy] = useState(false);
  const paid = appt.payments.reduce((s, p) => s + p.amountJpy, 0);
  const balance = appt.totalPriceJpy - paid;
  const [payAmount, setPayAmount] = useState(String(Math.max(balance, 0)));
  const [payMethod, setPayMethod] = useState<string>("cash");
  const [reschedDate, setReschedDate] = useState(tokyoDateOf(fromIso(appt.startAt)));
  const [reschedTime, setReschedTime] = useState(tokyoTimeOf(fromIso(appt.startAt)));

  useEffect(() => {
    setPayAmount(String(Math.max(appt.totalPriceJpy - appt.payments.reduce((s, p) => s + p.amountJpy, 0), 0)));
  }, [appt]);

  async function refresh() {
    try {
      const fresh = await api.get<AppointmentDto>(`/admin/appointments/${appt.id}`);
      setAppt(fresh);
    } catch {
      /* 忽略 */
    }
    onChanged();
  }

  async function changeStatus(target: AppointmentStatus) {
    setBusy(true);
    try {
      if (target === "cancelled") {
        await api.post(`/admin/appointments/${appt.id}/cancel`, {});
      } else {
        await api.patch(`/admin/appointments/${appt.id}/status`, { status: target });
      }
      toast(t("common.saved"));
      await refresh();
    } catch {
      toast(t("common.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment() {
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBusy(true);
    try {
      await api.post("/admin/payments", { appointmentId: appt.id, amountJpy: amount, method: payMethod });
      toast(t("common.saved"));
      await refresh();
    } catch {
      toast(t("common.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    setBusy(true);
    try {
      await api.post(`/admin/appointments/${appt.id}/reschedule`, {
        startAt: toIso(tokyoMs(reschedDate, reschedTime)),
      });
      toast(t("common.saved"));
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast(t("customer.conflict"), "error");
      else toast(t("common.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  const transitions = (STATUS_TRANSITIONS[appt.status] ?? []).filter(
    (s) => !isStaff || s === "arrived" || s === "in_service" || s === "completed",
  );
  const startMs = fromIso(appt.startAt);
  const endMs = fromIso(appt.endAt);

  return (
    <Drawer title={t("admin.appointment.detail")} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-semibold text-slate-800">{appt.customer.name}</span>
          <StatusBadge status={appt.status} />
          <span className="ml-auto text-xs text-slate-400">{appt.bookingCode}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a className="salon-secondary" href={`tel:${appt.customer.phone.replace(/[^0-9+]/g, "")}`}><Icon name="phone" size={15}/>{locale === "ja" ? "電話する" : "拨打电话"}</a>
          <button type="button" className="salon-secondary" onClick={() => {
            const msg = `${appt.customer.name}\n${tokyoDateOf(fromIso(appt.startAt))} ${tokyoTimeOf(fromIso(appt.startAt))}–${tokyoTimeOf(fromIso(appt.endAt))}\n${appt.services.map(s=>localizedName(locale,s.nameZh,s.nameJa)).join(" / ")}\n${appt.bookingCode}`;
            void navigator.clipboard.writeText(msg).then(()=>toast(locale === "ja" ? "予約内容をコピーしました" : "已复制预约信息")).catch(()=>toast(locale === "ja" ? "コピーできませんでした" : "复制失败，请检查浏览器权限", "error"));
          }}><Icon name="copy" size={15}/>{locale === "ja" ? "予約内容をコピー" : "复制预约摘要"}</button>
        </div>
        <div className="text-sm leading-7 text-slate-500">
          {t("common.phone")}: {appt.customer.phone}
          <br />
          {t("customer.staffLabel")}: {appt.staff.name}
          <br />
          {t("common.time")}: {tokyoDateOf(startMs)} {tokyoTimeOf(startMs)}–{tokyoTimeOf(endMs)}
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-slate-500">{t("admin.appointment.services")}</div>
          <div className="flex flex-col gap-2">
            {appt.services.map((s) => (
              <div key={s.appointmentServiceId} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                    {localizedName(locale, s.nameZh, s.nameJa)}
                  </span>
                  <span className="text-slate-500">{yen(s.priceJpy)}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {tokyoTimeOf(fromIso(s.startAt))}–{tokyoTimeOf(fromIso(s.endAt))}
                  {s.resourceName ? ` · ${t("admin.appointment.resource")}: ${s.resourceName}` : ""}
                </div>
                {s.addons.map((ad) => (
                  <div key={ad.id} className="mt-0.5 flex justify-between text-xs text-slate-500">
                    <span className="truncate">+ {localizedName(locale, ad.nameZh, ad.nameJa)}</span>
                    <span>{yen(ad.priceJpy)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 text-sm text-slate-600">
            <span>
              {t("admin.appointment.price")}: <b>{yen(appt.totalPriceJpy)}</b>
            </span>
            <span>
              {t("admin.payments.paid")}: <b>{yen(paid)}</b>
            </span>
            {balance > 0 && (
              <span className="text-red-500">
                {t("admin.payments.unpaid")}: <b>{yen(balance)}</b>
              </span>
            )}
          </div>
          {appt.internalNote && (
            <div className="mt-2 text-xs text-slate-400">
              {t("common.note")}: {appt.internalNote}
            </div>
          )}
          {appt.serviceNote && (
            <div className="mt-1 text-xs text-slate-400">
              {t("staff.serviceNote")}: {appt.serviceNote}
            </div>
          )}
        </div>

        {transitions.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium text-slate-500">{t("admin.appointment.changeStatus")}</div>
            <div className="flex flex-wrap gap-2">
              {transitions.map((s) =>
                s === "cancelled" ? (
                  <button key={s} type="button" className={btnDanger} disabled={busy} onClick={() => void changeStatus(s)}>
                    {t("status.cancelled")}
                  </button>
                ) : (
                  <button key={s} type="button" className={btnGhost} disabled={busy} onClick={() => void changeStatus(s)}>
                    {t(`status.${s}` as MessageKey)}
                  </button>
                ),
              )}
            </div>
          </div>
        )}

        {!isStaff && appt.status !== "cancelled" && (
          <div className="rounded-2xl border border-slate-100 p-3">
            <div className="mb-2 text-xs font-medium text-slate-500">{t("admin.payments.record")}</div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-28 flex-1">
                <Field label={t("admin.payments.amount")}>
                  <input type="number" min={0} className={inputCls} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                </Field>
              </div>
              <div className="min-w-28 flex-1">
                <Field label={t("admin.payments.method")}>
                  <select className={inputCls} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                    {(["cash", "card", "paypay", "line_pay", "bank_transfer", "other"] as const).map((m) => (
                      <option key={m} value={m}>
                        {t(`paymethod.${m}` as MessageKey)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <button type="button" className={btnPrimary} disabled={busy || balance <= 0} onClick={() => void recordPayment()}>
                {t("common.confirm")}
              </button>
            </div>
          </div>
        )}

        {!isStaff && !TERMINAL.includes(appt.status) && (
          <div className="rounded-2xl border border-slate-100 p-3">
            <div className="mb-2 text-xs font-medium text-slate-500">{t("customer.reschedule")}</div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1">
                <Field label={t("common.date")}>
                  <input type="date" className={inputCls} value={reschedDate} onChange={(e) => setReschedDate(e.target.value)} />
                </Field>
              </div>
              <div className="flex-1">
                <Field label={t("common.time")}>
                  <input type="time" step={300} className={inputCls} value={reschedTime} onChange={(e) => setReschedTime(e.target.value)} />
                </Field>
              </div>
              <button type="button" className={btnGhost} disabled={busy} onClick={() => void reschedule()}>
                {t("common.confirm")}
              </button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
