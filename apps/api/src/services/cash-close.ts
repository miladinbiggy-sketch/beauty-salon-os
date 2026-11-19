import { sql } from "drizzle-orm";
export { isValidBusinessDate, summarizeMethodTotals } from "./cash-summary.js";
export type { PgMethodTotals, DayLedgerSummary, MethodTotal } from "./cash-summary.js";

/** One lock per store serializes payment inserts, refunds and immutable closing. */
export function cashLedgerLock(storeId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtextextended(${'beauty-salon-cash:' + storeId}, 0))`;
}

export function methodTotalsQuery(storeId: string, start: Date, end: Date) {
  return sql`
    SELECT method,
      COALESCE(SUM(CASE WHEN amount_jpy > 0 THEN amount_jpy ELSE 0 END), 0)::bigint AS received_jpy,
      COALESCE(SUM(CASE WHEN amount_jpy < 0 THEN -amount_jpy ELSE 0 END), 0)::bigint AS refunded_jpy,
      COUNT(*)::bigint AS transaction_count
    FROM payments
    WHERE store_id = ${storeId} AND paid_at >= ${start} AND paid_at < ${end}
    GROUP BY method ORDER BY method
  `;
}

