-- V6: immutable per-store, per-Tokyo-day cash close snapshot.
CREATE TABLE IF NOT EXISTS "cash_closes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "business_date" date NOT NULL,
  "opening_cash_jpy" integer NOT NULL,
  "counted_cash_jpy" integer NOT NULL,
  "expected_cash_jpy" integer NOT NULL,
  "variance_jpy" integer NOT NULL,
  "received_jpy" bigint NOT NULL,
  "refunded_jpy" bigint NOT NULL,
  "net_jpy" bigint NOT NULL,
  "cash_net_jpy" bigint NOT NULL,
  "transaction_count" integer NOT NULL,
  "method_totals" jsonb NOT NULL,
  "note" text,
  "closed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "closed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cash_closes_nonnegative_cash_ck" CHECK ("opening_cash_jpy" >= 0 AND "counted_cash_jpy" >= 0),
  CONSTRAINT "cash_closes_reason_for_variance_ck" CHECK ("variance_jpy" = 0 OR length(btrim(coalesce("note",''))) >= 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_closes_store_day_unique" ON "cash_closes" ("store_id", "business_date");
