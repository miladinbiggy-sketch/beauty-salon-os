import { createHash } from "node:crypto";

/** The operation fingerprint is for conflict detection, NOT customer authentication.
 * The UUID is a random retry handle, not a secret or a payment-provider transaction id.
 * Optional values are normalized so JSON omission and explicit null mean the same intent.
 */
export type PaymentIntent = {
  operation: "receipt" | "refund";
  appointmentId?: string | null;
  customerId?: string | null;
  originalPaymentId?: string | null;
  amountJpy: number;
  method?: string | null;
  providerRef?: string | null;
  note?: string | null;
  paidAt?: string | null;
};

export function paymentFingerprint(intent: PaymentIntent): string {
  const canonical = [
    intent.operation,
    intent.originalPaymentId ?? null,
    intent.appointmentId ?? null,
    intent.customerId ?? null,
    intent.amountJpy,
    intent.method ?? null,
    intent.providerRef ?? null,
    intent.note ?? null,
    intent.paidAt === undefined || intent.paidAt === null ? null : new Date(intent.paidAt).toISOString(),
  ];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function paymentRetryDisposition(
  existingFingerprint: string | null,
  incomingFingerprint: string,
): "replay" | "conflict" {
  // A key must NEVER become a fresh operation because a legacy row has no fingerprint.
  return existingFingerprint === incomingFingerprint ? "replay" : "conflict";
}
