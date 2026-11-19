import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@salon/database";
import { renderMessage, senderFor, type JobLike } from "./senders.js";
import { PermanentNotificationError } from "./line-delivery.js";
import { retryDisposition, shouldSendBookingNotice } from "./notification-policy.js";

const MAX_ATTEMPTS = 3;
type JobRow = typeof schema.notificationJobs.$inferSelect;

function toJobLike(row: JobRow): JobLike {
  return { id: row.id, type: row.type, channel: row.channel, recipient: row.recipient, payload: row.payload };
}

/**
 * Claim atomically by status; select back through Drizzle, never `RETURNING *` cast
 * to a schema row: raw postgres returns `scheduled_at`, not `scheduledAt`.
 */
async function hydrateClaim(db: Database, rows: { id: string }[]): Promise<JobRow | null> {
  const id = rows[0]?.id;
  if (!id) return null;
  const [job] = await db.select().from(schema.notificationJobs).where(eq(schema.notificationJobs.id, id));
  return job ?? null;
}

export async function claimNextJob(db: Database): Promise<JobRow | null> {
  const rows = await db.execute(sql`
    UPDATE notification_jobs
    SET status = 'sending', attempts = attempts + 1,
        sending_started_at = NOW(), first_attempt_at = COALESCE(first_attempt_at, NOW())
    WHERE id = (
      SELECT id FROM notification_jobs
      WHERE status = 'queued' AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  return hydrateClaim(db, rows.rows as { id: string }[]);
}

export async function claimJobById(db: Database, jobId: string): Promise<JobRow | null> {
  const rows = await db.execute(sql`
    UPDATE notification_jobs
    SET status = 'sending', attempts = attempts + 1,
        sending_started_at = NOW(), first_attempt_at = COALESCE(first_attempt_at, NOW())
    WHERE id = ${jobId} AND status = 'queued' AND scheduled_at <= NOW()
    RETURNING id`);
  return hydrateClaim(db, rows.rows as { id: string }[]);
}

/** Check live appointment status and start time before dispatching old reminders. */
async function staleNoticeReason(db: Database, row: JobRow): Promise<string | null> {
  if (!row.appointmentId) return null; // non-booking or legacy standalone job
  const [appt] = await db.select({
    status: schema.appointments.status,
    startAt: schema.appointments.startAt,
  }).from(schema.appointments).where(and(
    eq(schema.appointments.id, row.appointmentId),
    eq(schema.appointments.storeId, row.storeId),
  ));
  const payload = (row.payload ?? {}) as { startAt?: string };
  const decision = shouldSendBookingNotice({
    type: row.type,
    status: appt?.status ?? null,
    payloadStartAt: payload.startAt,
    currentStartAtMs: appt?.startAt.getTime() ?? null,
    nowMs: Date.now(),
  });
  return decision.allowed ? null : decision.reason;
}

export async function processClaimedJob(
  db: Database,
  row: JobRow,
  lineToken: string | undefined,
): Promise<"sent" | "skipped" | "failed" | "retry"> {
  try {
    const staleReason = await staleNoticeReason(db, row);
    if (staleReason) {
      await db.update(schema.notificationJobs).set({
        status: "skipped", sendingStartedAt: null,
        lastError: `stale notice: ${staleReason}`.slice(0, 500),
      }).where(and(eq(schema.notificationJobs.id, row.id), eq(schema.notificationJobs.status, "sending")));
      return "skipped";
    }
    const job = toJobLike(row);
    const text = renderMessage(job);
    const result = await senderFor(job, lineToken).send(job, text);
    await db.update(schema.notificationJobs).set({
      status: result.provider === "mock" ? "skipped" : "sent",
      sentAt: result.provider === "mock" ? null : new Date(),
      sendingStartedAt: null,
      lastError: result.provider === "mock" ? result.detail : null,
    }).where(and(eq(schema.notificationJobs.id, row.id), eq(schema.notificationJobs.status, "sending")));
    return result.provider === "mock" ? "skipped" : "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const decision = retryDisposition({
      attempts: row.attempts,
      firstAttemptMs: row.firstAttemptAt?.getTime() ?? null,
      nowMs: Date.now(),
      permanent: error instanceof PermanentNotificationError,
      maxAttempts: MAX_ATTEMPTS,
    });
    await db.update(schema.notificationJobs).set({
      status: decision === "failed" ? "failed" : "queued",
      sendingStartedAt: null,
      lastError: message.slice(0, 500),
      scheduledAt: decision === "failed" ? row.scheduledAt : new Date(Date.now() + 60_000 * row.attempts),
    }).where(and(eq(schema.notificationJobs.id, row.id), eq(schema.notificationJobs.status, "sending")));
    return decision;
  }
}

export async function processDueJobs(
  db: Database,
  lineToken: string | undefined,
  limit = 50,
): Promise<number> {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const row = await claimNextJob(db);
    if (!row) break;
    await processClaimedJob(db, row, lineToken);
    processed++;
  }
  return processed;
}

/**
 * Only reclaim expired 10-minute sending leases (never a live concurrent sender).
 * LINE deduplication lasts only 24h, so jobs beyond 23h after their first
 * attempt require manual provider reconciliation instead of unsafe replay.
 */
export async function recoverStuckJobs(db: Database): Promise<void> {
  await db.execute(sql`
    UPDATE notification_jobs
    SET status = CASE WHEN attempts >= ${MAX_ATTEMPTS}
                      OR first_attempt_at IS NULL
                      OR first_attempt_at <= NOW() - INTERVAL '23 hours'
                      THEN 'failed' ELSE 'queued' END,
        last_error = CASE WHEN attempts >= ${MAX_ATTEMPTS}
                      OR first_attempt_at IS NULL
                      OR first_attempt_at <= NOW() - INTERVAL '23 hours'
                      THEN 'Sending lease expired: manual delivery reconciliation required'
                      ELSE 'Sending lease expired; safely requeued with same retry key' END,
        sending_started_at = NULL
    WHERE status = 'sending'
      AND (sending_started_at IS NULL OR sending_started_at <= NOW() - INTERVAL '10 minutes')
  `);
}
