-- V10: record a delivery lease and the first outbound attempt to bound LINE retries.
ALTER TABLE notification_jobs ADD COLUMN sending_started_at timestamptz;
--> statement-breakpoint
ALTER TABLE notification_jobs ADD COLUMN first_attempt_at timestamptz;
--> statement-breakpoint
-- Old-version workers sent LINE without an idempotency header; replay is unsafe.
-- Require manual provider reconciliation, don't silently duplicate an old send.
UPDATE notification_jobs
SET status = 'failed',
    last_error = 'V10 migration: legacy sending state is ambiguous; reconcile with provider manually'
WHERE status = 'sending';
--> statement-breakpoint
CREATE INDEX notification_jobs_sending_lease_idx ON notification_jobs (sending_started_at)
WHERE status = 'sending';
