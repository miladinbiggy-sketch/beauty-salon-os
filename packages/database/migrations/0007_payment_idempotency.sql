-- V12: an operation key identifies ONE receipt or refund within a salon store.
-- Deploy the migration BEFORE updating any API/worker instances.
ALTER TABLE payments ADD COLUMN idempotency_key uuid;
--> statement-breakpoint
ALTER TABLE payments ADD COLUMN idempotency_fingerprint text;
--> statement-breakpoint
CREATE UNIQUE INDEX payments_store_idempotency_key_unique
  ON payments (store_id, idempotency_key);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_idempotency_pair_check CHECK (
  (idempotency_key IS NULL AND idempotency_fingerprint IS NULL)
  OR (idempotency_key IS NOT NULL AND idempotency_fingerprint IS NOT NULL)
);
