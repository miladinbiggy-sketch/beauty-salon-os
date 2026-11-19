-- V4: server-revocable administrative login sessions.
CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx" ON "auth_sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_expiry_idx" ON "auth_sessions" ("expires_at");
