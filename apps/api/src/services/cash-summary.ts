/**
 * Daily closing is always calculated from the FULL ledger (never the 500-row UI page).
 * Cash balance means money physically expected in the drawer, not total sales.
 */
export interface MethodTotal {
  method: string;
  receivedJpy: number;
  refundedJpy: number;
  netJpy: number;
  transactionCount: number;
}
export interface DayLedgerSummary {
  receivedJpy: number;
  refundedJpy: number;
  netJpy: number;
  cashNetJpy: number;
  transactionCount: number;
  methods: MethodTotal[];
}
export interface PgMethodTotals {
  method: string;
  received_jpy: string | number;
  refunded_jpy: string | number;
  transaction_count: string | number;
}

function safeAmount(raw: string | number): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Cash close ledger sum exceeds safe integer range");
  }
  return value;
}

export function summarizeMethodTotals(rows: readonly PgMethodTotals[]): DayLedgerSummary {
  const methods = rows.map((row) => {
    const receivedJpy = safeAmount(row.received_jpy);
    const refundedJpy = safeAmount(row.refunded_jpy);
    return {
      method: row.method,
      receivedJpy,
      refundedJpy,
      netJpy: receivedJpy - refundedJpy,
      transactionCount: safeAmount(row.transaction_count),
    };
  });
  const receivedJpy = methods.reduce((sum, row) => sum + row.receivedJpy, 0);
  const refundedJpy = methods.reduce((sum, row) => sum + row.refundedJpy, 0);
  const transactionCount = methods.reduce((sum, row) => sum + row.transactionCount, 0);
  for (const amount of [receivedJpy, refundedJpy, transactionCount]) {
    if (!Number.isSafeInteger(amount)) throw new Error("Cash close total exceeds safe integer range");
  }
  return {
    receivedJpy,
    refundedJpy,
    netJpy: receivedJpy - refundedJpy,
    cashNetJpy: methods.find((row) => row.method === "cash")?.netJpy ?? 0,
    transactionCount,
    methods,
  };
}

/** Reject 2026-02-30 and other invalid YYYY-MM-DD dates rather than normalizing them. */
export function isValidBusinessDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}
