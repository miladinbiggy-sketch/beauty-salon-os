import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@salon/database";
import { err, toIso, tokyoDateOf } from "@salon/shared";
import type { AppConfig } from "../config.js";
import { storeSettingsOf } from "../config.js";
import { authMiddleware, type AuthUser } from "../auth.js";
import { clientIp, RateLimiter } from "../ratelimit.js";
import { writeAudit } from "../audit.js";

/**
 * V14 waitlist （等候名单 / キャンセル待ち).
 *
 * A waitlist entry is a request to be contacted when a slot opens; it is NOT a
 * booking, holds no allocation and therefore can never double-book. Staff work
 * the list in FIFO order and mark entries notified/booked manually. Joining is
 * idempotent per (store, phone, date, service): a repeat join returns the
 * existing open entry instead of stacking duplicates.
 */

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OPEN_STATUSES = ["waiting", "notified"] as const;
const ALL_STATUSES = ["waiting", "notified", "booked", "expired", "cancelled"] as const;

const joinSchema = z.object({
  storeId: z.string().uuid(),
  name: z.string().min(1).max(100),
  phone: z.string().min(6).max(20),
  serviceId: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid().nullable().optional(),
  date: z.string().regex(DATE, "date must be YYYY-MM-DD"),
  earliestTime: z.string().regex(HHMM, "earliestTime must be HH:MM"),
  latestTime: z.string().regex(HHMM, "latestTime must be HH:MM"),
}).refine((b) => b.earliestTime < b.latestTime, { message: "earliestTime must be before latestTime" });

type WaitlistRow = typeof schema.waitlistEntries.$inferSelect;

function entryJson(row: WaitlistRow, names?: { serviceNameZh?: string | null; serviceNameJa?: string | null; staffName?: string | null }) {
  return {
    id: row.id,
    storeId: row.storeId,
    customerId: row.customerId,
    name: row.name,
    phone: row.phone,
    serviceId: row.serviceId,
    staffId: row.staffId,
    serviceNameZh: names?.serviceNameZh ?? null,
    serviceNameJa: names?.serviceNameJa ?? null,
    staffName: names?.staffName ?? null,
    date: row.desiredDate,
    earliestTime: row.earliestTime,
    latestTime: row.latestTime,
    status: row.status,
    notifiedAt: row.notifiedAt ? toIso(row.notifiedAt.getTime()) : null,
    createdAt: toIso(row.createdAt.getTime()),
  };
}

export function waitlistPublicRoutes(db: Database, config: AppConfig): Hono {
  const app = new Hono();
  const limiter = new RateLimiter(10, 60_000, { driver: config.RATE_LIMIT_DRIVER, redisUrl: config.REDIS_URL, namespace: "waitlist" });

  app.post("/waitlist", async (c) => {
    await limiter.check(clientIp(c.req.raw.headers, config.TRUST_PROXY));
    const body = joinSchema.parse(await c.req.json());
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, body.storeId));
    if (!store) throw err.notFound("Store not found");
    const settings = storeSettingsOf(store.settings);
    const today = tokyoDateOf(Date.now());
    const maxDate = tokyoDateOf(Date.now() + settings.bookingWindowDays * 24 * 60 * 60_000);
    if (body.date < today || body.date > maxDate) {
      throw err.validation("Date is outside the booking window");
    }
    if (body.serviceId) {
      const [svc] = await db.select({ id: schema.services.id }).from(schema.services)
        .where(and(eq(schema.services.id, body.serviceId), eq(schema.services.storeId, body.storeId)));
      if (!svc) throw err.validation("Service does not belong to this store");
    }
    if (body.staffId) {
      const [st] = await db.select({ id: schema.staff.id }).from(schema.staff)
        .where(and(eq(schema.staff.id, body.staffId), eq(schema.staff.storeId, body.storeId)));
      if (!st) throw err.validation("Staff does not belong to this store");
    }
    // Idempotent join: an open entry for the same phone/date/service is returned as-is.
    const open = await db.select().from(schema.waitlistEntries).where(and(
      eq(schema.waitlistEntries.storeId, body.storeId),
      eq(schema.waitlistEntries.phone, body.phone),
      eq(schema.waitlistEntries.desiredDate, body.date),
      body.serviceId ? eq(schema.waitlistEntries.serviceId, body.serviceId) : undefined,
      inArray(schema.waitlistEntries.status, [...OPEN_STATUSES]),
    )).orderBy(asc(schema.waitlistEntries.createdAt));
    const existing = body.serviceId ? open[0] : open.find((r) => r.serviceId === null);
    if (existing) return c.json({ ...entryJson(existing), duplicate: true }, 200);
    // Link to the store's customer record when the phone is already known.
    const [customer] = await db.select({ id: schema.customers.id }).from(schema.customers)
      .where(and(eq(schema.customers.storeId, body.storeId), eq(schema.customers.phone, body.phone)));
    const [row] = await db.insert(schema.waitlistEntries).values({
      storeId: body.storeId,
      customerId: customer?.id ?? null,
      name: body.name,
      phone: body.phone,
      serviceId: body.serviceId ?? null,
      staffId: body.staffId ?? null,
      desiredDate: body.date,
      earliestTime: body.earliestTime,
      latestTime: body.latestTime,
    }).returning();
    if (!row) throw err.internal("Waitlist entry could not be saved");
    return c.json({ ...entryJson(row), duplicate: false }, 201);
  });

  return app;
}

export function waitlistAdminRoutes(db: Database, config: AppConfig): Hono {
  const app = new Hono();
  // Scope the manager-only gate to waitlist paths only: this sub-app is mounted
  // at /admin alongside adminRoutes, and a "*" middleware here would also run
  // for unrelated /admin/* requests falling through to the other sub-app.
  const managerOnly = authMiddleware(db, config.JWT_SECRET, ["owner", "manager"], config.CORS_ORIGINS);
  app.use("/waitlist", managerOnly);
  app.use("/waitlist/*", managerOnly);

  async function withNames(user: AuthUser, rows: WaitlistRow[]) {
    const serviceIds = [...new Set(rows.map((r) => r.serviceId).filter((x): x is string => !!x))];
    const staffIds = [...new Set(rows.map((r) => r.staffId).filter((x): x is string => !!x))];
    const services = serviceIds.length
      ? await db.select({ id: schema.services.id, nameZh: schema.services.nameZh, nameJa: schema.services.nameJa })
          .from(schema.services).where(and(eq(schema.services.storeId, user.storeId), inArray(schema.services.id, serviceIds)))
      : [];
    const staff = staffIds.length
      ? await db.select({ id: schema.staff.id, name: schema.staff.name })
          .from(schema.staff).where(and(eq(schema.staff.storeId, user.storeId), inArray(schema.staff.id, staffIds)))
      : [];
    const svcById = new Map(services.map((s) => [s.id, s]));
    const staffById = new Map(staff.map((s) => [s.id, s]));
    return rows.map((r) => entryJson(r, {
      serviceNameZh: r.serviceId ? svcById.get(r.serviceId)?.nameZh : null,
      serviceNameJa: r.serviceId ? svcById.get(r.serviceId)?.nameJa : null,
      staffName: r.staffId ? staffById.get(r.staffId)?.name : null,
    }));
  }

  app.get("/waitlist", async (c) => {
    const user = c.get("authUser") as AuthUser;
    const date = c.req.query("date") ?? tokyoDateOf(Date.now());
    if (!DATE.test(date)) throw err.validation("date must be YYYY-MM-DD");
    const status = c.req.query("status");
    const conditions = [
      eq(schema.waitlistEntries.storeId, user.storeId),
      eq(schema.waitlistEntries.desiredDate, date),
    ];
    if (status) {
      if (!(ALL_STATUSES as readonly string[]).includes(status)) throw err.validation("Unknown waitlist status");
      conditions.push(eq(schema.waitlistEntries.status, status));
    }
    const rows = await db.select().from(schema.waitlistEntries)
      .where(and(...conditions)).orderBy(asc(schema.waitlistEntries.createdAt));
    return c.json(await withNames(user, rows));
  });

  // Candidates for backfilling a freed slot: open entries for the date whose
  // desired window covers the freed start time, FIFO. Filters are optional.
  app.get("/waitlist/candidates", async (c) => {
    const user = c.get("authUser") as AuthUser;
    const date = c.req.query("date");
    if (!date || !DATE.test(date)) throw err.validation("date (YYYY-MM-DD) is required");
    const time = c.req.query("time");
    if (time && !HHMM.test(time)) throw err.validation("time must be HH:MM");
    const serviceId = c.req.query("serviceId");
    const staffId = c.req.query("staffId");
    const rows = await db.select().from(schema.waitlistEntries).where(and(
      eq(schema.waitlistEntries.storeId, user.storeId),
      eq(schema.waitlistEntries.desiredDate, date),
      inArray(schema.waitlistEntries.status, [...OPEN_STATUSES]),
    )).orderBy(asc(schema.waitlistEntries.createdAt));
    const matched = rows.filter((r) =>
      (!serviceId || r.serviceId === null || r.serviceId === serviceId) &&
      (!staffId || r.staffId === null || r.staffId === staffId) &&
      (!time || (r.earliestTime <= time && time <= r.latestTime)),
    );
    return c.json(await withNames(user, matched));
  });

  app.post("/waitlist/:id/notify", async (c) => {
    const user = c.get("authUser") as AuthUser;
    const id = z.string().uuid().parse(c.req.param("id"));
    const [row] = await db.select().from(schema.waitlistEntries)
      .where(and(eq(schema.waitlistEntries.id, id), eq(schema.waitlistEntries.storeId, user.storeId)));
    if (!row) throw err.notFound("Waitlist entry not found");
    if (row.status === "notified") return c.json(entryJson(row));
    if (row.status !== "waiting") throw err.conflict("Only a waiting entry can be marked notified");
    const [updated] = await db.update(schema.waitlistEntries)
      .set({ status: "notified", notifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.waitlistEntries.id, id)).returning();
    await writeAudit(db, {
      storeId: user.storeId, actorUserId: user.userId, action: "waitlist.notify",
      entityType: "waitlist_entry", entityId: id, ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
      details: { date: row.desiredDate },
    });
    return c.json(entryJson(updated!));
  });

  app.post("/waitlist/:id/status", async (c) => {
    const user = c.get("authUser") as AuthUser;
    const id = z.string().uuid().parse(c.req.param("id"));
    const body = z.object({ status: z.enum(["booked", "expired", "cancelled", "waiting"]) }).parse(await c.req.json());
    const [row] = await db.select().from(schema.waitlistEntries)
      .where(and(eq(schema.waitlistEntries.id, id), eq(schema.waitlistEntries.storeId, user.storeId)));
    if (!row) throw err.notFound("Waitlist entry not found");
    if (!(OPEN_STATUSES as readonly string[]).includes(row.status)) {
      throw err.conflict("This waitlist entry is already closed");
    }
    if (body.status === "waiting" && row.status === "waiting") return c.json(entryJson(row));
    const [updated] = await db.update(schema.waitlistEntries)
      .set({
        status: body.status,
        notifiedAt: body.status === "waiting" ? null : row.notifiedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.waitlistEntries.id, id)).returning();
    await writeAudit(db, {
      storeId: user.storeId, actorUserId: user.userId, action: "waitlist.status",
      entityType: "waitlist_entry", entityId: id, ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
      details: { from: row.status, to: body.status },
    });
    return c.json(entryJson(updated!));
  });

  return app;
}
