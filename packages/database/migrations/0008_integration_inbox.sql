-- V13: authenticated third-party bridge events. The inbox NEVER auto-creates bookings or processes money.
-- Event content is deliberately minimized. No raw webhook JSON, customer name, phone or health notes stored.
CREATE TABLE integration_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  external_booking_ref text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('booking_requested','booking_changed','booking_cancelled')),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  start_at timestamptz,
  end_at timestamptz,
  service_ref text,
  staff_ref text,
  local_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  local_service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  review_state text NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','conflict','needs_mapping','linked','ignored')),
  linked_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_inbox_window_check CHECK (
    (event_type = 'booking_cancelled' AND start_at IS NULL AND end_at IS NULL)
    OR (event_type <> 'booking_cancelled' AND start_at IS NOT NULL AND end_at IS NOT NULL AND start_at < end_at)
  ),
  CONSTRAINT integration_inbox_review_check CHECK (
    (review_state = 'linked' AND linked_appointment_id IS NOT NULL AND reviewed_by IS NOT NULL)
    OR (review_state = 'ignored' AND reviewed_by IS NOT NULL)
    OR (review_state NOT IN ('linked','ignored') AND linked_appointment_id IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX integration_inbox_store_provider_event_unique ON integration_inbox (store_id, provider, external_event_id);
--> statement-breakpoint
CREATE INDEX integration_inbox_store_state_idx ON integration_inbox (store_id, review_state, created_at DESC);
--> statement-breakpoint
CREATE INDEX integration_inbox_external_booking_idx ON integration_inbox (store_id, provider, external_booking_ref);
