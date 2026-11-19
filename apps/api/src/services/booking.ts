import { randomInt } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { schema, type Database } from "@salon/database";
import { validatePlacement, type ScheduleContext } from "@salon/scheduler";
import {
  err,
  toIso,
  tokyoDateOf,
  type AppointmentStatus,
  type Locale,
  type NotificationType,
} from "@salon/shared";
import { buildContextForDate } from "../context-builder.js";
import { storeSettingsOf } from "../config.js";
import type { Notifier } from "../queue.js";
import { redact } from "../audit.js";
import { bookingFingerprint } from "./booking-idempotency.js";

const MIN = 60_000;
type Tx = Database; // drizzle 事务对象与 Database 接口一致，这里统一按 Database 用

export interface ServiceSelection {
  serviceId: string;
  addonIds?: string[];
}

export interface AddonSnapshot {
  id: string;
  nameZh: string;
  nameJa: string;
  priceJpy: number;
  durationMinutes: number;
}

export interface AppointmentDto {
  id: string;
  storeId: string;
  bookingCode: string;
  status: AppointmentStatus;
  source: string;
  locale: string;
  customer: { id: string; name: string; phone: string; email: string | null };
  staff: { id: string; name: string; nameJa: string | null; color: string };
  startAt: string;
  endAt: string;
  blockedEndAt: string;
  totalPriceJpy: number;
  customerNote: string | null;
  internalNote: string | null;
  serviceNote: string | null;
  services: {
    appointmentServiceId: string;
    serviceId: string;
    nameZh: string;
    nameJa: string;
    position: number;
    startAt: string;
    endAt: string;
    priceJpy: number;
    durationMinutes: number;
    bufferMinutes: number;
    resourceType: string | null;
    resourceId: string | null;
    resourceName: string | null;
    addons: AddonSnapshot[];
  }[];
  payments: { id: string; amountJpy: number; method: string; status: string; paidAt: string }[];
  createdAt: string;
}

export async function getAppointmentDto(db: Database, appointmentId: string): Promise<AppointmentDto> {
  const [appt] = await db
    .select()
    .from(schema.appointments)
    .where(eq(schema.appointments.id, appointmentId));
  if (!appt) throw err.notFound("Appointment not found");
  const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, appt.customerId));
  const [staffRow] = await db.select().from(schema.staff).where(eq(schema.staff.id, appt.staffId));
  const svcRows = await db
    .select({
      row: schema.appointmentServices,
      nameZh: schema.services.nameZh,
      nameJa: schema.services.nameJa,
    })
    .from(schema.appointmentServices)
    .innerJoin(schema.services, eq(schema.appointmentServices.serviceId, schema.services.id))
    .where(eq(schema.appointmentServices.appointmentId, appointmentId))
    .orderBy(asc(schema.appointmentServices.position));
  const allocs = await db
    .select()
    .from(schema.resourceAllocations)
    .where(and(eq(schema.resourceAllocations.appointmentId, appointmentId), eq(schema.resourceAllocations.active, true)));
  const resourceIds = allocs.map((a) => a.resourceId).filter((x): x is string => !!x);
  const resourceRows = resourceIds.length
    ? await db.select().from(schema.resources).where(inArray(schema.resources.id, resourceIds))
    : [];
  const resourceName = new Map(resourceRows.map((r) => [r.id, r.name]));
  const paymentRows = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.appointmentId, appointmentId))
    .orderBy(asc(schema.payments.paidAt));

  return {
    id: appt.id,
    storeId: appt.storeId,
    bookingCode: appt.bookingCode,
    status: appt.status as AppointmentStatus,
    source: appt.source,
    locale: appt.locale,
    customer: {
      id: customer?.id ?? appt.customerId,
      name: customer?.name ?? "",
      phone: customer?.phone ?? "",
      email: customer?.email ?? null,
    },
    staff: {
      id: staffRow?.id ?? appt.staffId,
      name: staffRow?.name ?? "",
      nameJa: staffRow?.nameJa ?? null,
      color: staffRow?.color ?? "#3b82f6",
    },
    startAt: toIso(appt.startAt.getTime()),
    endAt: toIso(appt.endAt.getTime()),
    blockedEndAt: toIso(appt.blockedEndAt.getTime()),
    totalPriceJpy: appt.totalPriceJpy,
    customerNote: appt.customerNote,
    internalNote: appt.internalNote,
    serviceNote: appt.serviceNote,
    services: svcRows.map(({ row, nameZh, nameJa }) => {
      const alloc = allocs.find(
        (a) => a.resourceId && a.startAt.getTime() === row.startAt.getTime(),
      );
      return {
        appointmentServiceId: row.id,
        serviceId: row.serviceId,
        nameZh,
        nameJa,
        position: row.position,
        startAt: toIso(row.startAt.getTime()),
        endAt: toIso(row.endAt.getTime()),
        priceJpy: row.priceSnapshotJpy,
        durationMinutes: row.durationSnapshotMin,
        bufferMinutes: row.bufferSnapshotMin,
        resourceType: row.resourceTypeSnapshot,
        resourceId: alloc?.resourceId ?? null,
        resourceName: alloc?.resourceId ? (resourceName.get(alloc.resourceId) ?? null) : null,
        addons: (row.addonsSnapshot as AddonSnapshot[]) ?? [],
      };
    }),
    payments: paymentRows.map((p) => ({
      id: p.id,
      amountJpy: p.amountJpy,
      method: p.method,
      status: p.status,
      paidAt: toIso(p.paidAt.getTime()),
    })),
    createdAt: toIso(appt.createdAt.getTime()),
  };
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function genBookingCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export async function storeLock(tx: Tx, storeId: string): Promise<void> {
  // 同一门店的预约写入串行化：校验与插入在同一事务内完成，杜绝并发抢约的检查-提交窗口。
  await tx.execute(sql`SELECT pg_advisory_xact_lock(4242, hashtext(${"booking:" + storeId}))`);
}

interface ResolvedSelection {
  serviceId: string;
  addons: AddonSnapshot[];
  effectiveDuration: number;
  effectivePrice: number;
  bufferMinutes: number;
}

export async function resolveSelections(
  db: Database,
  storeId: string,
  selections: ServiceSelection[],
): Promise<{ resolved: ResolvedSelection[]; ctxPatch: Map<string, { durationMinutes: number; priceJpy: number }> }> {
  if (selections.length === 0 || selections.length > 8) throw err.validation("Select between 1 and 8 services");
  const seen = new Set<string>();
  for (const s of selections) {
    if (seen.has(s.serviceId)) throw err.validation("Duplicate service in one booking is not allowed");
    seen.add(s.serviceId);
  }
  const serviceIds = selections.map((s) => s.serviceId);
  const svcRows = await db
    .select()
    .from(schema.services)
    .where(and(inArray(schema.services.id, serviceIds), eq(schema.services.storeId, storeId)));
  if (svcRows.length !== serviceIds.length) throw err.validation("Unknown service");
  const svcById = new Map(svcRows.map((s) => [s.id, s]));
  for (const s of svcRows) if (!s.active) throw err.validation(`Service inactive: ${s.nameJa}`);

  const addonIds = selections.flatMap((s) => s.addonIds ?? []);
  if (addonIds.length > 24 || new Set(addonIds).size !== addonIds.length || selections.some((s) => (s.addonIds?.length ?? 0) > 8)) {
    throw err.validation("Too many or duplicate addons");
  }
  const addonRows = addonIds.length
    ? await db.select().from(schema.serviceAddons).where(inArray(schema.serviceAddons.id, addonIds))
    : [];
  const addonById = new Map(addonRows.map((a) => [a.id, a]));
  if (addonRows.length !== addonIds.length) throw err.validation("Unknown addon");

  const resolved: ResolvedSelection[] = [];
  const ctxPatch = new Map<string, { durationMinutes: number; priceJpy: number }>();
  for (const sel of selections) {
    const svc = svcById.get(sel.serviceId)!;
    const addons: AddonSnapshot[] = (sel.addonIds ?? []).map((id) => {
      const a = addonById.get(id)!;
      if (!a.active) throw err.validation("Addon is inactive");
      if (a.serviceId !== sel.serviceId) throw err.validation("Addon does not belong to service");
      return { id: a.id, nameZh: a.nameZh, nameJa: a.nameJa, priceJpy: a.priceJpy, durationMinutes: a.durationMinutes };
    });
    const effectiveDuration = svc.durationMinutes + addons.reduce((n, a) => n + a.durationMinutes, 0);
    const effectivePrice = svc.priceJpy + addons.reduce((n, a) => n + a.priceJpy, 0);
    resolved.push({
      serviceId: sel.serviceId,
      addons,
      effectiveDuration,
      effectivePrice,
      bufferMinutes: svc.bufferMinutes,
    });
    ctxPatch.set(sel.serviceId, { durationMinutes: effectiveDuration, priceJpy: effectivePrice });
  }
  return { resolved, ctxPatch };
}

/** 用附加项调整后的时长/价格覆盖上下文中的服务定义（仅本次请求） */
export function patchContext(ctx: ScheduleContext, patch: Map<string, { durationMinutes: number; priceJpy: number }>): ScheduleContext {
  if (patch.size === 0) return ctx;
  const services = new Map(ctx.services);
  for (const [id, p] of patch) {
    const orig = services.get(id);
    if (orig) services.set(id, { ...orig, durationMinutes: p.durationMinutes, priceJpy: p.priceJpy });
  }
  return { ...ctx, services };
}

async function insertNotificationJobs(
  tx: Tx,
  args: {
    storeId: string;
    storeName: string;
    appointmentId: string;
    customer: { id: string; name: string; phone: string; lineUserId: string | null };
    staffName: string;
    startMs: number;
    serviceNames: { nameZh: string; nameJa: string }[];
    totalPriceJpy: number;
    bookingCode: string;
    types: { type: NotificationType; scheduledMs: number }[];
    lineConfigured: boolean;
  },
): Promise<string[]> {
  const ids: string[] = [];
  const channel = args.customer.lineUserId && args.lineConfigured ? "line" : "mock";
  const recipient = channel === "line" ? args.customer.lineUserId : args.customer.phone;
  for (const t of args.types) {
    const [row] = await tx
      .insert(schema.notificationJobs)
      .values({
        storeId: args.storeId,
        appointmentId: args.appointmentId,
        customerId: args.customer.id,
        type: t.type,
        channel,
        recipient,
        scheduledAt: new Date(t.scheduledMs),
        payload: {
          bookingCode: args.bookingCode,
          customerName: args.customer.name,
          staffName: args.staffName,
          storeName: args.storeName,
          startAt: toIso(args.startMs),
          services: args.serviceNames,
          totalPriceJpy: args.totalPriceJpy,
        },
      })
      .returning({ id: schema.notificationJobs.id });
    if (row) ids.push(row.id);
  }
  return ids;
}

function reminderTypes(startMs: number, offsets: number[]): { type: NotificationType; scheduledMs: number }[] {
  const now = Date.now();
  const out: { type: NotificationType; scheduledMs: number }[] = [];
  for (const off of offsets) {
    const at = startMs - off * MIN;
    if (at > now) out.push({ type: off >= 720 ? "reminder_1day" : "reminder_3hours", scheduledMs: at });
  }
  return out;
}

/** Enforce online booking lead and horizon at commit time (including reschedules). */
export function assertOnlineBookingWindow(startMs: number, settings: { minLeadMinutes: number; bookingWindowDays: number }, now = Date.now()): void {
  if (!Number.isFinite(startMs) || startMs < now + settings.minLeadMinutes * MIN) {
    throw err.validation("Start time is too soon", { code: "LEAD_TIME" });
  }
  if (startMs > now + settings.bookingWindowDays * 24 * 60 * MIN) {
    throw err.validation("Start time is beyond the booking window", { code: "WINDOW" });
  }
}

export interface CreateBookingInput {
  storeId: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  staffId?: string;
  startMs: number;
  selections: ServiceSelection[];
  source: "online" | "admin" | "phone" | "walkin";
  locale: Locale;
  customerNote?: string;
  internalNote?: string;
  actorUserId?: string | null;
  /** UUID from the caller; reused verbatim only for retries of the same request. */
  idempotencyKey?: string;
  ip?: string | null;
  /** 顾客端为 true：执行最晚提前预约/可约窗口校验；店内登记为 false */
  enforceLeadRules?: boolean;
}

async function notifyCommittedJobs(notifier: Notifier, ids: string[]): Promise<void> {
  // notification_jobs are durable. A wake-up failure must never turn a committed booking into HTTP 500.
  for (const id of ids) {
    try { await notifier.enqueue(id); }
    catch (error) { console.error("Notification wake-up failed; database worker will retry", error); }
  }
}

export async function createBooking(
  db: Database,
  notifier: Notifier,
  input: CreateBookingInput,
): Promise<AppointmentDto> {
  let createdId = "";
  let jobIds: string[] = [];
  const fingerprint = input.idempotencyKey ? bookingFingerprint(input) : null;
  try {
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Tx;
      await storeLock(tx, input.storeId);
      // Check BEFORE availability and lead-time rules: a lost 201 response may be retried
      // after the chosen slot has passed. Serialized by the same store lock as inserts.
      if (input.idempotencyKey) {
        const [existing] = await tx.select({
          id: schema.appointments.id,
          fingerprint: schema.appointments.idempotencyFingerprint,
        }).from(schema.appointments).where(and(
          eq(schema.appointments.storeId, input.storeId),
          eq(schema.appointments.idempotencyKey, input.idempotencyKey),
        ));
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw err.conflict("Idempotency key reused for a different booking request");
          }
          createdId = existing.id;
          return; // Replayed booking: no duplicate ledger, allocation, audit or notifications.
        }
      }
      const [store] = await tx.select().from(schema.stores).where(eq(schema.stores.id, input.storeId));
      if (!store) throw err.notFound("Store not found");
      const settings = storeSettingsOf(store.settings);

      if (input.enforceLeadRules) assertOnlineBookingWindow(input.startMs, settings);

      const { resolved, ctxPatch } = await resolveSelections(tx, input.storeId, input.selections);
      const date = tokyoDateOf(input.startMs);
      const ctx = patchContext(await buildContextForDate(tx, input.storeId, date), ctxPatch);

      // 候选技师：指定则只查一人；不指定按当日已有预约数从少到多（负载均衡）
      const serviceIds = input.selections.map((s) => s.serviceId);
      let candidates: string[];
      if (input.staffId) {
        candidates = [input.staffId];
      } else {
        const load = new Map<string, number>();
        for (const b of ctx.staffBusy) load.set(b.staffId, (load.get(b.staffId) ?? 0) + 1);
        candidates = ctx.staff
          .filter((s) => serviceIds.every((id) => s.skillServiceIds.includes(id)))
          .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id))
          .map((s) => s.id);
        if (candidates.length === 0) {
          throw err.conflict("No staff can perform the selected services", [{ code: "skill_missing" }]);
        }
      }

      let chosen: { staffId: string; result: Extract<ReturnType<typeof validatePlacement>, { ok: true }> } | null = null;
      let firstConflicts: unknown = null;
      for (const staffId of candidates) {
        const res = validatePlacement(ctx, { staffId, serviceIds, startMs: input.startMs });
        if (res.ok) {
          chosen = { staffId, result: res };
          break;
        }
        firstConflicts ??= res.conflicts;
      }
      if (!chosen) throw err.conflict("The requested time is not available", firstConflicts);

      // 客户：按 id 或 (门店, 手机号) 命中已有档案，否则新建
      let customer: typeof schema.customers.$inferSelect | undefined;
      if (input.customerId) {
        [customer] = await tx
          .select()
          .from(schema.customers)
          .where(and(eq(schema.customers.id, input.customerId), eq(schema.customers.storeId, input.storeId)));
        if (!customer) throw err.notFound("Customer not found");
      } else {
        if (!input.customerPhone || !input.customerName) {
          throw err.validation("Customer name and phone are required");
        }
        [customer] = await tx
          .select()
          .from(schema.customers)
          .where(and(eq(schema.customers.storeId, input.storeId), eq(schema.customers.phone, input.customerPhone)));
        if (!customer) {
          [customer] = await tx
            .insert(schema.customers)
            .values({
              storeId: input.storeId,
              name: input.customerName,
              phone: input.customerPhone,
              email: input.customerEmail ?? null,
            })
            .returning();
        }
      }
      if (!customer) throw err.internal("Customer resolution failed");

      let bookingCode = genBookingCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const [exists] = await tx
          .select({ id: schema.appointments.id })
          .from(schema.appointments)
          .where(and(eq(schema.appointments.storeId, input.storeId), eq(schema.appointments.bookingCode, bookingCode)));
        if (!exists) break;
        bookingCode = genBookingCode();
      }

      const { result } = chosen;
      const [appt] = await tx
        .insert(schema.appointments)
        .values({
          storeId: input.storeId,
          customerId: customer.id,
          staffId: chosen.staffId,
          status: "booked",
          startAt: new Date(input.startMs),
          endAt: new Date(result.customerEndMs),
          blockedEndAt: new Date(result.blockedEndMs),
          bookingCode,
          idempotencyKey: input.idempotencyKey ?? null,
          idempotencyFingerprint: fingerprint,
          source: input.source,
          locale: input.locale,
          customerNote: input.customerNote ?? null,
          internalNote: input.internalNote ?? null,
          totalPriceJpy: result.plan.totalPriceJpy,
        })
        .returning();
      if (!appt) throw err.internal("Appointment insert failed");
      createdId = appt.id;

      // 项目明细（快照）+ 占用行
      const svcNameRows = await tx
        .select()
        .from(schema.services)
        .where(inArray(schema.services.id, serviceIds));
      const svcNameById = new Map(svcNameRows.map((s) => [s.id, s]));
      for (let i = 0; i < result.plan.segments.length; i++) {
        const seg = result.plan.segments[i]!;
        const sel = resolved[i]!;
        const segStart = input.startMs + seg.offsetStartMin * MIN;
        const segEnd = segStart + seg.durationMinutes * MIN;
        await tx.insert(schema.appointmentServices).values({
          appointmentId: appt.id,
          serviceId: seg.serviceId,
          position: i,
          startAt: new Date(segStart),
          endAt: new Date(segEnd),
          priceSnapshotJpy: sel.effectivePrice,
          durationSnapshotMin: sel.effectiveDuration,
          bufferSnapshotMin: seg.bufferMinutes,
          resourceTypeSnapshot: seg.resourceType,
          addonsSnapshot: sel.addons,
        });
        const resourceId = result.resourceIds[i];
        if (resourceId) {
          await tx.insert(schema.resourceAllocations).values({
            appointmentId: appt.id,
            resourceId,
            startAt: new Date(segStart),
            endAt: new Date(segEnd + seg.bufferMinutes * MIN),
          });
        }
      }
      await tx.insert(schema.resourceAllocations).values({
        appointmentId: appt.id,
        staffId: chosen.staffId,
        startAt: new Date(input.startMs),
        endAt: new Date(result.blockedEndMs),
      });

      const [staffRow] = await tx.select().from(schema.staff).where(eq(schema.staff.id, chosen.staffId));
      jobIds = await insertNotificationJobs(tx, {
        storeId: input.storeId,
        storeName: store.name,
        appointmentId: appt.id,
        customer: { id: customer.id, name: customer.name, phone: customer.phone, lineUserId: customer.lineUserId },
        staffName: staffRow?.name ?? "",
        startMs: input.startMs,
        serviceNames: serviceIds.map((id) => ({
          nameZh: svcNameById.get(id)?.nameZh ?? "",
          nameJa: svcNameById.get(id)?.nameJa ?? "",
        })),
        totalPriceJpy: result.plan.totalPriceJpy,
        bookingCode,
        types: [
          { type: "booking_created", scheduledMs: Date.now() },
          ...reminderTypes(input.startMs, settings.reminderOffsetsMinutes),
        ],
        lineConfigured: settings.lineConfigured,
      });

      await tx.insert(schema.auditLogs).values({
        storeId: input.storeId,
        actorUserId: input.actorUserId ?? null,
        action: "appointment.create",
        entityType: "appointment",
        entityId: appt.id,
        ip: input.ip ?? null,
        details: redact({ bookingCode, staffId: chosen.staffId, startAt: toIso(input.startMs), source: input.source }) as Record<string, unknown>,
      });
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw err.conflict("The requested time was just taken", [{ code: "staff_busy" }]);
    throw e;
  }
  await notifyCommittedJobs(notifier, jobIds);
  return getAppointmentDto(db, createdId);
}

function isExclusionViolation(e: unknown): boolean {
  const anyE = e as { code?: string; cause?: { code?: string } };
  return anyE?.code === "23P01" || anyE?.cause?.code === "23P01";
}

export async function cancelBooking(
  db: Database,
  notifier: Notifier,
  args: {
    appointmentId: string;
    storeId: string;
    reason?: string;
    onlineCancellation?: boolean;
    actorUserId?: string | null;
    ip?: string | null;
  },
): Promise<AppointmentDto> {
  let jobIds: string[] = [];
  let alreadyCancelled = false;
  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Tx;
    await storeLock(tx, args.storeId);
    const [appt] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, args.appointmentId));
    if (!appt || appt.storeId !== args.storeId) throw err.notFound("Appointment not found");
    if (appt.status === "cancelled") {
      alreadyCancelled = true;
      return;
    }
    if (appt.status === "completed" || (args.onlineCancellation && !["booked", "confirmed"].includes(appt.status))) {
      throw err.validation("This appointment can no longer be cancelled online");
    }
    await tx
      .update(schema.appointments)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: args.reason ?? null, updatedAt: new Date() })
      .where(eq(schema.appointments.id, appt.id));
    await tx
      .update(schema.resourceAllocations)
      .set({ active: false })
      .where(eq(schema.resourceAllocations.appointmentId, appt.id));
    await tx
      .update(schema.notificationJobs)
      .set({ status: "skipped" })
      .where(
        and(
          eq(schema.notificationJobs.appointmentId, appt.id),
          eq(schema.notificationJobs.status, "queued"),
          inArray(schema.notificationJobs.type, ["reminder_1day", "reminder_3hours"]),
        ),
      );
    const [store] = await tx.select().from(schema.stores).where(eq(schema.stores.id, args.storeId));
    const [customer] = await tx.select().from(schema.customers).where(eq(schema.customers.id, appt.customerId));
    const [staffRow] = await tx.select().from(schema.staff).where(eq(schema.staff.id, appt.staffId));
    const svcRows = await tx
      .select({ nameZh: schema.services.nameZh, nameJa: schema.services.nameJa })
      .from(schema.appointmentServices)
      .innerJoin(schema.services, eq(schema.appointmentServices.serviceId, schema.services.id))
      .where(eq(schema.appointmentServices.appointmentId, appt.id));
    if (store && customer) {
      jobIds = await insertNotificationJobs(tx, {
        storeId: args.storeId,
        storeName: store.name,
        appointmentId: appt.id,
        customer: { id: customer.id, name: customer.name, phone: customer.phone, lineUserId: customer.lineUserId },
        staffName: staffRow?.name ?? "",
        startMs: appt.startAt.getTime(),
        serviceNames: svcRows,
        totalPriceJpy: appt.totalPriceJpy,
        bookingCode: appt.bookingCode,
        types: [{ type: "booking_cancelled", scheduledMs: Date.now() }],
        lineConfigured: storeSettingsOf(store.settings).lineConfigured,
      });
    }
    await tx.insert(schema.auditLogs).values({
      storeId: args.storeId,
      actorUserId: args.actorUserId ?? null,
      action: "appointment.cancel",
      entityType: "appointment",
      entityId: appt.id,
      ip: args.ip ?? null,
      details: redact({ reason: args.reason ?? null }) as Record<string, unknown>,
    });
  });
  if (!alreadyCancelled) await notifyCommittedJobs(notifier, jobIds);
  return getAppointmentDto(db, args.appointmentId);
}

export async function rescheduleBooking(
  db: Database,
  notifier: Notifier,
  args: {
    appointmentId: string;
    storeId: string;
    newStartMs: number;
    newStaffId?: string;
    enforceLeadRules?: boolean;
    actorUserId?: string | null;
    ip?: string | null;
  },
): Promise<AppointmentDto> {
  let jobIds: string[] = [];
  try {
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Tx;
      await storeLock(tx, args.storeId);
      const [appt] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, args.appointmentId));
      if (!appt || appt.storeId !== args.storeId) throw err.notFound("Appointment not found");
      if (appt.status !== "booked" && appt.status !== "confirmed") {
        throw err.validation(`Cannot reschedule an appointment in status ${appt.status}`);
      }
      const [store] = await tx.select().from(schema.stores).where(eq(schema.stores.id, args.storeId));
      if (!store) throw err.notFound("Store not found");
      const settings = storeSettingsOf(store.settings);
      if (args.enforceLeadRules) assertOnlineBookingWindow(args.newStartMs, settings);

      // 用原订单的项目与附加项快照重建选择（价格按快照，不受后续改价影响）
      const existing = await tx
        .select()
        .from(schema.appointmentServices)
        .where(eq(schema.appointmentServices.appointmentId, appt.id))
        .orderBy(asc(schema.appointmentServices.position));
      const selections: ServiceSelection[] = existing.map((s) => ({
        serviceId: s.serviceId,
        addonIds: ((s.addonsSnapshot as AddonSnapshot[]) ?? []).map((a) => a.id),
      }));
      const { ctxPatch } = await resolveSelections(tx, args.storeId, selections);
      // 覆盖为快照时长/价格：改期不重新计价
      for (const s of existing) {
        ctxPatch.set(s.serviceId, { durationMinutes: s.durationSnapshotMin, priceJpy: s.priceSnapshotJpy });
      }
      const serviceIds = selections.map((s) => s.serviceId);
      const date = tokyoDateOf(args.newStartMs);
      const ctx = patchContext(await buildContextForDate(tx, args.storeId, date), ctxPatch);
      const staffId = args.newStaffId ?? appt.staffId;
      const res = validatePlacement(ctx, {
        staffId,
        serviceIds,
        startMs: args.newStartMs,
        ignoreAppointmentId: appt.id,
      });
      if (!res.ok) throw err.conflict("The requested time is not available", res.conflicts);

      await tx
        .update(schema.resourceAllocations)
        .set({ active: false })
        .where(eq(schema.resourceAllocations.appointmentId, appt.id));
      await tx
        .update(schema.appointments)
        .set({
          staffId,
          startAt: new Date(args.newStartMs),
          endAt: new Date(res.customerEndMs),
          blockedEndAt: new Date(res.blockedEndMs),
          updatedAt: new Date(),
        })
        .where(eq(schema.appointments.id, appt.id));
      for (let i = 0; i < res.plan.segments.length; i++) {
        const seg = res.plan.segments[i]!;
        const old = existing[i]!;
        const segStart = args.newStartMs + seg.offsetStartMin * MIN;
        const segEnd = segStart + seg.durationMinutes * MIN;
        await tx
          .update(schema.appointmentServices)
          .set({ startAt: new Date(segStart), endAt: new Date(segEnd) })
          .where(eq(schema.appointmentServices.id, old.id));
        const resourceId = res.resourceIds[i];
        if (resourceId) {
          await tx.insert(schema.resourceAllocations).values({
            appointmentId: appt.id,
            resourceId,
            startAt: new Date(segStart),
            endAt: new Date(segEnd + seg.bufferMinutes * MIN),
          });
        }
      }
      await tx.insert(schema.resourceAllocations).values({
        appointmentId: appt.id,
        staffId,
        startAt: new Date(args.newStartMs),
        endAt: new Date(res.blockedEndMs),
      });

      // 旧提醒作废，按新时间重建
      await tx
        .update(schema.notificationJobs)
        .set({ status: "skipped" })
        .where(
          and(
            eq(schema.notificationJobs.appointmentId, appt.id),
            eq(schema.notificationJobs.status, "queued"),
            inArray(schema.notificationJobs.type, ["reminder_1day", "reminder_3hours"]),
          ),
        );
      const [customer] = await tx.select().from(schema.customers).where(eq(schema.customers.id, appt.customerId));
      const [staffRow] = await tx.select().from(schema.staff).where(eq(schema.staff.id, staffId));
      const svcRows = await tx
        .select({ nameZh: schema.services.nameZh, nameJa: schema.services.nameJa })
        .from(schema.appointmentServices)
        .innerJoin(schema.services, eq(schema.appointmentServices.serviceId, schema.services.id))
        .where(eq(schema.appointmentServices.appointmentId, appt.id));
      if (customer) {
        jobIds = await insertNotificationJobs(tx, {
          storeId: args.storeId,
          storeName: store.name,
          appointmentId: appt.id,
          customer: { id: customer.id, name: customer.name, phone: customer.phone, lineUserId: customer.lineUserId },
          staffName: staffRow?.name ?? "",
          startMs: args.newStartMs,
          serviceNames: svcRows,
          totalPriceJpy: appt.totalPriceJpy,
          bookingCode: appt.bookingCode,
          types: [
            { type: "booking_rescheduled", scheduledMs: Date.now() },
            ...reminderTypes(args.newStartMs, settings.reminderOffsetsMinutes),
          ],
          lineConfigured: settings.lineConfigured,
        });
      }
      await tx.insert(schema.auditLogs).values({
        storeId: args.storeId,
        actorUserId: args.actorUserId ?? null,
        action: "appointment.reschedule",
        entityType: "appointment",
        entityId: appt.id,
        ip: args.ip ?? null,
        details: redact({
          from: toIso(appt.startAt.getTime()),
          to: toIso(args.newStartMs),
          staffId,
        }) as Record<string, unknown>,
      });
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw err.conflict("The requested time was just taken", [{ code: "staff_busy" }]);
    throw e;
  }
  await notifyCommittedJobs(notifier, jobIds);
  return getAppointmentDto(db, args.appointmentId);
}

export const STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ["confirmed", "arrived", "cancelled", "no_show"],
  confirmed: ["arrived", "cancelled", "no_show"],
  arrived: ["in_service", "cancelled"],
  in_service: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};
