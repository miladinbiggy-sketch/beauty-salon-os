-- V14: waitlist （等候名单/キャンセル待ち) for cancellation backfill.
-- A waitlist entry is a request to be contacted, never a booking: it holds no
-- allocation and cannot double-book. Staff work the list manually.
CREATE TABLE waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text NOT NULL,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  desired_date date NOT NULL,
  earliest_time text NOT NULL CHECK (earliest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  latest_time text NOT NULL CHECK (latest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','notified','booked','expired','cancelled')),
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_window_check CHECK (earliest_time < latest_time)
);
--> statement-breakpoint
CREATE INDEX waitlist_store_date_status_idx ON waitlist_entries (store_id, desired_date, status, created_at);
--> statement-breakpoint
CREATE INDEX waitlist_store_phone_idx ON waitlist_entries (store_id, phone);
