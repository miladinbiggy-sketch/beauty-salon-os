import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppointmentStatus } from "@salon/shared";
import { useI18n } from "./i18n";

/* 与 apps/api/src/services/booking.ts 的 STATUS_TRANSITIONS 保持一致（前端按钮按它渲染） */
export const STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ["confirmed", "arrived", "cancelled", "no_show"],
  confirmed: ["arrived", "cancelled", "no_show"],
  arrived: ["in_service", "cancelled"],
  in_service: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

/* ---------------- 样式常量 ---------------- */
export const inputCls =
  "w-full min-w-0 rounded-xl border border-[#dce6df] bg-white px-3 py-2.5 text-sm text-[#375649] outline-none focus:border-[#60a283] focus:ring-2 focus:ring-[#d7ecdd]";
export const btnPrimary =
  "salon-action disabled:cursor-not-allowed disabled:opacity-50";
export const btnGhost =
  "salon-secondary disabled:cursor-not-allowed disabled:opacity-50";
export const btnDanger =
  "salon-secondary !border-red-200 !text-red-600 hover:!bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";
export const btnSmall =
  "salon-secondary !min-h-[30px] !px-3 !py-1 disabled:opacity-50";
export const cardCls = "salon-surface";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

/* ---------------- 状态徽章 ---------------- */
const STATUS_BADGE: Record<AppointmentStatus, string> = {
  booked: "bg-slate-100 text-slate-700",
  confirmed: "bg-blue-100 text-blue-700",
  arrived: "bg-amber-100 text-amber-700",
  in_service: "bg-violet-100 text-violet-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-400",
  no_show: "bg-red-100 text-red-600",
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}>
      {t(`status.${status}`)}
    </span>
  );
}

/* ---------------- 弹窗 / 抽屉 ---------------- */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();
  useEffect(() => {const onKey=(e: KeyboardEvent)=>{if(e.key==="Escape") onClose();};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);},[onClose]);
  return (
    <div role="presentation" className="fixed inset-0 z-40 flex items-end justify-center bg-[#213b32]/45 p-0 backdrop-blur-[3px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={title}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-[26px] bg-white shadow-[0_24px_80px_-25px_#1d3b2d] sm:rounded-[24px] ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[#e8efe9] bg-white/95 px-5 py-4 backdrop-blur">
          <h2 className="min-w-0 truncate text-base font-bold text-[#2c4b3d]">{title}</h2>
          <button type="button" className="shrink-0 rounded-full px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {const onKey=(e: KeyboardEvent)=>{if(e.key==="Escape") onClose();};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);},[onClose]);
  return (
    <div role="presentation" className="fixed inset-0 z-40 bg-[#213b32]/45 backdrop-blur-[3px]" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={title}
        className="absolute right-0 top-0 h-full w-full max-w-[490px] overflow-y-auto bg-white shadow-[0_0_75px_-20px_#182d20]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[#e8efe9] bg-white/95 px-5 py-4 backdrop-blur">
          <h2 className="min-w-0 truncate text-base font-bold text-[#2c4b3d]">{title}</h2>
          <button type="button" className="shrink-0 rounded-full px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Toast ---------------- */
interface ToastItem {
  id: number;
  text: string;
  kind: "ok" | "error";
}

const ToastCtx = createContext<{ toast: (text: string, kind?: "ok" | "error") => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const toast = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, text, kind }]);
    window.setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 3800);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
        {items.map((i) => (
          <div
            key={i.id}
            className={`w-auto max-w-full truncate rounded-full px-4 py-2 text-sm shadow-lg ${
              i.kind === "error" ? "bg-red-600 text-white" : "bg-slate-800 text-white"
            }`}
          >
            {i.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): { toast: (text: string, kind?: "ok" | "error") => void } {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}

/* ---------------- 通用小工具 ---------------- */
export function useYen(): (amount: number) => string {
  const { t } = useI18n();
  return useCallback((amount: number) => t("common.yen", { amount: amount.toLocaleString("ja-JP") }), [t]);
}

export function Loading() {
  const { t } = useI18n();
  return <div className="px-4 py-10 text-center text-sm text-slate-400">{t("common.loading")}</div>;
}
