import { createHash } from "node:crypto";

/**
 * Fingerprint only facts that determine a single appointment, not network IP or request timing.
 * The separate, unpredictable request UUID is a retry handle, not customer authentication.
 * This unsalted digest only detects changes to a request; it is not a secure PII vault.
 */
export interface IdempotentBookingRequest {
  storeId: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  staffId?: string;
  startMs: number;
  selections: { serviceId: string; addonIds?: string[] }[];
  source: string;
  locale: string;
  customerNote?: string;
  internalNote?: string;
  actorUserId?: string | null;
  enforceLeadRules?: boolean;
}

export function bookingFingerprint(request: IdempotentBookingRequest): string {
  // Explicit fixed key order. No secrets, credentials, or raw customer data are stored.
  const canonical = {
    storeId: request.storeId,
    customerId: request.customerId ?? null,
    customerName: request.customerName ?? null,
    customerPhone: request.customerPhone ?? null,
    customerEmail: request.customerEmail ?? null,
    staffId: request.staffId ?? null,
    startMs: request.startMs,
    selections: request.selections.map((s) => ({
      serviceId: s.serviceId,
      addonIds: [...(s.addonIds ?? [])].sort(),
    })),
    source: request.source,
    locale: request.locale,
    customerNote: request.customerNote ?? null,
    internalNote: request.internalNote ?? null,
    actorUserId: request.actorUserId ?? null,
    enforceLeadRules: request.enforceLeadRules ?? false,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
