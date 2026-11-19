-- V2 append-only service care history (not a medical record).
CREATE TABLE IF NOT EXISTS "care_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "appointment_id" uuid REFERENCES "appointments"("id") ON DELETE SET NULL,
  "category" text NOT NULL,
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "memo" text,
  "authored_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "care_records_category_ck" CHECK ("category" IN ('nail','lash','beauty'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_records_customer_created_idx" ON "care_records" ("store_id", "customer_id", "created_at");
