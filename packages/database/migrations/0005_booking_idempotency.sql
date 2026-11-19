-- V7: durable public booking request deduplication; nullable for legacy appointments.
-- PostgreSQL UNIQUE treats NULLs as distinct (old rows remain valid).
ALTER TABLE appointments
  ADD COLUMN idempotency_key uuid,
  ADD COLUMN idempotency_fingerprint text;
--> statement-breakpoint
CREATE UNIQUE INDEX appointments_store_idempotency_unique
  ON appointments (store_id, idempotency_key);
--> statement-breakpoint
-- Even direct SQL inserts must not create half-populated deduplication records.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_idempotency_pair_check CHECK (
    (idempotency_key IS NULL AND idempotency_fingerprint IS NULL)
    OR (idempotency_key IS NOT NULL AND idempotency_fingerprint IS NOT NULL)
  );
