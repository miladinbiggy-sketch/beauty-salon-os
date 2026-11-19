import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gt, inArray, lt, gte } from "drizzle-orm";
import { schema, type Database } from "@salon/database";
import { ACTIVE_APPOINTMENT_STATUSES, err } from "@salon/shared";
import type { AppConfig } from "../config.js";
import { authMiddleware, type AuthUser } from "../auth.js";
import { storeLock } from "../services/booking.js";
import {
  PROVIDERS, bookingCsv, eventDigest, integrationKey, isProviderId,
  parseIntegrationKeys, verifySignedPayload,
} from "../services/integration-contract.js";

const UUID = z.string().uuid();
const PROVIDER_REF = z.string().min(1).max(96).regex(/^[A-Za-z0-9_.:-]+$/);
const eventSchema = z.object({
  eventId: PROVIDER_REF,
  bookingRef: PROVIDER_REF,
  eventType: z.enum(["booking_requested", "booking_changed", "booking_cancelled"]),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
  serviceRef: PROVIDER_REF.optional(),
  staffRef: PROVIDER_REF.optional(),
  /** Local IDs are optional; mapping needs explicit approval by the merchant's integration bridge. */
  localServiceId: UUID.optional(),
  localStaffId: UUID.optional(),
}).strict().superRefine((item, ctx) => {
  if (item.eventType === "booking_cancelled") {
    if (item.startAt || item.endAt) ctx.addIssue({ code: "custom", message: "Cancel events cannot contain a time window" });
  } else if (!item.startAt || !item.endAt || Date.parse(item.startAt) >= Date.parse(item.endAt)) {
    ctx.addIssue({ code: "custom", message: "A valid appointment time window is required" });
  }
});

async function readBodyLimited(body: ReadableStream<Uint8Array> | null, maxBytes = 64 * 1024): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw err.validation("Webhook payload too large"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts.map((p) => Buffer.from(p)), total);
}

/**
 * Generic HMAC bridge, NOT a native LINE/Meituan/other provider callback.
 * Requires merchant-controlled middleware to convert an authorized partner's events to this contract.
 * Receives only opaque references and time blocks, never customer contact details.
 */
export function integrationIngressRoutes(db: Database, config: AppConfig): Hono {
  const app = new Hono();
  const keys = parseIntegrationKeys(config.PARTNER_WEBHOOK_KEYS_JSON);
  app.post("/:storeId/:provider/events", async (c) => {
    const storeId = UUID.parse(c.req.param("storeId"));
    const provider = c.req.param("provider");
    if (!isProviderId(provider)) throw err.notFound("Unknown integration provider");
    const key = integrationKey(keys, storeId, provider);
    // Unknown key/provider does not reveal which stores are configured.
    if (!key) throw err.unauthorized("Integration not authorized");
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header("content-type") ?? "")) throw err.validation("Expected application/json");
    const announced = Number(c.req.header("content-length") ?? "0");
    if (!Number.isFinite(announced) || announced > 65536) throw err.validation("Webhook payload too large");
    const raw = await readBodyLimited(c.req.raw.body);
    if (!verifySignedPayload(key, c.req.header("X-Salon-Timestamp"), c.req.header("X-Salon-Signature"), raw)) {
      throw err.unauthorized("Invalid or expired integration signature");
    }
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(raw).toString("utf8")); }
    catch { throw err.validation("Invalid JSON"); }
    const event = eventSchema.parse(decoded);
    const startAt = event.startAt ? new Date(event.startAt) : null;
    const endAt = event.endAt ? new Date(event.endAt) : null;
    if (startAt && endAt && (
      endAt.getTime() - startAt.getTime() > 24 * 60 * 60_000 ||
      startAt.getTime() < Date.now() - 366 * 24 * 60 * 60_000 ||
      startAt.getTime() > Date.now() + 730 * 24 * 60 * 60_000
    )) throw err.validation("Appointment date outside accepted import window");
    const digest = eventDigest(raw);
    const result = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, storeId); // serialize conflict check with the normal booking writer
      const [exists] = await tx.select({ id: schema.integrationInbox.id, digest: schema.integrationInbox.payloadDigest })
        .from(schema.integrationInbox).where(and(eq(schema.integrationInbox.storeId, storeId),
          eq(schema.integrationInbox.provider, provider), eq(schema.integrationInbox.externalEventId, event.eventId))).limit(1);
      if (exists) {
        if (exists.digest !== digest) throw err.conflict("Same external event ID, different content");
        return { status: 200 as const, body: { id: exists.id, duplicate: true } };
      }
      if (event.localStaffId) {
        const [staff] = await tx.select({ id: schema.staff.id }).from(schema.staff)
          .where(and(eq(schema.staff.id, event.localStaffId), eq(schema.staff.storeId, storeId))).limit(1);
        if (!staff) throw err.validation("Invalid local staff mapping");
      }
      if (event.localServiceId) {
        const [service] = await tx.select({ id: schema.services.id }).from(schema.services)
          .where(and(eq(schema.services.id, event.localServiceId), eq(schema.services.storeId, storeId))).limit(1);
        if (!service) throw err.validation("Invalid local service mapping");
      }
      let state: "pending" | "needs_mapping" | "conflict" = "pending";
      if (event.eventType !== "booking_cancelled") {
        if (!event.localStaffId || !event.localServiceId) {
          state = "needs_mapping";
        } else {
          const [occupied] = await tx.select({ id: schema.appointments.id }).from(schema.appointments)
            .where(and(eq(schema.appointments.storeId, storeId), eq(schema.appointments.staffId, event.localStaffId),
              inArray(schema.appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
              lt(schema.appointments.startAt, endAt!), gt(schema.appointments.blockedEndAt, startAt!)))
            .limit(1);
          if (occupied) state = "conflict";
        }
      }
      const [inserted] = await tx.insert(schema.integrationInbox).values({
        storeId, provider, externalEventId: event.eventId,
        externalBookingRef: event.bookingRef, eventType: event.eventType, payloadDigest: digest,
        startAt, endAt, serviceRef: event.serviceRef ?? null, staffRef: event.staffRef ?? null,
        localStaffId: event.localStaffId ?? null, localServiceId: event.localServiceId ?? null,
        reviewState: state,
      }).returning({ id: schema.integrationInbox.id });
      return { status: 202 as const, body: { id: inserted!.id, duplicate: false, reviewState: state } };
    });
    return c.json(result.body, result.status);
  });
  return app;
}

function iso(d: Date | null): string | null { return d?.toISOString() ?? null; }
function safeRow(row: typeof schema.integrationInbox.$inferSelect) {
  // Never expose internal payload digests or webhook signing data.
  const { payloadDigest: _digest, ...visible } = row;
  return { ...visible, startAt: iso(row.startAt), endAt: iso(row.endAt),
    createdAt: iso(row.createdAt), reviewedAt: iso(row.reviewedAt) };
}
function calendarEscape(text: string): string { return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, "\\$&"); }
function calendarUtc(date: Date): string { return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }

export function adminIntegrationRoutes(db: Database, config: AppConfig): Hono {
  const app = new Hono();
  const keys = parseIntegrationKeys(config.PARTNER_WEBHOOK_KEYS_JSON);
  app.use("*", authMiddleware(db, config.JWT_SECRET, ["owner", "manager"], config.CORS_ORIGINS));
  app.get("/catalog", (c) => {
    const user = c.get("authUser") as AuthUser;
    return c.json(PROVIDERS.map((provider) => ({
      ...provider,
      bridgeConfigured: !!integrationKey(keys, user.storeId, provider.id),
      nativeConnected: false, // no provider OAuth token or contract was supplied
      bridgeProtocol: "salon-hmac-v1",
    })));
  });
  app.get("/inbox", async (c) => {
    const user = c.get("authUser") as AuthUser;
    const filter = z.enum(["all", "pending", "needs_mapping", "conflict", "linked", "ignored"])
      .default("all").parse(c.req.query("state"));
    const conditions = [eq(schema.integrationInbox.storeId, user.storeId)];
    if (filter !== "all") conditions.push(eq(schema.integrationInbox.reviewState, filter));
    const rows = await db.select().from(schema.integrationInbox).where(and(...conditions))
      .orderBy(desc(schema.integrationInbox.createdAt)).limit(100);
    return c.json(rows.map(safeRow));
  });
  app.post("/inbox/:id/resolve", async (c) => {
    const user = c.get("authUser") as AuthUser;
    const inboxId = UUID.parse(c.req.param("id"));
    const body = z.discriminatedUnion("resolution", [
      z.object({ resolution: z.literal("ignored") }).strict(),
      z.object({ resolution: z.literal("linked"), appointmentId: UUID }).strict(),
    ]).parse(await c.req.json());
    const row = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const [item] = await tx.select().from(schema.integrationInbox).where(and(
        eq(schema.integrationInbox.storeId, user.storeId), eq(schema.integrationInbox.id, inboxId))).limit(1);
      if (!item) throw err.notFound("Integration event not found");
      if (item.reviewState === "ignored" || item.reviewState === "linked") {
        throw err.conflict("This event has already been reviewed");
      }
      if (body.resolution === "linked") {
        const [appt] = await tx.select({ id: schema.appointments.id, startAt: schema.appointments.startAt })
          .from(schema.appointments).where(and(eq(schema.appointments.id, body.appointmentId),
            eq(schema.appointments.storeId, user.storeId))).limit(1);
        if (!appt) throw err.validation("Appointment does not belong to this store");
        if (item.startAt && Math.abs(item.startAt.getTime() - appt.startAt.getTime()) > 30 * 60_000) {
          throw err.conflict("Appointment time does not match external event; verify manually");
        }
      }
      const [updated] = await tx.update(schema.integrationInbox).set({
        reviewState: body.resolution, linkedAppointmentId: body.resolution === "linked" ? body.appointmentId : null,
        reviewedBy: user.userId, reviewedAt: new Date(),
      }).where(and(eq(schema.integrationInbox.storeId, user.storeId), eq(schema.integrationInbox.id, inboxId)))
        .returning();
      // Same transaction: review cannot commit without an audit trail.
      await tx.insert(schema.auditLogs).values({
        storeId: user.storeId, actorUserId: user.userId, action: "integration.inbox.review",
        entityType: "integration_inbox", entityId: inboxId,
        details: { provider: item.provider, resolution: body.resolution },
      });
      return updated!;
    });
    return c.json(safeRow(row));
  });
  const exportQuery = z.object({
    from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }),
  });
  async function exportRows(storeId: string, fromQuery: string | undefined, toQuery: string | undefined) {
    const period = exportQuery.parse({ from: fromQuery, to: toQuery });
    const from = new Date(period.from), to = new Date(period.to);
    if (to <= from || to.getTime() - from.getTime() > 31 * 86_400_000) {
      throw err.validation("Export must be a positive range of at most 31 days");
    }
    return db.select({ id: schema.appointments.id, bookingCode: schema.appointments.bookingCode,
      source: schema.appointments.source, status: schema.appointments.status,
      startAt: schema.appointments.startAt, endAt: schema.appointments.endAt, staffId: schema.appointments.staffId,
    }).from(schema.appointments).where(and(eq(schema.appointments.storeId, storeId),
      gte(schema.appointments.startAt, from), lt(schema.appointments.startAt, to)))
      .orderBy(schema.appointments.startAt).limit(5000);
  }
  app.get("/appointments.csv", async (c) => {
    const rows = await exportRows((c.get("authUser") as AuthUser).storeId, c.req.query("from"), c.req.query("to"));
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="salon-appointments.csv"');
    c.header("Cache-Control", "private, no-store");
    return c.body(bookingCsv(rows));
  });
  app.get("/appointments.ics", async (c) => {
    const rows = await exportRows((c.get("authUser") as AuthUser).storeId, c.req.query("from"), c.req.query("to"));
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Beauty Salon OS//Privacy-safe appointments//EN", "CALSCALE:GREGORIAN"];
    for (const r of rows) {
      lines.push("BEGIN:VEVENT", `UID:${r.id}@beauty-salon-os.local`, `DTSTAMP:${calendarUtc(new Date())}`,
        `DTSTART:${calendarUtc(r.startAt)}`, `DTEND:${calendarUtc(r.endAt)}`,
        `SUMMARY:${calendarEscape("Salon occupied slot")}`, `STATUS:${r.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
        "CLASS:PRIVATE", "END:VEVENT");
    }
    lines.push("END:VCALENDAR", "");
    c.header("Content-Type", "text/calendar; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="salon-appointments.ics"');
    c.header("Cache-Control", "private, no-store");
    return c.body(lines.join("\r\n"));
  });
  return app;
}
