import type {
  AppointmentStatus,
  PaymentMethod,
  ResourceType,
  ServiceCategory,
  StoreSettings,
  UserRole,
} from "@salon/shared";

/** API 客户端：Session 使用 HttpOnly Cookie，不在 localStorage 存凭据。 */
const BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown; idempotencyKey?: string }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init?.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    credentials: "include",
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401 && path !== "/auth/login" && path !== "/auth/me") {
    window.dispatchEvent(new Event("salon:unauthorized"));
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? "INTERNAL", e?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, options?: { idempotencyKey?: string }) =>
    request<T>(path, { method: "POST", body: body ?? {}, idempotencyKey: options?.idempotencyKey }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body ?? {} }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/* ---------------- 与后端契约对应的类型 ---------------- */

export interface AuthUser {
  userId: string;
  storeId: string;
  role: UserRole;
  staffId: string | null;
  name: string;
  email: string;
}

export interface BusinessHour {
  weekday: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface StoreInfo {
  id: string;
  name: string;
  nameJa: string | null;
  phone: string | null;
  address: string | null;
  settings: StoreSettings;
  businessHours: BusinessHour[];
}

export interface ServiceAddon {
  id: string;
  serviceId: string;
  nameZh: string;
  nameJa: string;
  priceJpy: number;
  durationMinutes: number;
  active: boolean;
}

export interface Service {
  id: string;
  storeId: string;
  category: ServiceCategory;
  nameZh: string;
  nameJa: string;
  descriptionZh: string | null;
  descriptionJa: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  priceJpy: number;
  resourceType: ResourceType | null;
  color: string;
  sortOrder: number;
  active: boolean;
  addons: ServiceAddon[];
}

export interface StaffMember {
  id: string;
  storeId: string;
  name: string;
  nameJa: string | null;
  color: string;
  sortOrder: number;
  active: boolean;
  skillServiceIds: string[];
}

export interface ShiftBreak {
  startTime: string;
  endTime: string;
}

export interface Shift {
  id: string;
  storeId: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  breaks: ShiftBreak[];
}

export interface BlockedTime {
  id: string;
  storeId: string;
  staffId: string | null;
  resourceId: string | null;
  type: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

export interface Resource {
  id: string;
  storeId: string;
  type: ResourceType;
  name: string;
  active: boolean;
}

export interface Customer {
  id: string;
  storeId: string;
  name: string;
  nameKana: string | null;
  phone: string;
  email: string | null;
  notes: string | null;
  tags: string[];
  visitCount: number;
  totalSpentJpy: number;
}

export interface CustomerHistoryItem {
  id: string;
  status: AppointmentStatus;
  staffId: string;
  startAt: string;
  endAt: string;
  totalPriceJpy: number;
  bookingCode: string;
}

export interface CustomerDetail extends Customer {
  history: CustomerHistoryItem[];
}

export interface CashMethodTotal {
  method: string;
  receivedJpy: number;
  refundedJpy: number;
  netJpy: number;
  transactionCount: number;
}
export interface CashCloseSummary {
  receivedJpy: number;
  refundedJpy: number;
  netJpy: number;
  cashNetJpy: number;
  transactionCount: number;
  methods: CashMethodTotal[];
}
export interface CashCloseSnapshot {
  id: string;
  businessDate: string;
  openingCashJpy: number;
  countedCashJpy: number;
  expectedCashJpy: number;
  varianceJpy: number;
  receivedJpy: number;
  refundedJpy: number;
  netJpy: number;
  cashNetJpy: number;
  transactionCount: number;
  methodTotals: CashMethodTotal[];
  note: string | null;
  closedBy: string | null;
  closedAt: string;
}
export interface CashClosePreview {
  date: string;
  summary: CashCloseSummary;
  closed: CashCloseSnapshot | null;
}

export interface Payment {
  id: string;
  storeId: string;
  appointmentId: string | null;
  customerId: string | null;
  amountJpy: number;
  method: PaymentMethod;
  status: string;
  providerRef: string | null;
  note: string | null;
  refundOfId: string | null;
  paidAt: string;
  createdAt: string;
}

/** 与 apps/api/src/services/booking.ts 的 AppointmentDto 一致 */
export interface AppointmentDto {
  id: string;
  storeId: string;
  bookingCode: string;
  status: AppointmentStatus;
  source: string;
  locale: string;
  customer: { id: string; name: string; phone: string; email: string | null };
  staff: { id: string; name: string; nameJa: string | null; color: string };
  startAt: string;
  endAt: string;
  blockedEndAt: string;
  totalPriceJpy: number;
  customerNote: string | null;
  internalNote: string | null;
  serviceNote: string | null;
  services: {
    appointmentServiceId: string;
    serviceId: string;
    nameZh: string;
    nameJa: string;
    position: number;
    startAt: string;
    endAt: string;
    priceJpy: number;
    durationMinutes: number;
    bufferMinutes: number;
    resourceType: string | null;
    resourceId: string | null;
    resourceName: string | null;
    addons: { id: string; nameZh: string; nameJa: string; priceJpy: number; durationMinutes: number }[];
  }[];
  payments: { id: string; amountJpy: number; method: string; status: string; paidAt: string }[];
  createdAt: string;
}

export interface ReportSummary {
  from: string;
  to: string;
  revenueJpy: number;
  revenueByDay: { date: string; revenueJpy: number }[];
  appointmentsByStatus: Record<string, number>;
  appointmentsTotal: number;
  staffPerformance: { staffId: string; name: string; completedCount: number; revenueJpy: number }[];
  serviceRanking: { serviceId: string; nameZh: string; nameJa: string; count: number; revenueJpy: number }[];
}

export interface StaffPerformance {
  completedCount: number;
  revenueJpy: number;
}
