/** A volatile retry handle for an unchanged front-desk operation. */
export type PaymentRetryHandle = { signature: string; key: string };

/**
 * Preserve the random operation UUID after an ambiguous failure.
 * A changed amount, payment method, note, appointment, or original payment
 * creates a distinct intent; a confirmed success must explicitly clear it.
 */
export function nextPaymentRetryHandle(
  previous: PaymentRetryHandle | null,
  intent: unknown,
  generateUuid: () => string,
): PaymentRetryHandle {
  const signature = JSON.stringify(intent);
  if (previous?.signature === signature) return previous;
  return { signature, key: generateUuid() };
}
