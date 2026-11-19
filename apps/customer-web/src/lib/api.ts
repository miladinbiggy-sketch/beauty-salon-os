import type { AppointmentStatus, Locale, ServiceCategory } from "@salon/shared";

/**
 * 顾客端 API 客户端。对接 apps/api/src/routes/public.ts 的确切形状。
 * 基址与门店 ID 可由环境变量覆盖（多门店部署时注入）。
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
export const STORE_ID: string =
  import.meta.env.VITE_STORE_ID ?? "11111111-1111-4111-8111-111111111111";

/** 顾客的一个选择：一个项目 + 其附加项 */
export interface Selection {
  serviceId: string;
  addonIds: string[];
}

export interface BusinessHour {
  weekday: number; // 1=周一 .. 7=周日
  openTime: string; // HH:mm
  closeTime: string; // HH:mm
  isClosed: boolean;
}

export interface StoreInfo {
  id: string;
  name: string;
  nameJa: string | null;
  phone: string | null;
  address: string | null;
  businessHours: BusinessHour[];
  booking: {
    bookingWindowDays: number;
    minLeadMinutes: number;
    slotStepMinutes: number;
  };
}

export interface ServiceAddon {
  id: string;
  nameZh: string;
  nameJa: string;
  priceJpy: number;
  durationMinutes: number;
}

export interface Service {
  id: string;
  category: ServiceCategory;
  nameZh: string;
  nameJa: string;
  descriptionZh: string | null;
  descriptionJa: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  priceJpy: number;
  resourceType: string | null;
  color: string;
  addons: ServiceAddon[];
}

export interface StaffMember {
  id: string;
  name: string;
  nameJa: string | null;
  color: string;
  skillServiceIds: string[];
}

export interface AvailabilityOption {
  staffId: string;
  startAt: string; // ISO UTC
  endAt: string; // ISO UTC（顾客视角结束时间）
  totalPriceJpy: number;
}

export interface AppointmentServiceDto {
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
}

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
  services: AppointmentServiceDto[];
  createdAt: string;
}

/** 带 HTTP 状态码的 API 错误，调用方按 status 分支处理（如 409 冲突） */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Network error");
  }
  if (!res.ok) {
    let code = "UNKNOWN";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      /* 非 JSON 错误体，保留默认信息 */
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.set(k, v);
  return sp.toString();
};

export const api = {
  getStore(storeId: string): Promise<StoreInfo> {
    return request<StoreInfo>(`/public/stores/${storeId}`);
  },
  getServices(storeId: string): Promise<Service[]> {
    return request<Service[]>(`/public/services?${qs({ storeId })}`);
  },
  getStaff(storeId: string): Promise<StaffMember[]> {
    return request<StaffMember[]>(`/public/staff?${qs({ storeId })}`);
  },
  getAvailability(args: {
    storeId: string;
    date: string; // YYYY-MM-DD（Tokyo）
    selections: Selection[];
    staffId?: string;
  }): Promise<AvailabilityOption[]> {
    return request<AvailabilityOption[]>(
      `/public/availability?${qs({
        storeId: args.storeId,
        date: args.date,
        sel: JSON.stringify(args.selections),
        staffId: args.staffId,
      })}`,
    );
  },
  createAppointment(body: {
    storeId: string;
    name: string;
    phone: string;
    email?: string;
    staffId?: string;
    startAt: string;
    selections: Selection[];
    note?: string;
    locale: Locale;
  }, idempotencyKey: string): Promise<AppointmentDto> {
    return request<AppointmentDto>(`/public/appointments`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
  },
  joinWaitlist(body: {
    storeId: string;
    name: string;
    phone: string;
    serviceId?: string | null;
    staffId?: string | null;
    date: string;
    earliestTime: string;
    latestTime: string;
  }): Promise<{ id: string; status: string; duplicate: boolean }> {
    return request(`/public/waitlist`, { method: "POST", body: JSON.stringify(body) });
  },
  lookupAppointment(body: { storeId: string; bookingCode: string; phone: string }): Promise<AppointmentDto> {
    return request<AppointmentDto>(`/public/appointments/lookup`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  cancelAppointment(body: { storeId: string; bookingCode: string; phone: string }): Promise<AppointmentDto> {
    return request<AppointmentDto>(`/public/appointments/cancel`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  rescheduleAppointment(body: {
    storeId: string;
    bookingCode: string;
    phone: string;
    startAt: string;
    staffId?: string;
  }): Promise<AppointmentDto> {
    return request<AppointmentDto>(`/public/appointments/reschedule`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
};

/** 按当前语言取名称：zh-CN 用中文名，ja 用日文名（缺失时回退） */
export function localizedName(
  locale: Locale,
  names: { nameZh?: string | null; nameJa?: string | null; name?: string | null },
): string {
  if (locale === "zh-CN") return names.nameZh ?? names.nameJa ?? names.name ?? "";
  return names.nameJa ?? names.nameZh ?? names.name ?? "";
}

/**
 * 按排单引擎 planCombo 规则计算选择组合的总价与总时长：
 * 总价 = Σ(项目价 + 附加价)；总时长 = Σ(项目时长 + 附加时长) + 段间缓冲
 * （段间缓冲 = 上一段项目的 bufferMinutes，首个项目之前不加）。
 */
export function computeTotals(
  services: Service[],
  selections: Selection[],
): { totalPriceJpy: number; totalDurationMinutes: number } {
  const byId = new Map(services.map((s) => [s.id, s]));
  let totalPriceJpy = 0;
  let totalDurationMinutes = 0;
  selections.forEach((sel, idx) => {
    const svc = byId.get(sel.serviceId);
    if (!svc) return;
    if (idx > 0) {
      const prev = byId.get(selections[idx - 1]!.serviceId);
      if (prev) totalDurationMinutes += prev.bufferMinutes;
    }
    totalPriceJpy += svc.priceJpy;
    totalDurationMinutes += svc.durationMinutes;
    for (const addonId of sel.addonIds) {
      const addon = svc.addons.find((a) => a.id === addonId);
      if (addon) {
        totalPriceJpy += addon.priceJpy;
        totalDurationMinutes += addon.durationMinutes;
      }
    }
  });
  return { totalPriceJpy, totalDurationMinutes };
}
