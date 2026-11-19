import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { hashPassword, schema, type Database } from "@salon/database";
import { recommendAvailability } from "@salon/scheduler";
import { buildContextForDate } from "../context-builder.js";
import { resolveSelections, patchContext } from "../services/booking.js";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  addDaysTokyo,
  err,
  fromIso,
  toIso,
  tokyoDayRangeMs,
  tokyoDateOf,
  todayTokyo,
  weekdayOfTokyoDate,
  type AppointmentStatus,
  type UserRole,
} from "@salon/shared";
import type { AppConfig } from "../config.js";
import { storeSettingsOf } from "../config.js";
import { authMiddleware, type AuthUser } from "../auth.js";
import { clientIp } from "../ratelimit.js";
import { writeAudit } from "../audit.js";
import {
  STATUS_TRANSITIONS,
  cancelBooking,
  createBooking,
  getAppointmentDto,
  rescheduleBooking,
  storeLock,
} from "../services/booking.js";
import { assertBlockedWindow, assertBusinessDate, assertShiftWindow } from "../services/schedule-guards.js";
import { requiresResourceReservationCheck, requiresStaffReservationCheck, requiresServiceReservationCheck, removedSkillIds } from "../services/master-data-guards.js";
import { validWeeklyHours, narrowsBusinessHours, type WeeklyHour } from "../services/store-hours-guards.js";
import type { Notifier } from "../queue.js";
import { cashLedgerLock, isValidBusinessDate, methodTotalsQuery, summarizeMethodTotals, type PgMethodTotals } from "../services/cash-close.js";
import { paymentFingerprint, paymentRetryDisposition } from "../services/payment-idempotency.js";

const MANAGER: UserRole[] = ["owner", "manager"];
const ALL: UserRole[] = ["owner", "manager", "staff"];

function actor(c: { get: (k: "authUser") => AuthUser }): AuthUser {
  return c.get("authUser");
}

function requireRole(user: AuthUser, roles: UserRole[]): void {
  if (!roles.includes(user.role)) throw err.forbidden("Role not allowed");
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm");

export function adminRoutes(db: Database, config: AppConfig, notifier: Notifier): Hono {
  const app = new Hono();
  app.use("*", authMiddleware(db, config.JWT_SECRET, undefined, config.CORS_ORIGINS));

  /** Runs inside the booking advisory lock: both public booking and master updates serialize. */
  async function futureStaffBooking(tx: Database, storeId: string, staffId: string, serviceIds?: string[]) {
    const filters = [eq(schema.appointments.storeId, storeId), eq(schema.appointments.staffId, staffId),
      inArray(schema.appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
      gt(schema.appointments.blockedEndAt, new Date())];
    if (serviceIds) {
      if (serviceIds.length === 0) return null;
      const [booking] = await tx.select({ appointmentId: schema.appointments.id })
        .from(schema.appointments)
        .innerJoin(schema.appointmentServices, eq(schema.appointmentServices.appointmentId, schema.appointments.id))
        .where(and(...filters, inArray(schema.appointmentServices.serviceId, serviceIds))).limit(1);
      return booking ?? null;
    }
    const [booking] = await tx.select({ appointmentId: schema.appointments.id })
      .from(schema.appointments).where(and(...filters)).limit(1);
    return booking ?? null;
  }

  async function futureResourceBooking(tx: Database, storeId: string, resourceId: string) {
    const [booking] = await tx.select({ appointmentId: schema.appointments.id })
      .from(schema.resourceAllocations)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.resourceAllocations.appointmentId))
      .where(and(eq(schema.appointments.storeId, storeId), eq(schema.resourceAllocations.resourceId, resourceId),
        eq(schema.resourceAllocations.active, true),
        inArray(schema.appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        gt(schema.resourceAllocations.endAt, new Date()))).limit(1);
    return booking ?? null;
  }

  /** The online booking transaction also obtains storeLock: validate-and-save is serializable per store. */
  async function saveWeeklyHours(tx: Database, storeId: string, hours: WeeklyHour[]): Promise<void> {
    // The request schema already validates exactly seven unique weekdays and ordered hours.
    const previous = await tx.select().from(schema.businessHours).where(eq(schema.businessHours.storeId, storeId));
    const old = new Map(previous.map(h => [h.weekday, h]));
    for (const h of hours) {
      if (!narrowsBusinessHours(old.get(h.weekday), h)) continue;
      // Japan local weekday and clock times are computed by PostgreSQL, not server OS timezone.
      // Only customer-facing service time matters; cleanup buffers may extend beyond closing.
      const [reserved] = await tx.select({ appointmentId: schema.appointments.id })
        .from(schema.appointments)
        .where(and(
          eq(schema.appointments.storeId, storeId),
          inArray(schema.appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
          gt(schema.appointments.endAt, new Date()),
          sql`EXTRACT(ISODOW FROM (${schema.appointments.startAt} AT TIME ZONE 'Asia/Tokyo')) = ${h.weekday}`,
          h.isClosed ? sql`true` : sql`(
            (${schema.appointments.startAt} AT TIME ZONE 'Asia/Tokyo')::time < ${h.openTime}::time
            OR (${schema.appointments.endAt} AT TIME ZONE 'Asia/Tokyo')::time > ${h.closeTime}::time
          )`,
        ))
        .limit(1);
      if (reserved) throw err.conflict("New opening hours conflict with an existing appointment. Reschedule it first", {
        appointmentId: reserved.appointmentId, weekday: h.weekday,
      });
    }
    for (const h of hours) {
      await tx.insert(schema.businessHours)
        .values({ storeId, weekday: h.weekday, openTime: h.openTime, closeTime: h.closeTime, isClosed: h.isClosed })
        .onConflictDoUpdate({
          target: [schema.businessHours.storeId, schema.businessHours.weekday],
          set: { openTime: h.openTime, closeTime: h.closeTime, isClosed: h.isClosed },
        });
    }
  }

  async function futureServiceBooking(tx: Database, storeId: string, serviceId: string) {
    const [booking] = await tx.select({ appointmentId: schema.appointments.id })
      .from(schema.appointments)
      .innerJoin(schema.appointmentServices, eq(schema.appointmentServices.appointmentId, schema.appointments.id))
      .where(and(eq(schema.appointments.storeId, storeId), eq(schema.appointmentServices.serviceId, serviceId),
        inArray(schema.appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        gt(schema.appointments.endAt, new Date()))).limit(1);
    return booking ?? null;
  }

  const weeklyHoursSchema = z.array(z.object({
    weekday: z.number().int().min(1).max(7),
    openTime: hhmm, closeTime: hhmm, isClosed: z.boolean(),
  })).length(7).refine(validWeeklyHours, "Seven unique weekdays with valid opening windows required");

  /* ---------------- 门店与设置 ---------------- */
  app.get("/store", async (c) => {
    const user = actor(c);
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, user.storeId));
    if (!store) throw err.notFound("Store not found");
    const hours = await db
      .select()
      .from(schema.businessHours)
      .where(eq(schema.businessHours.storeId, user.storeId))
      .orderBy(asc(schema.businessHours.weekday));
    return c.json({
      ...store,
      settings: storeSettingsOf(store.settings),
      businessHours: hours.map((h) => ({
        weekday: h.weekday,
        openTime: h.openTime.slice(0, 5),
        closeTime: h.closeTime.slice(0, 5),
        isClosed: h.isClosed,
      })),
      createdAt: toIso(store.createdAt.getTime()),
      updatedAt: toIso(store.updatedAt.getTime()),
    });
  });

  app.put("/store", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = z.object({
      name: z.string().min(1).max(100).optional(),
      nameJa: z.string().max(100).nullable().optional(),
      phone: z.string().max(30).nullable().optional(),
      address: z.string().max(300).nullable().optional(),
      settings: z.object({
        reminderOffsetsMinutes: z.array(z.number().int().min(0).max(60 * 24 * 7)).optional(),
        bookingWindowDays: z.number().int().min(1).max(3650).optional(),
        minLeadMinutes: z.number().int().min(0).max(60 * 24).optional(),
        freeCancelBeforeMinutes: z.number().int().min(0).max(60 * 24 * 7).optional(),
        slotStepMinutes: z.number().int().min(5).max(60).optional(),
        lineConfigured: z.boolean().optional(),
      }).optional(),
      // V11: front desk sends settings + hours together to prevent half-saved configuration.
      businessHours: weeklyHoursSchema.optional(),
    }).parse(await c.req.json());
    const mergedSettings = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const [store] = await tx.select().from(schema.stores).where(eq(schema.stores.id, user.storeId));
      if (!store) throw err.notFound("Store not found");
      if (body.businessHours) await saveWeeklyHours(tx, user.storeId, body.businessHours);
      const merged = { ...storeSettingsOf(store.settings), ...(body.settings ?? {}) };
      await tx.update(schema.stores).set({
        name: body.name ?? store.name,
        nameJa: body.nameJa !== undefined ? body.nameJa : store.nameJa,
        phone: body.phone !== undefined ? body.phone : store.phone,
        address: body.address !== undefined ? body.address : store.address,
        settings: merged, updatedAt: new Date(),
      }).where(eq(schema.stores.id, user.storeId));
      await tx.insert(schema.auditLogs).values({
        storeId: user.storeId, actorUserId: user.userId,
        action: "store.update", entityType: "store", entityId: user.storeId,
        ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
        details: { changedFields: Object.keys(body), newBusinessHours: body.businessHours },
      });
      return merged;
    });
    return c.json({ ok: true, settings: mergedSettings });
  });

  // Backwards-compatible endpoint: the same lock and reservation checks apply.
  app.put("/business-hours", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const { hours } = z.object({ hours: weeklyHoursSchema }).parse(await c.req.json());
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      await saveWeeklyHours(tx, user.storeId, hours);
      await tx.insert(schema.auditLogs).values({
        storeId: user.storeId, actorUserId: user.userId,
        action: "business_hours.update", entityType: "store", entityId: user.storeId,
        ip: clientIp(c.req.raw.headers, config.TRUST_PROXY), details: { newBusinessHours: hours },
      });
    });
    return c.json({ ok: true });
  });

  /* ---------------- 服务项目与附加项 ---------------- */
  const serviceSchema = z.object({
    category: z.enum(["nail", "lash", "beauty", "other"]),
    nameZh: z.string().min(1).max(100),
    nameJa: z.string().min(1).max(100),
    descriptionZh: z.string().max(500).nullable().optional(),
    descriptionJa: z.string().max(500).nullable().optional(),
    durationMinutes: z.number().int().min(5).max(600),
    bufferMinutes: z.number().int().min(0).max(120),
    priceJpy: z.number().int().min(0).max(10_000_000),
    resourceType: z.enum(["nail_table", "lash_bed", "beauty_bed", "chair", "room"]).nullable().optional(),
    color: z.string().max(20).optional(),
    sortOrder: z.number().int().optional(),
    active: z.boolean().optional(),
  });

  app.get("/services", async (c) => {
    const user = actor(c);
    const rows = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.storeId, user.storeId))
      .orderBy(asc(schema.services.sortOrder));
    const addons = await db.select().from(schema.serviceAddons);
    return c.json(
      rows.map((s) => ({
        ...s,
        addons: addons.filter((a) => a.serviceId === s.id),
        createdAt: toIso(s.createdAt.getTime()),
      })),
    );
  });

  app.post("/services", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = serviceSchema.parse(await c.req.json());
    const [row] = await db
      .insert(schema.services)
      .values({ ...body, storeId: user.storeId, resourceType: body.resourceType ?? null })
      .returning();
    await writeAudit(db, { storeId: user.storeId, actorUserId: user.userId, action: "service.create", entityType: "service", entityId: row!.id, ip: clientIp(c.req.raw.headers, config.TRUST_PROXY), details: body });
    return c.json(row, 201);
  });

  app.put("/services/:id", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = serviceSchema.partial().parse(await c.req.json());
    const id = c.req.param("id");
    const row = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const [existing] = await tx.select().from(schema.services)
        .where(and(eq(schema.services.id, id), eq(schema.services.storeId, user.storeId)));
      if (!existing) throw err.notFound("Service not found");
      if (requiresServiceReservationCheck(existing, body)) {
        const future = await futureServiceBooking(tx, user.storeId, id);
        if (future) throw err.conflict("Booked service cannot be disabled or moved to another equipment type. Rebook affected customers first", future);
      }
      const [updated] = await tx.update(schema.services).set(body)
        .where(and(eq(schema.services.id, id), eq(schema.services.storeId, user.storeId))).returning();
      await tx.insert(schema.auditLogs).values({ storeId: user.storeId, actorUserId: user.userId,
        action: "service.update", entityType: "service", entityId: id,
        ip: clientIp(c.req.raw.headers, config.TRUST_PROXY), details: { changedFields: Object.keys(body) } });
      return updated;
    });
    return c.json(row);
  });

  app.delete("/services/:id", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const id = c.req.param("id");
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const [existing] = await tx.select().from(schema.services)
        .where(and(eq(schema.services.id, id), eq(schema.services.storeId, user.storeId)));
      if (!existing) throw err.notFound("Service not found");
      if (requiresServiceReservationCheck(existing, { active: false })) {
        const future = await futureServiceBooking(tx, user.storeId, id);
        if (future) throw err.conflict("Booked service cannot be disabled. Rebook affected customers first", future);
      }
      await tx.update(schema.services).set({ active: false })
        .where(and(eq(schema.services.id, id), eq(schema.services.storeId, user.storeId)));
      await tx.insert(schema.auditLogs).values({ storeId: user.storeId, actorUserId: user.userId,
        action: "service.deactivate", entityType: "service", entityId: id,
        ip: clientIp(c.req.raw.headers, config.TRUST_PROXY), details: { previousActive: existing.active } });
    });
    return c.json({ ok: true });
  });

  const addonSchema = z.object({
    nameZh: z.string().min(1).max(100),
    nameJa: z.string().min(1).max(100),
    priceJpy: z.number().int().min(0).max(1_000_000),
    durationMinutes: z.number().int().min(0).max(300),
    active: z.boolean().optional(),
  });

  app.post("/services/:id/addons", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const [svc] = await db
      .select()
      .from(schema.services)
      .where(and(eq(schema.services.id, c.req.param("id")), eq(schema.services.storeId, user.storeId)));
    if (!svc) throw err.notFound("Service not found");
    const body = addonSchema.parse(await c.req.json());
    const [row] = await db.insert(schema.serviceAddons).values({ ...body, serviceId: svc.id }).returning();
    return c.json(row, 201);
  });

  async function ownedAddon(id: string, storeId: string) {
    const [addon] = await db.select({ id: schema.serviceAddons.id })
      .from(schema.serviceAddons)
      .innerJoin(schema.services, eq(schema.serviceAddons.serviceId, schema.services.id))
      .where(and(eq(schema.serviceAddons.id, id), eq(schema.services.storeId, storeId)));
    if (!addon) throw err.notFound("Addon not found");
    return addon;
  }

  app.put("/addons/:id", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = addonSchema.partial().parse(await c.req.json());
    await ownedAddon(c.req.param("id"), user.storeId);
    const [row] = await db
      .update(schema.serviceAddons)
      .set(body)
      .where(eq(schema.serviceAddons.id, c.req.param("id")))
      .returning();
    if (!row) throw err.notFound("Addon not found");
    return c.json(row);
  });

  app.delete("/addons/:id", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    await ownedAddon(c.req.param("id"), user.storeId);
    await db.update(schema.serviceAddons).set({ active: false }).where(eq(schema.serviceAddons.id, c.req.param("id")));
    return c.json({ ok: true });
  });

  /* ---------------- 员工与技能 ---------------- */
  const staffSchema = z.object({
    name: z.string().min(1).max(100),
    nameJa: z.string().max(100).nullable().optional(),
    color: z.string().max(20).optional(),
    sortOrder: z.number().int().optional(),
    active: z.boolean().optional(),
    skillServiceIds: z.array(z.string().uuid()).optional(),
  });

  async function validateSkillsForStore(storeId: string, skillServiceIds: string[], conn: Database = db) {
    if (skillServiceIds.length !== new Set(skillServiceIds).size) throw err.validation("Duplicate skill service ID");
    if (skillServiceIds.length === 0) return;
    const rows = await conn.select({ id: schema.services.id }).from(schema.services)
      .where(and(eq(schema.services.storeId, storeId), inArray(schema.services.id, skillServiceIds)));
    if (rows.length !== skillServiceIds.length) throw err.validation("Skill service belongs to another store or does not exist");
  }

  async function staffWithSkills(storeId: string) {
    const rows = await db
      .select()
      .from(schema.staff)
      .where(eq(schema.staff.storeId, storeId))
      .orderBy(asc(schema.staff.sortOrder));
    const skills = rows.length ? await db.select().from(schema.staffSkills)
      .where(inArray(schema.staffSkills.staffId, rows.map((r) => r.id))) : [];
    return rows.map((s) => ({
      ...s,
      skillServiceIds: skills.filter((k) => k.staffId === s.id).map((k) => k.serviceId),
      createdAt: toIso(s.createdAt.getTime()),
    }));
  }

  app.get("/staff", async (c) => {
    const user = actor(c);
    return c.json(await staffWithSkills(user.storeId));
  });

  app.post("/staff", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = staffSchema.parse(await c.req.json());
    await validateSkillsForStore(user.storeId, body.skillServiceIds ?? []);
    const [row] = await db
      .insert(schema.staff)
      .values({ name: body.name, nameJa: body.nameJa ?? null, color: body.color ?? "#3b82f6", sortOrder: body.sortOrder ?? 0, storeId: user.storeId })
      .returning();
    if (body.skillServiceIds?.length) {
      await db.insert(schema.staffSkills).values(body.skillServiceIds.map((serviceId) => ({ staffId: row!.id, serviceId })));
    }
    await writeAudit(db, { storeId: user.storeId, actorUserId: user.userId, action: "staff.create", entityType: "staff", entityId: row!.id, ip: clientIp(c.req.raw.headers, config.TRUST_PROXY), details: body });
    return c.json((await staffWithSkills(user.storeId)).find((s) => s.id === row!.id), 201);
  });

  app.put("/staff/:id", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = staffSchema.partial().parse(await c.req.json());
    const id = c.req.param("id");
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const [existing] = await tx.select().from(schema.staff)
        .where(and(eq(schema.staff.id, id), eq(schema.staff.storeId, user.storeId)));
      if (!existing) throw err.notFound("Staff not found");
      if (body.skillServiceIds !== undefined) {
        await validateSkillsForStore(user.storeId, body.skillServiceIds, tx);
      }
      if (requiresStaffReservationCheck(existing, body)) {
        const future = await futureStaffBooking(tx, user.storeId, id);
        if (future) throw err.conflict("Staff has an active or future appointment. Reassign or cancel it before deactivation", future);
      }
      if (body.skillServiceIds !== undefined) {
        const current = await tx.select({ serviceId: schema.staffSkills.serviceId })
          .from(schema.staffSkills).where(eq(schema.staffSkills.staffId, id));
        const removed = removedSkillIds(current.map(x => x.serviceId), body.skillServiceIds);
        const future = await futureStaffBooking(tx, user.storeId, id, removed);
        if (future) throw err.conflict("Existing booked service requires the skill being removed. Reassign the appointment first", future);
      }
      // Only write fields the caller actually sent; a skills-only update must
      // not hand Drizzle an all-undefined set (it throws "No values to set").
      const staffPatch: { name?: string; nameJa?: string | null; color?: string; sortOrder?: number; active?: boolean } = {};
      if (body.name !== undefined) staffPatch.name = body.name;
      if (body.nameJa !== undefined) staffPatch.nameJa = body.nameJa;
      if (body.color !== undefined) staffPatch.color = body.color;
      if (body.sortOrder !== undefined) staffPatch.sortOrder = body.sortOrder;
      if (body.active !== undefined) staffPatch.active = body.active;
      if (Object.keys(staffPatch).length) {
        await tx.update(schema.staff).set(staffPatch)
          .where(and(eq(schema.staff.id, id), eq(schema.staff.storeId, user.storeId)));
      }
      if (body.skillServiceIds !== undefined) {
        await tx.delete(schema.staffSkills).where(eq(schema.staffSkills.staffId, id));
        if (body.skillServiceIds.length) {
          await tx.insert(schema.staffSkills).values(body.skillServiceIds.map(serviceId => ({ staffId: id, serviceId })));
        }
      }
      await tx.insert(schema.auditLogs).values({ storeId: user.storeId, actorUserId: user.userId,
        action: "staff.update", entityType: "staff", entityId: id,
        details: { changedFields: Object.keys(body), active: body.active ?? existing.active,
          skillServiceIds: body.skillServiceIds },
      });
    });
    return c.json((await staffWithSkills(user.storeId)).find(s => s.id === id));
  });

  app.delete("/staff/:id", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const id = c.req.param("id");
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const [existing] = await tx.select({ id: schema.staff.id, active: schema.staff.active })
        .from(schema.staff).where(and(eq(schema.staff.id, id), eq(schema.staff.storeId, user.storeId)));
      if (!existing) throw err.notFound("Staff not found");
      if (existing.active) {
        const future = await futureStaffBooking(tx, user.storeId, id);
        if (future) throw err.conflict("Staff has an active or future appointment. Reassign or cancel it before deactivation", future);
      }
      await tx.update(schema.staff).set({ active: false })
        .where(and(eq(schema.staff.id, id), eq(schema.staff.storeId, user.storeId)));
      await tx.insert(schema.auditLogs).values({ storeId: user.storeId, actorUserId: user.userId,
        action: "staff.deactivate", entityType: "staff", entityId: id, details: { active: false },
      });
    });
    return c.json({ ok: true });
  });

  /* ---------------- 排班与请假 ---------------- */
  const breakSchema = z.object({ startTime: hhmm, endTime: hhmm });

  app.get("/shifts", async (c) => {
    const user = actor(c);
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) throw err.validation("from and to (YYYY-MM-DD) are required");
    const rows = await db
      .select()
      .from(schema.shifts)
      .where(and(eq(schema.shifts.storeId, user.storeId), gte(schema.shifts.date, from), lt(schema.shifts.date, to)))
      .orderBy(asc(schema.shifts.date));
    const breaks = rows.length
      ? await db.select().from(schema.shiftBreaks).where(inArray(schema.shiftBreaks.shiftId, rows.map((r) => r.id)))
      : [];
    return c.json(
      rows.map((s) => ({
        ...s,
        startTime: s.startTime.slice(0, 5),
        endTime: s.endTime.slice(0, 5),
        breaks: breaks
          .filter((b) => b.shiftId === s.id)
          .map((b) => ({ startTime: b.startTime.slice(0, 5), endTime: b.endTime.slice(0, 5) })),
        createdAt: toIso(s.createdAt.getTime()),
      })),
    );
  });

  const shiftSchema = z.object({
    staffId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: hhmm,
    endTime: hhmm,
    breaks: z.array(breakSchema).max(4).optional(),
  });

  app.post("/shifts", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = shiftSchema.parse(await c.req.json());
    try {
      assertBusinessDate(body.date);
      assertShiftWindow(body.startTime, body.endTime, body.breaks);
    } catch (e) { throw err.validation((e as Error).message); }
    const row = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const [staffRow] = await tx.select({ id: schema.staff.id }).from(schema.staff)
        .where(and(eq(schema.staff.id, body.staffId), eq(schema.staff.storeId, user.storeId), eq(schema.staff.active, true)));
      if (!staffRow) throw err.notFound("Active staff not found");
      const [duplicate] = await tx.select({ id: schema.shifts.id }).from(schema.shifts)
        .where(and(eq(schema.shifts.staffId, body.staffId), eq(schema.shifts.date, body.date))).limit(1);
      if (duplicate) throw err.conflict("This staff already has a shift on this date");
      const [created] = await tx.insert(schema.shifts)
        .values({ storeId: user.storeId, staffId: body.staffId, date: body.date, startTime: body.startTime, endTime: body.endTime })
        .returning();
      if (!created) throw err.internal("Shift creation failed");
      if (body.breaks?.length) {
        await tx.insert(schema.shiftBreaks).values(body.breaks.map((b) => ({ shiftId: created.id, ...b })));
      }
      await tx.insert(schema.auditLogs).values({ storeId: user.storeId, actorUserId: user.userId, action: "shift.create", entityType: "shift", entityId: created.id,
        details: { staffId: body.staffId, date: body.date, startTime: body.startTime, endTime: body.endTime, breakCount: body.breaks?.length ?? 0 } });
      return created;
    });
    return c.json(row, 201);
  });

  app.delete("/shifts/:id", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const [shift] = await tx.select().from(schema.shifts)
        .where(and(eq(schema.shifts.id, c.req.param("id")), eq(schema.shifts.storeId, user.storeId)));
      if (!shift) throw err.notFound("Shift not found");
      const { startMs, endMs } = tokyoDayRangeMs(shift.date);
      const [reserved] = await tx.select({ appointmentId: schema.appointments.id })
        .from(schema.resourceAllocations)
        .innerJoin(schema.appointments, eq(schema.resourceAllocations.appointmentId, schema.appointments.id))
        .where(and(eq(schema.appointments.storeId, user.storeId), eq(schema.resourceAllocations.active, true),
          inArray(schema.appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
          eq(schema.resourceAllocations.staffId, shift.staffId),
          lt(schema.resourceAllocations.startAt, new Date(endMs)), gt(schema.resourceAllocations.endAt, new Date(startMs))))
        .limit(1);
      if (reserved) throw err.conflict("Shift has active appointments; reschedule or cancel them first", { appointmentId: reserved.appointmentId });
      await tx.delete(schema.shifts).where(eq(schema.shifts.id, shift.id));
      await tx.insert(schema.auditLogs).values({ storeId: user.storeId, actorUserId: user.userId, action: "shift.delete", entityType: "shift", entityId: shift.id,
        details: { staffId: shift.staffId, date: shift.date } });
    });
    return c.json({ ok: true });
  });

  app.post("/shifts/generate", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = z
      .object({
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        weeks: z.number().int().min(1).max(12),
        items: z
          .array(
            z.object({
              staffId: z.string().uuid(),
              weekday: z.number().int().min(1).max(7),
              startTime: hhmm,
              endTime: hhmm,
              breaks: z.array(breakSchema).max(4).optional(),
            }),
          )
          .min(1).max(40),
      })
      .parse(await c.req.json());
    try {
      assertBusinessDate(body.fromDate);
      for (const item of body.items) assertShiftWindow(item.startTime, item.endTime, item.breaks);
    } catch (e) { throw err.validation((e as Error).message); }
    const unique = new Set(body.items.map((item) => `${item.staffId}:${item.weekday}`));
    if (unique.size !== body.items.length) throw err.validation("Duplicate staff and weekday in generated shifts");
    const staffIds = [...new Set(body.items.map((i) => i.staffId))];
    const result = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const owned = await tx.select({ id: schema.staff.id }).from(schema.staff)
        .where(and(eq(schema.staff.storeId, user.storeId), eq(schema.staff.active, true), inArray(schema.staff.id, staffIds)));
      if (owned.length !== staffIds.length) throw err.validation("Unknown, inactive or foreign-store staff in generated shifts");
      let created = 0;
      let skipped = 0;
      const byDay = new Map<number, typeof body.items>();
      for (const item of body.items) byDay.set(item.weekday, [...(byDay.get(item.weekday) ?? []), item]);
      for (let d = 0; d < body.weeks * 7; d++) {
        const date = addDaysTokyo(body.fromDate, d);
        const weekday = weekdayOfTokyoDate(date);
        for (const item of byDay.get(weekday) ?? []) {
          const [exists] = await tx.select({ id: schema.shifts.id }).from(schema.shifts)
            .where(and(eq(schema.shifts.staffId, item.staffId), eq(schema.shifts.date, date))).limit(1);
          if (exists) { skipped++; continue; }
          const [row] = await tx.insert(schema.shifts)
            .values({ storeId: user.storeId, staffId: item.staffId, date, startTime: item.startTime, endTime: item.endTime })
            .returning();
          if (!row) throw err.internal("Generated shift creation failed");
          if (item.breaks?.length) {
            await tx.insert(schema.shiftBreaks).values(item.breaks.map((b) => ({ shiftId: row.id, ...b })));
          }
          created++;
        }
      }
      await tx.insert(schema.auditLogs).values({ storeId: user.storeId, actorUserId: user.userId, action: "shift.generate", entityType: "shift", details: {
        fromDate: body.fromDate, weeks: body.weeks, created, skipped,
      } });
      return { created, skipped };
    });
    return c.json(result);
  });

  app.get("/blocked-times", async (c) => {
    const user = actor(c);
    // Leave and sick-leave reasons may contain sensitive personnel data.
    requireRole(user, MANAGER);
    const rows = await db
      .select()
      .from(schema.blockedTimes)
      .where(eq(schema.blockedTimes.storeId, user.storeId))
      .orderBy(desc(schema.blockedTimes.startAt))
      .limit(200);
    return c.json(
      rows.map((b) => ({ ...b, startAt: toIso(b.startAt.getTime()), endAt: toIso(b.endAt.getTime()), createdAt: toIso(b.createdAt.getTime()) })),
    );
  });

  app.post("/blocked-times", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = z
      .object({
        staffId: z.string().uuid().nullable().optional(),
        resourceId: z.string().uuid().nullable().optional(),
        type: z.enum(["leave", "sick", "training", "maintenance", "other"]),
        startAt: z.string().datetime(),
        endAt: z.string().datetime(),
        reason: z.string().max(200).optional(),
      })
      .parse(await c.req.json());
    if (!body.staffId && !body.resourceId) throw err.validation("staffId or resourceId is required");
    const startMs = fromIso(body.startAt);
    const endMs = fromIso(body.endAt);
    try { assertBlockedWindow(startMs, endMs); }
    catch (e) { throw err.validation((e as Error).message); }
    const row = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      // Match create/reschedule/cancel's store advisory lock: no booking can slip between
      // the overlap check and inserting a leave or equipment-maintenance block.
      await storeLock(tx, user.storeId);
      if (body.staffId) {
        const [own] = await tx.select({ id: schema.staff.id }).from(schema.staff)
          .where(and(eq(schema.staff.id, body.staffId), eq(schema.staff.storeId, user.storeId)));
        if (!own) throw err.validation("Staff does not belong to this store");
      }
      if (body.resourceId) {
        const [own] = await tx.select({ id: schema.resources.id }).from(schema.resources)
          .where(and(eq(schema.resources.id, body.resourceId), eq(schema.resources.storeId, user.storeId)));
        if (!own) throw err.validation("Resource does not belong to this store");
      }
      const targets = [
        ...(body.staffId ? [eq(schema.resourceAllocations.staffId, body.staffId)] : []),
        ...(body.resourceId ? [eq(schema.resourceAllocations.resourceId, body.resourceId)] : []),
      ];
      const [reserved] = await tx.select({ appointmentId: schema.appointments.id })
        .from(schema.resourceAllocations)
        .innerJoin(schema.appointments, eq(schema.resourceAllocations.appointmentId, schema.appointments.id))
        .where(and(eq(schema.appointments.storeId, user.storeId), eq(schema.resourceAllocations.active, true),
          inArray(schema.appointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
          lt(schema.resourceAllocations.startAt, new Date(endMs)), gt(schema.resourceAllocations.endAt, new Date(startMs)),
          or(...targets)))
        .limit(1);
      if (reserved) throw err.conflict("Existing appointment overlaps this leave or maintenance period; reschedule it first", { appointmentId: reserved.appointmentId });
      const blockTargets = [
        ...(body.staffId ? [eq(schema.blockedTimes.staffId, body.staffId)] : []),
        ...(body.resourceId ? [eq(schema.blockedTimes.resourceId, body.resourceId)] : []),
      ];
      const [duplicate] = await tx.select({ id: schema.blockedTimes.id })
        .from(schema.blockedTimes)
        .where(and(eq(schema.blockedTimes.storeId, user.storeId),
          lt(schema.blockedTimes.startAt, new Date(endMs)), gt(schema.blockedTimes.endAt, new Date(startMs)), or(...blockTargets)))
        .limit(1);
      if (duplicate) throw err.conflict("An overlapping leave or maintenance block already exists", { blockId: duplicate.id });
      const [created] = await tx.insert(schema.blockedTimes).values({
        storeId: user.storeId,
        staffId: body.staffId ?? null,
        resourceId: body.resourceId ?? null,
        type: body.type,
        startAt: new Date(startMs),
        endAt: new Date(endMs),
        reason: body.reason ?? null,
      }).returning();
      if (!created) throw err.internal("Failed to create blocked time");
      // Staff medical/leave reasons are sensitive: keep only safe metadata in audit.
      await tx.insert(schema.auditLogs).values({ storeId: user.storeId, actorUserId: user.userId,
        action: "blocked_time.create", entityType: "blocked_time", entityId: created.id,
        details: { staffId: body.staffId ?? null, resourceId: body.resourceId ?? null, type: body.type, startAt: body.startAt, endAt: body.endAt } });
      return created;
    });
    return c.json({ ...row, startAt: toIso(startMs), endAt: toIso(endMs) }, 201);
  });

  app.delete("/blocked-times/:id", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const [block] = await tx.delete(schema.blockedTimes)
        .where(and(eq(schema.blockedTimes.id, c.req.param("id")), eq(schema.blockedTimes.storeId, user.storeId)))
        .returning({ id: schema.blockedTimes.id, staffId: schema.blockedTimes.staffId, resourceId: schema.blockedTimes.resourceId });
      if (!block) throw err.notFound("Blocked time not found");
      await tx.insert(schema.auditLogs).values({ storeId: user.storeId, actorUserId: user.userId,
        action: "blocked_time.delete", entityType: "blocked_time", entityId: block.id,
        details: { staffId: block.staffId, resourceId: block.resourceId } });
    });
    return c.json({ ok: true });
  });

  /* ---------------- 工位 ---------------- */
  const resourceSchema = z.object({
    type: z.enum(["nail_table", "lash_bed", "beauty_bed", "chair", "room"]),
    name: z.string().min(1).max(50),
    active: z.boolean().optional(),
  });

  app.get("/resources", async (c) => {
    const user = actor(c);
    const rows = await db
      .select()
      .from(schema.resources)
      .where(eq(schema.resources.storeId, user.storeId))
      .orderBy(asc(schema.resources.name));
    return c.json(rows.map((r) => ({ ...r, createdAt: toIso(r.createdAt.getTime()) })));
  });

  app.post("/resources", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = resourceSchema.parse(await c.req.json());
    const [row] = await db.insert(schema.resources).values({ ...body, storeId: user.storeId }).returning();
    return c.json(row, 201);
  });

  app.put("/resources/:id", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = resourceSchema.partial().parse(await c.req.json());
    const id = c.req.param("id");
    const row = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const [existing] = await tx.select().from(schema.resources)
        .where(and(eq(schema.resources.id, id), eq(schema.resources.storeId, user.storeId)));
      if (!existing) throw err.notFound("Resource not found");
      if (requiresResourceReservationCheck(existing, body)) {
        const future = await futureResourceBooking(tx, user.storeId, id);
        if (future) throw err.conflict("Booked equipment cannot be deactivated or changed to another type. Reassign appointments first", future);
      }
      const [updated] = await tx.update(schema.resources).set(body)
        .where(and(eq(schema.resources.id, id), eq(schema.resources.storeId, user.storeId))).returning();
      await tx.insert(schema.auditLogs).values({ storeId: user.storeId, actorUserId: user.userId,
        action: "resource.update", entityType: "resource", entityId: id,
        details: { changedFields: Object.keys(body), newType: updated?.type, newActive: updated?.active },
      });
      return updated;
    });
    return c.json(row);
  });

  app.delete("/resources/:id", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const id = c.req.param("id");
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      await storeLock(tx, user.storeId);
      const [existing] = await tx.select({ id: schema.resources.id, active: schema.resources.active })
        .from(schema.resources).where(and(eq(schema.resources.id, id), eq(schema.resources.storeId, user.storeId)));
      if (!existing) throw err.notFound("Resource not found");
      if (existing.active) {
        const future = await futureResourceBooking(tx, user.storeId, id);
        if (future) throw err.conflict("Booked equipment cannot be deactivated. Reassign appointments first", future);
      }
      await tx.update(schema.resources).set({ active: false })
        .where(and(eq(schema.resources.id, id), eq(schema.resources.storeId, user.storeId)));
      await tx.insert(schema.auditLogs).values({ storeId: user.storeId, actorUserId: user.userId,
        action: "resource.deactivate", entityType: "resource", entityId: id, details: { active: false },
      });
    });
    return c.json({ ok: true });
  });

  /* ---------------- 客户档案 ---------------- */
  async function customerStats(storeId: string, customerId: string) {
    const visits = await db
      .select({ id: schema.appointments.id, total: schema.appointments.totalPriceJpy })
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.storeId, storeId),
          eq(schema.appointments.customerId, customerId),
          eq(schema.appointments.status, "completed"),
        ),
      );
    const [spent] = await db
      .select({ sum: sql<number>`COALESCE(SUM(${schema.payments.amountJpy}), 0)::int` })
      .from(schema.payments)
      .where(eq(schema.payments.customerId, customerId));
    return { visitCount: visits.length, totalSpentJpy: spent?.sum ?? 0 };
  }

  app.get("/customers", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER); // 技师只能看与自己相关的单个客户（见下方详情接口）
    const q = c.req.query("q")?.trim();
    const conds = [eq(schema.customers.storeId, user.storeId)];
    if (q) conds.push(or(ilike(schema.customers.name, `%${q}%`), ilike(schema.customers.phone, `%${q}%`))!);
    const rows = await db
      .select()
      .from(schema.customers)
      .where(and(...conds))
      .orderBy(desc(schema.customers.updatedAt))
      .limit(200);
    const out = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        ...(await customerStats(user.storeId, r.id)),
        createdAt: toIso(r.createdAt.getTime()),
        updatedAt: toIso(r.updatedAt.getTime()),
      })),
    );
    return c.json(out);
  });

  app.get("/customers/:id", async (c) => {
    const user = actor(c);
    const id = c.req.param("id");
    const [row] = await db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.id, id), eq(schema.customers.storeId, user.storeId)));
    if (!row) throw err.notFound("Customer not found");
    if (user.role === "staff") {
      // 技师仅能查看与自己有预约关系的客户（被授权的客户信息）
      if (!user.staffId) throw err.forbidden("No staff profile linked");
      const [rel] = await db
        .select({ id: schema.appointments.id })
        .from(schema.appointments)
        .where(and(eq(schema.appointments.customerId, id), eq(schema.appointments.staffId, user.staffId)))
        .limit(1);
      if (!rel) throw err.forbidden("Customer is not assigned to you");
    }
    const history = await db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.customerId, id))
      .orderBy(desc(schema.appointments.startAt))
      .limit(50);
    return c.json({
      ...row,
      ...(await customerStats(user.storeId, id)),
      history: history.map((h) => ({
        id: h.id,
        status: h.status,
        staffId: h.staffId,
        startAt: toIso(h.startAt.getTime()),
        endAt: toIso(h.endAt.getTime()),
        totalPriceJpy: h.totalPriceJpy,
        bookingCode: h.bookingCode,
      })),
      createdAt: toIso(row.createdAt.getTime()),
      updatedAt: toIso(row.updatedAt.getTime()),
    });
  });

  /* ---------------- V2 电子カルテ：独立存储、最小授权、追加不可覆盖 ---------------- */
  async function authorizeCareCustomer(user: AuthUser, customerId: string) {
    const [customer] = await db.select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.id, customerId), eq(schema.customers.storeId, user.storeId)));
    if (!customer) throw err.notFound("Customer not found");
    if (user.role === "staff") {
      if (!user.staffId) throw err.forbidden("No staff profile linked");
      const [assigned] = await db.select({ id: schema.appointments.id }).from(schema.appointments)
        .where(and(eq(schema.appointments.storeId, user.storeId), eq(schema.appointments.customerId, customerId), eq(schema.appointments.staffId, user.staffId))).limit(1);
      if (!assigned) throw err.forbidden("Customer is not assigned to you");
    }
  }

  const careBase = {
    appointmentId: z.string().uuid().nullable().optional(),
    memo: z.string().max(1200).nullable().optional(),
  };
  const careSchema = z.discriminatedUnion("category", [
    z.object({ category: z.literal("nail"), ...careBase,
      details: z.object({ shape: z.string().max(80).optional(), design: z.string().max(200).optional(), color: z.string().max(100).optional(), products: z.string().max(200).optional() }).strict() }),
    z.object({ category: z.literal("lash"), ...careBase,
      details: z.object({ curl: z.string().max(40).optional(), lengthMm: z.number().min(1).max(30).optional(), density: z.string().max(50).optional(), style: z.string().max(200).optional() }).strict() }),
    z.object({ category: z.literal("beauty"), ...careBase,
      details: z.object({ treatment: z.string().max(200).optional(), products: z.string().max(200).optional(), aftercare: z.string().max(500).optional() }).strict() }),
  ]);

  app.get("/customers/:id/care-records", async (c) => {
    const user = actor(c);
    const customerId = z.string().uuid().parse(c.req.param("id"));
    await authorizeCareCustomer(user, customerId);
    const records = await db.select().from(schema.careRecords)
      .where(and(eq(schema.careRecords.storeId, user.storeId), eq(schema.careRecords.customerId, customerId)))
      .orderBy(desc(schema.careRecords.createdAt)).limit(100);
    await writeAudit(db, { storeId: user.storeId, actorUserId: user.userId, action: "care_records.view", entityType: "customer", entityId: customerId });
    return c.json(records.map((r) => ({ ...r, createdAt: toIso(r.createdAt.getTime()) })));
  });

  app.post("/customers/:id/care-records", async (c) => {
    const user = actor(c);
    const customerId = z.string().uuid().parse(c.req.param("id"));
    await authorizeCareCustomer(user, customerId);
    const body = careSchema.parse(await c.req.json());
    if (body.appointmentId) {
      const conditions = [eq(schema.appointments.id, body.appointmentId), eq(schema.appointments.storeId, user.storeId), eq(schema.appointments.customerId, customerId)];
      if (user.role === "staff") conditions.push(eq(schema.appointments.staffId, user.staffId!));
      const [appt] = await db.select({ id: schema.appointments.id }).from(schema.appointments).where(and(...conditions));
      if (!appt) throw err.validation("Appointment does not match this customer");
    }
    const [record] = await db.insert(schema.careRecords).values({
      storeId: user.storeId, customerId, appointmentId: body.appointmentId ?? null,
      category: body.category, details: body.details, memo: body.memo?.trim() || null,
      authoredBy: user.userId,
    }).returning();
    await writeAudit(db, { storeId: user.storeId, actorUserId: user.userId, action: "care_records.create", entityType: "care_record", entityId: record!.id, details: { category: body.category, customerId } });
    return c.json({ ...record, createdAt: toIso(record!.createdAt.getTime()) }, 201);
  });

  const customerSchema = z.object({
    name: z.string().min(1).max(100),
    nameKana: z.string().max(100).nullable().optional(),
    phone: z.string().min(6).max(20),
    email: z.string().email().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    tags: z.array(z.string().max(30)).optional(),
  });

  app.post("/customers", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = customerSchema.parse(await c.req.json());
    const [row] = await db
      .insert(schema.customers)
      .values({ ...body, storeId: user.storeId, email: body.email ?? null })
      .returning();
    return c.json(row, 201);
  });

  app.put("/customers/:id", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = customerSchema.partial().parse(await c.req.json());
    const [row] = await db
      .update(schema.customers)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(schema.customers.id, c.req.param("id")), eq(schema.customers.storeId, user.storeId)))
      .returning();
    if (!row) throw err.notFound("Customer not found");
    return c.json(row);
  });

  return finishAdminRoutes(app, db, config, notifier);
}

/* 第二部分：预约管理 / 收银 / 报表 / 通知 / 系统用户 */
function finishAdminRoutes(app: Hono, db: Database, config: AppConfig, notifier: Notifier): Hono {
  void config;

  /* ---------------- 专业智能排单建议：推荐不是占位，最终提交事务内重新校验 ---------------- */
  app.post("/schedule/recommendations", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      selections: z.array(z.object({ serviceId: z.string().uuid(), addonIds: z.array(z.string().uuid()).optional() })).min(1).max(8),
      staffId: z.string().uuid().optional(),
      strategy: z.enum(["earliest", "compact", "balanced"]).default("compact"),
      limit: z.number().int().min(1).max(20).default(8),
    }).parse(await c.req.json());
    const day = tokyoDayRangeMs(body.date);
    if (!Number.isFinite(day.startMs)) throw err.validation("Invalid date");
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, user.storeId));
    if (!store) throw err.notFound("Store not found");
    const { ctxPatch } = await resolveSelections(db, user.storeId, body.selections);
    const ctx = patchContext(await buildContextForDate(db, user.storeId, body.date), ctxPatch);
    const settings = storeSettingsOf(store.settings);
    const now = Date.now();
    const slots = recommendAvailability(ctx, {
      serviceIds: body.selections.map((x) => x.serviceId),
      staffId: body.staffId,
      strategy: body.strategy,
      limit: body.limit,
      windowStartMs: Math.max(ctx.storeOpenMs, now + settings.minLeadMinutes * 60_000),
      windowEndMs: ctx.storeCloseMs,
      stepMinutes: settings.slotStepMinutes,
    });
    return c.json({ strategy: body.strategy, generatedAt: toIso(now), slots: slots.map((x) => ({
      staffId: x.staffId, startAt: toIso(x.startMs), endAt: toIso(x.customerEndMs),
      totalPriceJpy: x.totalPriceJpy, score: x.score, reasons: x.reasons, metrics: x.metrics,
    })) });
  });

  /* ---------------- 预约管理 ---------------- */
  async function loadOwnedAppointment(c: { get: (k: "authUser") => AuthUser }, id: string) {
    const user = actor(c);
    const [appt] = await db
      .select()
      .from(schema.appointments)
      .where(and(eq(schema.appointments.id, id), eq(schema.appointments.storeId, user.storeId)));
    if (!appt) throw err.notFound("Appointment not found");
    if (user.role === "staff" && appt.staffId !== user.staffId) {
      throw err.forbidden("Appointment belongs to another staff member");
    }
    return { user, appt };
  }

  app.get("/appointments", async (c) => {
    const user = actor(c);
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) throw err.validation("from and to (ISO datetime) are required");
    const conds = [
      eq(schema.appointments.storeId, user.storeId),
      lt(schema.appointments.startAt, new Date(fromIso(to))),
      gte(schema.appointments.blockedEndAt, new Date(fromIso(from))),
    ];
    if (user.role === "staff") {
      if (!user.staffId) return c.json([]);
      conds.push(eq(schema.appointments.staffId, user.staffId));
    }
    const rows = await db
      .select()
      .from(schema.appointments)
      .where(and(...conds))
      .orderBy(asc(schema.appointments.startAt));
    const dtos = await Promise.all(rows.map((r) => getAppointmentDto(db, r.id)));
    return c.json(user.role === "staff" ? dtos.map((d) => ({ ...d, internalNote: d.internalNote })) : dtos);
  });

  app.get("/appointments/:id", async (c) => {
    await loadOwnedAppointment(c, c.req.param("id"));
    return c.json(await getAppointmentDto(db, c.req.param("id")));
  });

  app.post("/appointments", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = z
      .object({
        customerId: z.string().uuid().optional(),
        customerName: z.string().min(1).max(100).optional(),
        customerPhone: z.string().min(6).max(20).optional(),
        customerEmail: z.string().email().optional(),
        staffId: z.string().uuid().optional(),
        startAt: z.string().datetime(),
        selections: z
          .array(z.object({ serviceId: z.string().uuid(), addonIds: z.array(z.string().uuid()).optional() }))
          .min(1),
        source: z.enum(["admin", "phone", "walkin"]).default("admin"),
        note: z.string().max(500).optional(),
        locale: z.enum(["zh-CN", "ja"]).default("ja"),
      })
      .parse(await c.req.json());
    const dto = await createBooking(db, notifier, {
      storeId: user.storeId,
      customerId: body.customerId,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      customerEmail: body.customerEmail,
      staffId: body.staffId,
      startMs: fromIso(body.startAt),
      selections: body.selections,
      source: body.source,
      idempotencyKey: c.req.header("Idempotency-Key") === undefined
        ? undefined : z.string().uuid().parse(c.req.header("Idempotency-Key")),
      locale: body.locale,
      internalNote: body.note,
      actorUserId: user.userId,
      ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
      enforceLeadRules: false,
    });
    return c.json(dto, 201);
  });

  app.patch("/appointments/:id/status", async (c) => {
    const { user, appt } = await loadOwnedAppointment(c, c.req.param("id"));
    const body = z
      .object({
        status: z.enum(["confirmed", "arrived", "in_service", "completed", "cancelled", "no_show"]),
        serviceNote: z.string().max(2000).optional(),
      })
      .parse(await c.req.json());
    const target = body.status as AppointmentStatus;
    if (user.role === "staff" && !["arrived", "in_service", "completed"].includes(target)) {
      throw err.forbidden("Staff can only mark arrived / in_service / completed");
    }
    const allowed = STATUS_TRANSITIONS[appt.status as AppointmentStatus] ?? [];
    if (!allowed.includes(target)) {
      throw err.validation(`Cannot move appointment from ${appt.status} to ${target}`);
    }
    if (target === "cancelled") {
      const dto = await cancelBooking(db, notifier, {
        appointmentId: appt.id,
        storeId: user.storeId,
        actorUserId: user.userId,
        ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
      });
      return c.json(dto);
    }
    await db.transaction(async (tx) => {
      // Serialize with booking/cancellation and recheck status AFTER acquiring the store lock.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(4242, hashtext(${"booking:" + user.storeId}))`);
      const [live] = await tx.select().from(schema.appointments)
        .where(and(eq(schema.appointments.id, appt.id), eq(schema.appointments.storeId, user.storeId)));
      if (!live) throw err.notFound("Appointment not found");
      if (user.role === "staff" && live.staffId !== user.staffId) throw err.forbidden("Not your appointment");
      if (!(STATUS_TRANSITIONS[live.status as AppointmentStatus] ?? []).includes(target)) {
        throw err.conflict("Appointment status changed; refresh and try again");
      }
      await tx
        .update(schema.appointments)
        .set({
          status: target,
          serviceNote: body.serviceNote !== undefined ? body.serviceNote : appt.serviceNote,
          updatedAt: new Date(),
        })
        .where(eq(schema.appointments.id, appt.id));
      if (target === "no_show") {
        // 爽约释放剩余占用并作废提醒
        await tx
          .update(schema.resourceAllocations)
          .set({ active: false })
          .where(eq(schema.resourceAllocations.appointmentId, appt.id));
        await tx
          .update(schema.notificationJobs)
          .set({ status: "skipped" })
          .where(and(eq(schema.notificationJobs.appointmentId, appt.id), eq(schema.notificationJobs.status, "queued")));
      }
    });
    await writeAudit(db, {
      storeId: user.storeId,
      actorUserId: user.userId,
      action: "appointment.status",
      entityType: "appointment",
      entityId: appt.id,
      ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
      details: { from: appt.status, to: target },
    });
    return c.json(await getAppointmentDto(db, appt.id));
  });

  app.post("/appointments/:id/reschedule", async (c) => {
    const { user, appt } = await loadOwnedAppointment(c, c.req.param("id"));
    requireRole(user, MANAGER);
    const body = z
      .object({ startAt: z.string().datetime(), staffId: z.string().uuid().optional() })
      .parse(await c.req.json());
    const dto = await rescheduleBooking(db, notifier, {
      appointmentId: appt.id,
      storeId: user.storeId,
      newStartMs: fromIso(body.startAt),
      newStaffId: body.staffId,
      actorUserId: user.userId,
      ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
    });
    return c.json(dto);
  });

  app.post("/appointments/:id/cancel", async (c) => {
    const { user, appt } = await loadOwnedAppointment(c, c.req.param("id"));
    requireRole(user, MANAGER);
    const body = z.object({ reason: z.string().max(200).optional() }).parse(await c.req.json().catch(() => ({})));
    const dto = await cancelBooking(db, notifier, {
      appointmentId: appt.id,
      storeId: user.storeId,
      reason: body.reason,
      actorUserId: user.userId,
      ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
    });
    return c.json(dto);
  });

  /* ---------------- 现金日结 / 不可变营业快照 ---------------- */
  const daySchema = z.string().refine(isValidBusinessDate, "Invalid Tokyo business date");
  function dayRange(date: string) {
    const { startMs, endMs } = tokyoDayRangeMs(date);
    return { start: new Date(startMs), end: new Date(endMs) };
  }
  function serializeCashClose(row: typeof schema.cashCloses.$inferSelect) {
    return { ...row, closedAt: toIso(row.closedAt.getTime()) };
  }

  app.get("/cash-close/preview", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const date = daySchema.parse(c.req.query("date"));
    const [closed] = await db.select().from(schema.cashCloses)
      .where(and(eq(schema.cashCloses.storeId, user.storeId), eq(schema.cashCloses.businessDate, date)));
    const { start, end } = dayRange(date);
    const rows = await db.execute(methodTotalsQuery(user.storeId, start, end));
    return c.json({ date, summary: summarizeMethodTotals(rows.rows as unknown as PgMethodTotals[]), closed: closed ? serializeCashClose(closed) : null });
  });

  app.post("/cash-close", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = z.object({
      date: daySchema,
      openingCashJpy: z.number().int().min(0).max(100_000_000),
      countedCashJpy: z.number().int().min(0).max(100_000_000),
      expectedTransactionCount: z.number().int().min(0),
      note: z.string().trim().max(500).optional(),
    }).parse(await c.req.json());
    if (body.date > todayTokyo()) throw err.validation("Cannot close a future business day");
    const { start, end } = dayRange(body.date);
    const closed = await db.transaction(async (tx) => {
      await tx.execute(cashLedgerLock(user.storeId));
      const [existing] = await tx.select({ id: schema.cashCloses.id }).from(schema.cashCloses)
        .where(and(eq(schema.cashCloses.storeId, user.storeId), eq(schema.cashCloses.businessDate, body.date)));
      if (existing) throw err.conflict("Business day already closed; do not post or close twice");
      const rows = await tx.execute(methodTotalsQuery(user.storeId, start, end));
      const summary = summarizeMethodTotals(rows.rows as unknown as PgMethodTotals[]);
      if (summary.transactionCount !== body.expectedTransactionCount) {
        throw err.conflict("Ledger changed since preview; refresh and recount before closing");
      }
      const expectedCashJpy = body.openingCashJpy + summary.cashNetJpy;
      const varianceJpy = body.countedCashJpy - expectedCashJpy;
      if (!Number.isSafeInteger(expectedCashJpy) || !Number.isSafeInteger(varianceJpy)) {
        throw err.validation("Cash amount exceeds safe integer range");
      }
      if (expectedCashJpy < 0) throw err.validation("Opening cash is insufficient to cover cash refunds");
      if (varianceJpy !== 0 && (body.note?.length ?? 0) < 3) {
        throw err.validation("Explain a non-zero cash variance in the note (at least 3 characters)");
      }
      const [created] = await tx.insert(schema.cashCloses).values({
        storeId: user.storeId, businessDate: body.date,
        openingCashJpy: body.openingCashJpy,
        countedCashJpy: body.countedCashJpy,
        expectedCashJpy, varianceJpy,
        receivedJpy: summary.receivedJpy,
        refundedJpy: summary.refundedJpy,
        netJpy: summary.netJpy,
        cashNetJpy: summary.cashNetJpy,
        transactionCount: summary.transactionCount,
        methodTotals: summary.methods,
        note: body.note || null,
        closedBy: user.userId,
      }).returning();
      if (!created) throw err.internal("Cash close could not be created");
      return created;
    });
    await writeAudit(db, {
      storeId: user.storeId, actorUserId: user.userId,
      action: "cash_close.create", entityType: "cash_close", entityId: closed.id,
      ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
      details: { date: body.date, netJpy: closed.netJpy, varianceJpy: closed.varianceJpy },
    });
    return c.json(serializeCashClose(closed), 201);
  });

  /* ---------------- 收银 ---------------- */
  app.get("/payments", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) throw err.validation("from and to (YYYY-MM-DD, Tokyo) are required");
    const { startMs } = tokyoDayRangeMs(from);
    const { endMs } = tokyoDayRangeMs(to);
    const rows = await db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.storeId, user.storeId),
          gte(schema.payments.paidAt, new Date(startMs)),
          lt(schema.payments.paidAt, new Date(endMs)),
        ),
      )
      .orderBy(desc(schema.payments.paidAt))
      .limit(500);
    return c.json(
      rows.map(paymentJson),
    );
  });

  // V12: financial API serialization is scoped to the store's ledger, exactly like cash close.
  // With a client-supplied UUID, a timeout/retry cannot insert a second receipt/refund.
  // Legacy callers without the header remain supported, but cannot guarantee safe retries.
  const operationKey = z.string().uuid();
  function paymentJson(p: typeof schema.payments.$inferSelect) {
    // Operation fingerprints/UUIDs are internal accounting metadata, not front-desk display data.
    const { idempotencyKey: _key, idempotencyFingerprint: _fingerprint, ...safe } = p;
    return { ...safe, paidAt: toIso(p.paidAt.getTime()), createdAt: toIso(p.createdAt.getTime()) };
  }

  app.post("/payments", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const body = z.object({
      appointmentId: z.string().uuid().nullable().optional(),
      customerId: z.string().uuid().nullable().optional(),
      amountJpy: z.number().int().positive().max(10_000_000),
      method: z.enum(["cash", "card", "paypay", "line_pay", "bank_transfer", "other"]),
      providerRef: z.string().max(100).nullable().optional(),
      note: z.string().max(200).optional(),
      paidAt: z.string().datetime().optional(),
    }).parse(await c.req.json());
    const suppliedKey = c.req.header("Idempotency-Key");
    const key = suppliedKey === undefined ? null : operationKey.parse(suppliedKey);
    const fingerprint = key ? paymentFingerprint({
      operation: "receipt", appointmentId: body.appointmentId, customerId: body.customerId,
      amountJpy: body.amountJpy, method: body.method, providerRef: body.providerRef,
      note: body.note, paidAt: body.paidAt,
    }) : null;
    const payDate = body.paidAt ? new Date(fromIso(body.paidAt)) : new Date();
    const businessDate = tokyoDateOf(payDate.getTime());
    const result = await db.transaction(async (tx) => {
      await tx.execute(cashLedgerLock(user.storeId));
      // Replay is checked first, even if its business date has since been closed.
      if (key) {
        const [existing] = await tx.select().from(schema.payments).where(and(
          eq(schema.payments.storeId, user.storeId), eq(schema.payments.idempotencyKey, key),
        ));
        if (existing) {
          if (paymentRetryDisposition(existing.idempotencyFingerprint, fingerprint!) === "conflict") {
            throw err.conflict("Idempotency-Key already used for a different payment or refund");
          }
          return { row: existing, replay: true };
        }
      }
      const [closed] = await tx.select({ id: schema.cashCloses.id }).from(schema.cashCloses)
        .where(and(eq(schema.cashCloses.storeId, user.storeId), eq(schema.cashCloses.businessDate, businessDate)));
      if (closed) throw err.conflict("Business day is already closed; payment needs correction workflow");
      let customerId = body.customerId ?? null;
      if (body.appointmentId) {
        const [appt] = await tx.select({ customerId: schema.appointments.customerId }).from(schema.appointments)
          .where(and(eq(schema.appointments.id, body.appointmentId), eq(schema.appointments.storeId, user.storeId)));
        if (!appt) throw err.notFound("Appointment not found");
        customerId = appt.customerId;
      }
      if (customerId) {
        const [ownedCustomer] = await tx.select({ id: schema.customers.id }).from(schema.customers)
          .where(and(eq(schema.customers.id, customerId), eq(schema.customers.storeId, user.storeId)));
        if (!ownedCustomer) throw err.validation("Payment customer must belong to this store");
      }
      const [created] = await tx.insert(schema.payments).values({
        storeId: user.storeId, appointmentId: body.appointmentId ?? null, customerId,
        amountJpy: body.amountJpy, method: body.method,
        providerRef: body.providerRef ?? null, note: body.note ?? null,
        paidAt: payDate, createdBy: user.userId,
        idempotencyKey: key, idempotencyFingerprint: fingerprint,
      }).returning();
      if (!created) throw err.internal("Payment could not be saved");
      // Financial write + audit commit together; do not silently swallow an audit failure.
      await tx.insert(schema.auditLogs).values({
        storeId: user.storeId, actorUserId: user.userId,
        action: "payment.create", entityType: "payment", entityId: created.id,
        ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
        details: { amountJpy: body.amountJpy, method: body.method },
      });
      return { row: created, replay: false };
    });
    c.header("Idempotency-Replayed", result.replay ? "true" : "false");
    return c.json(paymentJson(result.row), result.replay ? 200 : 201);
  });

  app.post("/payments/:id/refund", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const originalId = z.string().uuid().parse(c.req.param("id"));
    const body = z.object({
      amountJpy: z.number().int().positive().max(10_000_000),
      note: z.string().max(200).optional(),
      paidAt: z.string().datetime().optional(),
    }).parse(await c.req.json());
    const suppliedKey = c.req.header("Idempotency-Key");
    const key = suppliedKey === undefined ? null : operationKey.parse(suppliedKey);
    const fingerprint = key ? paymentFingerprint({
      operation: "refund", originalPaymentId: originalId,
      amountJpy: body.amountJpy, note: body.note, paidAt: body.paidAt,
    }) : null;
    const refundDate = body.paidAt ? new Date(fromIso(body.paidAt)) : new Date();
    const refundBusinessDate = tokyoDateOf(refundDate.getTime());
    const result = await db.transaction(async (tx) => {
      await tx.execute(cashLedgerLock(user.storeId));
      // Critical ordering: a successful refund remains replayable after closing the day.
      if (key) {
        const [existing] = await tx.select().from(schema.payments).where(and(
          eq(schema.payments.storeId, user.storeId), eq(schema.payments.idempotencyKey, key),
        ));
        if (existing) {
          if (paymentRetryDisposition(existing.idempotencyFingerprint, fingerprint!) === "conflict") {
            throw err.conflict("Idempotency-Key already used for a different payment or refund");
          }
          return { row: existing, replay: true };
        }
      }
      const [closed] = await tx.select({ id: schema.cashCloses.id }).from(schema.cashCloses)
        .where(and(eq(schema.cashCloses.storeId, user.storeId), eq(schema.cashCloses.businessDate, refundBusinessDate)));
      if (closed) throw err.conflict("Business day is already closed; refund needs correction workflow");
      await tx.execute(sql`SELECT id FROM payments WHERE id = ${originalId} AND store_id = ${user.storeId} FOR UPDATE`);
      const [orig] = await tx.select().from(schema.payments)
        .where(and(eq(schema.payments.id, originalId), eq(schema.payments.storeId, user.storeId)));
      if (!orig || orig.amountJpy <= 0 || orig.refundOfId) throw err.notFound("Original payment not found");
      const refunds = await tx.select({ sum: sql<number>`COALESCE(SUM(-${schema.payments.amountJpy}), 0)::int` })
        .from(schema.payments).where(and(eq(schema.payments.refundOfId, orig.id), eq(schema.payments.storeId, user.storeId)));
      const alreadyRefunded = refunds[0]?.sum ?? 0;
      if (alreadyRefunded + body.amountJpy > orig.amountJpy) {
        throw err.validation("Refund exceeds the original payment amount");
      }
      const [created] = await tx.insert(schema.payments).values({
        storeId: user.storeId, appointmentId: orig.appointmentId, customerId: orig.customerId,
        amountJpy: -body.amountJpy, method: orig.method, status: "paid", refundOfId: orig.id,
        note: body.note ?? "退款", paidAt: refundDate, createdBy: user.userId,
        idempotencyKey: key, idempotencyFingerprint: fingerprint,
      }).returning();
      if (!created) throw err.internal("Refund record could not be saved");
      await tx.update(schema.payments).set({
        status: alreadyRefunded + body.amountJpy === orig.amountJpy ? "refunded" : "partially_refunded",
      }).where(eq(schema.payments.id, orig.id));
      await tx.insert(schema.auditLogs).values({
        storeId: user.storeId, actorUserId: user.userId,
        action: "payment.refund", entityType: "payment", entityId: originalId,
        ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
        details: { amountJpy: body.amountJpy, refundId: created.id },
      });
      return { row: created, replay: false };
    });
    c.header("Idempotency-Replayed", result.replay ? "true" : "false");
    return c.json(paymentJson(result.row), result.replay ? 200 : 201);
  });

  /* ---------------- 经营报表 ---------------- */
  app.get("/reports/summary", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) throw err.validation("from and to (YYYY-MM-DD, Tokyo) are required");
    const { startMs } = tokyoDayRangeMs(from);
    const { endMs } = tokyoDayRangeMs(to);
    const fromDate = new Date(startMs);
    const toDate = new Date(endMs);

    const revenueRows = await db.execute(sql`
      SELECT (paid_at AT TIME ZONE 'Asia/Tokyo')::date AS day,
             COALESCE(SUM(amount_jpy), 0)::int AS revenue
      FROM payments
      WHERE store_id = ${user.storeId} AND paid_at >= ${fromDate} AND paid_at < ${toDate}
      GROUP BY day ORDER BY day`);
    const revenueByDay = (revenueRows.rows as { day: unknown; revenue: number }[]).map((r) => ({
      date: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
      revenueJpy: r.revenue,
    }));
    const totalRevenue = revenueByDay.reduce((n, r) => n + r.revenueJpy, 0);

    const statusRows = await db
      .select({ status: schema.appointments.status, count: sql<number>`COUNT(*)::int` })
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.storeId, user.storeId),
          gte(schema.appointments.startAt, fromDate),
          lt(schema.appointments.startAt, toDate),
        ),
      )
      .groupBy(schema.appointments.status);

    const staffPerf = await db.execute(sql`
      SELECT a.staff_id AS staff_id, s.name AS name,
             COUNT(*)::int AS completed_count,
             COALESCE(SUM(a.total_price_jpy), 0)::int AS revenue
      FROM appointments a JOIN staff s ON s.id = a.staff_id
      WHERE a.store_id = ${user.storeId} AND a.status = 'completed'
        AND a.end_at >= ${fromDate} AND a.end_at < ${toDate}
      GROUP BY a.staff_id, s.name ORDER BY revenue DESC`);
    const serviceRank = await db.execute(sql`
      SELECT sv.id AS service_id, sv.name_zh AS name_zh, sv.name_ja AS name_ja,
             COUNT(*)::int AS count,
             COALESCE(SUM(aps.price_snapshot_jpy), 0)::int AS revenue
      FROM appointment_services aps
      JOIN appointments a ON a.id = aps.appointment_id
      JOIN services sv ON sv.id = aps.service_id
      WHERE a.store_id = ${user.storeId} AND a.status <> 'cancelled'
        AND a.start_at >= ${fromDate} AND a.start_at < ${toDate}
      GROUP BY sv.id, sv.name_zh, sv.name_ja ORDER BY count DESC LIMIT 20`);

    return c.json({
      from,
      to,
      revenueJpy: totalRevenue,
      revenueByDay,
      appointmentsByStatus: Object.fromEntries(statusRows.map((r) => [r.status, r.count])),
      appointmentsTotal: statusRows.reduce((n, r) => n + r.count, 0),
      staffPerformance: (staffPerf.rows as Record<string, unknown>[]).map((r) => ({
        staffId: r.staff_id,
        name: r.name,
        completedCount: r.completed_count,
        revenueJpy: r.revenue,
      })),
      serviceRanking: (serviceRank.rows as Record<string, unknown>[]).map((r) => ({
        serviceId: r.service_id,
        nameZh: r.name_zh,
        nameJa: r.name_ja,
        count: r.count,
        revenueJpy: r.revenue,
      })),
    });
  });

  /* ---------------- 通知任务：向店长公开最小化的发送状态，不暴露完整通知内容 ---------------- */
  app.get("/notifications", async (c) => {
    const user = actor(c);
    requireRole(user, MANAGER);
    const rows = await db
      .select({
        id: schema.notificationJobs.id,
        type: schema.notificationJobs.type,
        channel: schema.notificationJobs.channel,
        recipient: schema.notificationJobs.recipient,
        status: schema.notificationJobs.status,
        attempts: schema.notificationJobs.attempts,
        lastError: schema.notificationJobs.lastError,
        scheduledAt: schema.notificationJobs.scheduledAt,
        sentAt: schema.notificationJobs.sentAt,
        createdAt: schema.notificationJobs.createdAt,
      })
      .from(schema.notificationJobs)
      .where(eq(schema.notificationJobs.storeId, user.storeId))
      .orderBy(desc(schema.notificationJobs.createdAt))
      .limit(100);
    c.header("Cache-Control", "no-store");
    return c.json(rows.map((r) => ({
      ...r,
      recipient: r.recipient ? `***${r.recipient.slice(-4)}` : null,
      scheduledAt: toIso(r.scheduledAt.getTime()),
      sentAt: r.sentAt ? toIso(r.sentAt.getTime()) : null,
      createdAt: toIso(r.createdAt.getTime()),
    })));
  });

  /* ---------------- 系统用户（店主） ---------------- */
  async function ensureOwnedStaffId(storeId: string, staffId: string | null | undefined): Promise<void> {
    if (!staffId) return;
    const [staffRow] = await db.select({ id: schema.staff.id }).from(schema.staff)
      .where(and(eq(schema.staff.id, staffId), eq(schema.staff.storeId, storeId)));
    if (!staffRow) throw err.validation("Assigned staff member does not belong to this store");
  }

  app.get("/users", async (c) => {
    const user = actor(c);
    requireRole(user, ["owner"]);
    const rows = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        role: schema.users.role,
        name: schema.users.name,
        staffId: schema.users.staffId,
        active: schema.users.active,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.storeId, user.storeId))
      .orderBy(asc(schema.users.createdAt));
    return c.json(rows.map((r) => ({ ...r, createdAt: toIso(r.createdAt.getTime()) })));
  });

  app.post("/users", async (c) => {
    const user = actor(c);
    requireRole(user, ["owner"]);
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(8).max(200),
        role: z.enum(["owner", "manager", "staff"]),
        name: z.string().min(1).max(100),
        staffId: z.string().uuid().nullable().optional(),
      })
      .parse(await c.req.json());
    await ensureOwnedStaffId(user.storeId, body.staffId);
    const [row] = await db
      .insert(schema.users)
      .values({
        storeId: user.storeId,
        email: body.email.toLowerCase(),
        passwordHash: hashPassword(body.password),
        role: body.role,
        name: body.name,
        staffId: body.staffId ?? null,
      })
      .returning({ id: schema.users.id });
    if (!row) throw err.internal("User insert failed");
    await writeAudit(db, {
      storeId: user.storeId,
      actorUserId: user.userId,
      action: "user.create",
      entityType: "user",
      entityId: row.id,
      ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
      details: { role: body.role },
    });
    return c.json({ id: row.id }, 201);
  });

  app.put("/users/:id", async (c) => {
    const user = actor(c);
    requireRole(user, ["owner"]);
    const body = z
      .object({
        role: z.enum(["owner", "manager", "staff"]).optional(),
        name: z.string().min(1).max(100).optional(),
        active: z.boolean().optional(),
        staffId: z.string().uuid().nullable().optional(),
        password: z.string().min(8).max(200).optional(),
      })
      .parse(await c.req.json());
    await ensureOwnedStaffId(user.storeId, body.staffId);
    if (c.req.param("id") === user.userId && (body.active === false || (body.role && body.role !== "owner"))) {
      throw err.validation("Owner cannot disable or demote their own account");
    }
    const [row] = await db
      .update(schema.users)
      .set({
        role: body.role,
        name: body.name,
        active: body.active,
        staffId: body.staffId,
        passwordHash: body.password ? hashPassword(body.password) : undefined,
      })
      .where(and(eq(schema.users.id, c.req.param("id")), eq(schema.users.storeId, user.storeId)))
      .returning({ id: schema.users.id });
    if (!row) throw err.notFound("User not found");
    // Changing password, role, assignment or active state invalidates any prior grants.
    if (body.password !== undefined || body.role !== undefined || body.staffId !== undefined || body.active !== undefined) {
      await db.update(schema.authSessions).set({ revokedAt: new Date() })
        .where(and(eq(schema.authSessions.userId, row.id), sql`${schema.authSessions.revokedAt} IS NULL`));
    }
    return c.json({ ok: true });
  });

  return app;
}

/** 技师端：自己的日程与业绩（状态变更走 /admin/appointments/:id/status，受 staff 规则约束） */
export function staffRoutes(db: Database, config: AppConfig): Hono {
  const app = new Hono();
  app.use("*", authMiddleware(db, config.JWT_SECRET, undefined, config.CORS_ORIGINS));

  app.get("/schedule", async (c) => {
    const user = actor(c);
    if (!user.staffId) return c.json([]);
    const date = c.req.query("date");
    if (!date) throw err.validation("date (YYYY-MM-DD) is required");
    const { startMs, endMs } = tokyoDayRangeMs(date);
    const rows = await db
      .select()
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.storeId, user.storeId),
          eq(schema.appointments.staffId, user.staffId),
          gte(schema.appointments.startAt, new Date(startMs)),
          lt(schema.appointments.startAt, new Date(endMs)),
        ),
      )
      .orderBy(asc(schema.appointments.startAt));
    return c.json(await Promise.all(rows.map((r) => getAppointmentDto(db, r.id))));
  });

  app.get("/performance", async (c) => {
    const user = actor(c);
    if (!user.staffId) return c.json({ completedCount: 0, revenueJpy: 0 });
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) throw err.validation("from and to (YYYY-MM-DD) are required");
    const { startMs } = tokyoDayRangeMs(from);
    const { endMs } = tokyoDayRangeMs(to);
    const rows = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        revenue: sql<number>`COALESCE(SUM(${schema.appointments.totalPriceJpy}), 0)::int`,
      })
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.staffId, user.staffId),
          eq(schema.appointments.status, "completed"),
          gte(schema.appointments.endAt, new Date(startMs)),
          lt(schema.appointments.endAt, new Date(endMs)),
        ),
      );
    return c.json({ completedCount: rows[0]?.count ?? 0, revenueJpy: rows[0]?.revenue ?? 0 });
  });

  return app;
}
