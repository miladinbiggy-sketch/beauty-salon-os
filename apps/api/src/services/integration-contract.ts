import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Provider identifiers describe a candidate connector, NOT an official provider API integration. */
export const PROVIDERS = [
  { id: "jp_csnext", country: "JP", name: "CSNEXT", mode: "manual_or_partner" },
  { id: "jp_salonboard", country: "JP", name: "SALON BOARD / HOT PEPPER Beauty", mode: "manual_or_partner" },
  { id: "jp_karutekun", country: "JP", name: "KaruteKun", mode: "manual_or_partner" },
  { id: "jp_kanzashi", country: "JP", name: "かんざし", mode: "partner_approval" },
  { id: "jp_reservia", country: "JP", name: "Reservia", mode: "partner_approval" },
  { id: "jp_line", country: "JP", name: "LINE公式アカウント", mode: "official_api_separate" },
  { id: "jp_google_calendar", country: "JP", name: "Google カレンダー", mode: "csv_ics_export" },
  { id: "cn_meituan", country: "CN", name: "美团 / 大众点评", mode: "partner_approval" },
  { id: "cn_douyin", country: "CN", name: "抖音生活服务", mode: "partner_approval" },
  { id: "cn_wechat", country: "CN", name: "微信小程序 / 公众号", mode: "official_api_separate" },
  { id: "cn_alipay", country: "CN", name: "支付宝小程序", mode: "partner_approval" },
  { id: "cn_xiaohongshu", country: "CN", name: "小红书", mode: "manual_or_partner" },
  { id: "custom_bridge", country: "BOTH", name: "授权第三方/自有系统中转", mode: "bridge_contract" },
] as const;
export type ProviderId = (typeof PROVIDERS)[number]["id"];
export function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.some((p) => p.id === value);
}

/** Never expose keys to frontend or store them in SQL. The env format is a flat key/value map. */
export function parseIntegrationKeys(config: string): Readonly<Record<string, string>> {
  let raw: unknown;
  try { raw = JSON.parse(config); } catch { throw new Error("Invalid PARTNER_WEBHOOK_KEYS_JSON"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid integration keys map");
  const entries = Object.entries(raw);
  const map: Record<string, string> = Object.create(null);
  for (const [key, value] of entries) {
    const match = /^([0-9a-f-]{36}):(jp_[a-z_]+|cn_[a-z_]+|custom_bridge)$/.exec(key);
    const provider = match?.[2];
    if (!match || provider === undefined || !isProviderId(provider) || typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
      throw new Error("Invalid integration signing configuration");
    }
    map[key] = value.toLowerCase(); // 32-byte secret encoded as hex
  }
  return map;
}

export function integrationKey(keys: Readonly<Record<string, string>>, storeId: string, provider: string): Buffer | null {
  const hex = Object.hasOwn(keys, `${storeId}:${provider}`) ? keys[`${storeId}:${provider}`] : undefined;
  return hex ? Buffer.from(hex, "hex") : null;
}

/** Custom bridge scheme; never pass through as a LINE/Meituan native webhook signature. */
export function signedPayload(secret: Uint8Array, unixSeconds: number, raw: Uint8Array): string {
  return createHmac("sha256", secret).update(`${unixSeconds}.`).update(raw).digest("hex");
}
export function verifySignedPayload(
  secret: Uint8Array | null,
  unixTimeHeader: string | undefined,
  signature: string | undefined,
  raw: Uint8Array,
  nowMs = Date.now(),
): boolean {
  if (!secret || secret.length !== 32 || !unixTimeHeader || !/^[0-9]{10}$/.test(unixTimeHeader)) return false;
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const seconds = Number(unixTimeHeader);
  if (Math.abs(Math.floor(nowMs / 1000) - seconds) > 300) return false;
  const expected = Buffer.from(signedPayload(secret, seconds, raw), "hex");
  const given = Buffer.from(signature.slice(7), "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Stored fingerprint is only for identifying changed duplicate events; do not store raw payload. */
export function eventDigest(raw: Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Spreadsheet export is deliberately PII-free; escape Excel formula injection. */
export function csvCell(value: unknown): string {
  const s = String(value ?? "");
  const safe = /^[\s\u0000-\u001f]*[=+@\-\t\r]/u.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function bookingCsv(rows: Array<{
  id: string; bookingCode: string; source: string; status: string;
  startAt: Date; endAt: Date; staffId: string;
}>): string {
  const cols = ["appointment_id", "booking_code", "source", "status", "start_at_utc", "end_at_utc", "staff_id"];
  return "\uFEFF" + [cols.map(csvCell).join(","), ...rows.map((r) => [
    r.id, r.bookingCode, r.source, r.status, r.startAt.toISOString(), r.endAt.toISOString(), r.staffId,
  ].map(csvCell).join(","))].join("\r\n") + "\r\n";
}
