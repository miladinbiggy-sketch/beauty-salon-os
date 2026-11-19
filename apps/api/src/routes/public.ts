import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Database } from "@salon/database";
import { findAvailability } from "@salon/scheduler";
import { err, fromIso, toIso, tokyoDateOf, type Locale } from "@salon/shared";
import type { AppConfig } from "../config.js";
import { storeSettingsOf } from "../config.js";
import { buildContextForDate } from "../context-builder.js";
import { RateLimiter, clientIp } from "../ratelimit.js";
import {
  cancelBooking,
  createBooking,
  getAppointmentDto,
  patchContext,
  rescheduleBooking,
  resolveSelections,
  type AppointmentDto,
  type ServiceSelection,
} from "../services/booking.js";
import type { Notifier } from "../queue.js";

const selectionSchema = z.object({
  serviceId: z.string().uuid(),
  addonIds: z.array(z.string().uuid()).max(8).optional(),
});

function publicDto(dto: AppointmentDto): AppointmentDto {
  // 顾客端不下发内部备注
  return { ...dto, internalNote: null, serviceNote: null };
}

async function findByCodeAndPhone(db: Database, storeId: string, bookingCode: string, phone: string) {
  const [appt] = await db
    .select()
    .from(schema.appointments)
    .where(and(eq(schema.appointments.storeId, storeId), eq(schema.appointments.bookingCode, bookingCode.toUpperCase())));
  if (!appt) throw err.notFound("Appointment not found");
  const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, appt.customerId));
  if (!customer || customer.phone !== phone) throw err.notFound("Appointment not found");
  return appt;
}

export function publicRoutes(db: Database, config: AppConfig, notifier: Notifier): Hono {
  const app = new Hono();
  const bookingLimiter = new RateLimiter(10, 60_000, { driver: config.RATE_LIMIT_DRIVER, redisUrl: config.REDIS_URL, namespace: "booking" });
  const lookupLimiter = new RateLimiter(30, 60_000, { driver: config.RATE_LIMIT_DRIVER, redisUrl: config.REDIS_URL, namespace: "lookup" });

  app.get("/stores/:storeId", async (c) => {
    const storeId = c.req.param("storeId");
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
    if (!store) throw err.notFound("Store not found");
    const hours = await db
      .select()
      .from(schema.businessHours)
      .where(eq(schema.businessHours.storeId, storeId))
      .orderBy(asc(schema.businessHours.weekday));
    const settings = storeSettingsOf(store.settings);
    return c.json({
      id: store.id,
      name: store.name,
      nameJa: store.nameJa,
      phone: store.phone,
      address: store.address,
      businessHours: hours.map((h) => ({
        weekday: h.weekday,
        openTime: h.openTime.slice(0, 5),
        closeTime: h.closeTime.slice(0, 5),
        isClosed: h.isClosed,
      })),
      booking: {
        bookingWindowDays: settings.bookingWindowDays,
        minLeadMinutes: settings.minLeadMinutes,
        slotStepMinutes: settings.slotStepMinutes,
      },
    });
  });

  app.get("/services", async (c) => {
    const storeId = c.req.query("storeId");
    if (!storeId) throw err.validation("storeId is required");
    const rows = await db
      .select()
      .from(schema.services)
      .where(and(eq(schema.services.storeId, storeId), eq(schema.services.active, true)))
      .orderBy(asc(schema.services.sortOrder));
    const addons = await db.select().from(schema.serviceAddons).where(eq(schema.serviceAddons.active, true));
    return c.json(
      rows.map((s) => ({
        id: s.id,
        category: s.category,
        nameZh: s.nameZh,
        nameJa: s.nameJa,
        descriptionZh: s.descriptionZh,
        descriptionJa: s.descriptionJa,
        durationMinutes: s.durationMinutes,
        bufferMinutes: s.bufferMinutes,
        priceJpy: s.priceJpy,
        resourceType: s.resourceType,
        color: s.color,
        addons: addons
          .filter((a) => a.serviceId === s.id)
          .map((a) => ({ id: a.id, nameZh: a.nameZh, nameJa: a.nameJa, priceJpy: a.priceJpy, durationMinutes: a.durationMinutes })),
      })),
    );
  });

  app.get("/staff", async (c) => {
    const storeId = c.req.query("storeId");
    if (!storeId) throw err.validation("storeId is required");
    const rows = await db
      .select()
      .from(schema.staff)
      .where(and(eq(schema.staff.storeId, storeId), eq(schema.staff.active, true)))
      .orderBy(asc(schema.staff.sortOrder));
    const skills = await db.select().from(schema.staffSkills);
    return c.json(
      rows.map((s) => ({
        id: s.id,
        name: s.name,
        nameJa: s.nameJa,
        color: s.color,
        skillServiceIds: skills.filter((k) => k.staffId === s.id).map((k) => k.serviceId),
      })),
    );
  });

  app.get("/availability", async (c) => {
    const storeId = c.req.query("storeId");
    const date = c.req.query("date");
    const staffId = c.req.query("staffId") || undefined;
    const selRaw = c.req.query("sel");
    if (!storeId || !date || !selRaw) throw err.validation("storeId, date and sel are required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw err.validation("date must be YYYY-MM-DD");
    let selections: ServiceSelection[];
    try {
      selections = z.array(selectionSchema).min(1).max(8).parse(JSON.parse(selRaw));
    } catch {
      throw err.validation("sel must be a JSON array of {serviceId, addonIds}");
    }
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
    if (!store) throw err.notFound("Store not found");
    const settings = storeSettingsOf(store.settings);
    const today = tokyoDateOf(Date.now());
    // Do not enumerate historic schedules or extend availability beyond the booking horizon.
    const maxDate = tokyoDateOf(Date.now() + settings.bookingWindowDays * 24 * 60 * 60_000);
    if (date < today || date > maxDate) return c.json([]);
    const { ctxPatch } = await resolveSelections(db, storeId, selections);
    const ctx = patchContext(await buildContextForDate(db, storeId, date), ctxPatch);

    const isToday = date === tokyoDateOf(Date.now());
    const windowStartMs = isToday ? Date.now() + settings.minLeadMinutes * 60_000 : ctx.storeOpenMs;
    const options = findAvailability(ctx, {
      serviceIds: selections.map((s) => s.serviceId),
      staffId,
      windowStartMs,
      windowEndMs: ctx.storeCloseMs,
      stepMinutes: settings.slotStepMinutes,
    });
    return c.json(
      options.map((o) => ({
        staffId: o.staffId,
        startAt: toIso(o.startMs),
        endAt: toIso(o.customerEndMs),
        totalPriceJpy: o.totalPriceJpy,
      })),
    );
  });

  const createSchema = z.object({
    storeId: z.string().uuid(),
    name: z.string().min(1).max(100),
    phone: z.string().min(6).max(20),
    email: z.string().email().optional(),
    staffId: z.string().uuid().optional(),
    startAt: z.string().datetime(),
    selections: z.array(selectionSchema).min(1).max(8),
    note: z.string().max(500).optional(),
    locale: z.enum(["zh-CN", "ja"]).default("ja"),
  });

  app.post("/appointments", async (c) => {
    await bookingLimiter.check(clientIp(c.req.raw.headers, config.TRUST_PROXY));
    const body = createSchema.parse(await c.req.json());
    const requestKey = c.req.header("Idempotency-Key");
    const idempotencyKey = requestKey === undefined ? undefined : z.string().uuid().parse(requestKey);
    const dto = await createBooking(db, notifier, {
      storeId: body.storeId,
      customerName: body.name,
      customerPhone: body.phone,
      customerEmail: body.email,
      staffId: body.staffId,
      startMs: fromIso(body.startAt),
      selections: body.selections,
      source: "online",
      idempotencyKey,
      locale: body.locale as Locale,
      customerNote: body.note,
      ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
      enforceLeadRules: true,
    });
    return c.json(publicDto(dto), 201);
  });

  const lookupSchema = z.object({
    storeId: z.string().uuid(),
    bookingCode: z.string().min(4).max(16),
    phone: z.string().min(6).max(20),
  });

  app.post("/appointments/lookup", async (c) => {
    await lookupLimiter.check(clientIp(c.req.raw.headers, config.TRUST_PROXY));
    const body = lookupSchema.parse(await c.req.json());
    const appt = await findByCodeAndPhone(db, body.storeId, body.bookingCode, body.phone);
    return c.json(publicDto(await getAppointmentDto(db, appt.id)));
  });

  app.post("/appointments/cancel", async (c) => {
    await lookupLimiter.check(clientIp(c.req.raw.headers, config.TRUST_PROXY));
    const body = lookupSchema.extend({ reason: z.string().max(200).optional() }).parse(await c.req.json());
    const appt = await findByCodeAndPhone(db, body.storeId, body.bookingCode, body.phone);
    if (appt.status === "completed" || appt.status === "in_service" || appt.status === "arrived") {
      throw err.validation("This appointment can no longer be cancelled online");
    }
    const dto = await cancelBooking(db, notifier, {
      appointmentId: appt.id,
      storeId: body.storeId,
      reason: body.reason,
      onlineCancellation: true,
      ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
    });
    return c.json(publicDto(dto));
  });

  app.post("/appointments/reschedule", async (c) => {
    await lookupLimiter.check(clientIp(c.req.raw.headers, config.TRUST_PROXY));
    const body = lookupSchema
      .extend({ startAt: z.string().datetime(), staffId: z.string().uuid().optional() })
      .parse(await c.req.json());
    const appt = await findByCodeAndPhone(db, body.storeId, body.bookingCode, body.phone);
    const dto = await rescheduleBooking(db, notifier, {
      appointmentId: appt.id,
      storeId: body.storeId,
      newStartMs: fromIso(body.startAt),
      newStaffId: body.staffId,
      enforceLeadRules: true,
      ip: clientIp(c.req.raw.headers, config.TRUST_PROXY),
    });
    return c.json(publicDto(dto));
  });

  void config;
  return app;
}
