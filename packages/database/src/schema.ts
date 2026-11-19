import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Beauty Salon OS 数据库 schema（PostgreSQL）。
 * 约定：
 * - 所有绝对时刻用 timestamptz（存 UTC，业务语义按 Asia/Tokyo 在应用层换算）；
 * - 排班/营业时间用“当地日期 + 当地时刻”的业务语义存储，避免夏令时/时区漂移；
 * - 金额一律整数日元；预约保存价格/时长快照，后续改价不影响历史订单。
 */

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  timezone: text("timezone").notNull().default("Asia/Tokyo"),
  phone: text("phone"),
  address: text("address"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const businessHours = pgTable(
  "business_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    /** 1=周一 … 7=周日 */
    weekday: integer("weekday").notNull(),
    openTime: time("open_time").notNull().default("10:00"),
    closeTime: time("close_time").notNull().default("20:00"),
    isClosed: boolean("is_closed").notNull().default(false),
  },
  (t) => [uniqueIndex("business_hours_store_weekday").on(t.storeId, t.weekday)],
);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // owner | manager | staff
  permissions: jsonb("permissions").notNull().default([]),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(), // owner | manager | staff
    name: text("name").notNull(),
    staffId: uuid("staff_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

/** V4: revocable server-side sessions. JWT jti references this table; old bearer tokens are invalid. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId), index("auth_sessions_expiry_idx").on(t.expiresAt)],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameKana: text("name_kana"),
    phone: text("phone").notNull(),
    email: text("email"),
    lineUserId: text("line_user_id"),
    notes: text("notes"),
    tags: jsonb("tags").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customers_store_phone_unique").on(t.storeId, t.phone),
    index("customers_store_name_idx").on(t.storeId, t.name),
  ],
);

export const staff = pgTable(
  "staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameJa: text("name_ja"),
    /** 日历上该技师的颜色（预约块按项目着色时作为辅助色条） */
    color: text("color").notNull().default("#3b82f6"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("staff_store_idx").on(t.storeId)],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // nail | lash | beauty | other
    nameZh: text("name_zh").notNull(),
    nameJa: text("name_ja").notNull(),
    descriptionZh: text("description_zh"),
    descriptionJa: text("description_ja"),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferMinutes: integer("buffer_minutes").notNull().default(10),
    priceJpy: integer("price_jpy").notNull(),
    resourceType: text("resource_type"), // nail_table | lash_bed | beauty_bed | chair | room | null
    color: text("color").notNull().default("#60a5fa"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("services_store_idx").on(t.storeId)],
);

export const serviceAddons = pgTable(
  "service_addons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
    nameZh: text("name_zh").notNull(),
    nameJa: text("name_ja").notNull(),
    priceJpy: integer("price_jpy").notNull().default(0),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("service_addons_service_idx").on(t.serviceId)],
);

export const staffSkills = pgTable(
  "staff_skills",
  {
    staffId: uuid("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("staff_skills_pk").on(t.staffId, t.serviceId)],
);

export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // nail_table | lash_bed | beauty_bed | chair | room
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("resources_store_idx").on(t.storeId)],
);

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
    /** 业务当地日期（Asia/Tokyo） */
    date: date("date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shifts_store_date_idx").on(t.storeId, t.date),
    index("shifts_staff_date_idx").on(t.staffId, t.date),
  ],
);

export const shiftBreaks = pgTable(
  "shift_breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shiftId: uuid("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [index("shift_breaks_shift_idx").on(t.shiftId)],
);

export const blockedTimes = pgTable(
  "blocked_times",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // leave | sick | training | maintenance | other
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("blocked_times_store_range_idx").on(t.storeId, t.startAt, t.endAt)],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    staffId: uuid("staff_id").notNull().references(() => staff.id),
    status: text("status").notNull().default("booked"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    /** 顾客离店时间（不含尾部清洁缓冲） */
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    /** 含尾部清洁缓冲的完整占用结束时间 */
    blockedEndAt: timestamp("blocked_end_at", { withTimezone: true }).notNull(),
    bookingCode: text("booking_code").notNull(),
    /** V7: identical confirmed requests return the same appointment after a lost response. */
    idempotencyKey: uuid("idempotency_key"),
    idempotencyFingerprint: text("idempotency_fingerprint"),
    source: text("source").notNull().default("online"), // online | admin | phone | walkin
    locale: text("locale").notNull().default("ja"),
    customerNote: text("customer_note"),
    internalNote: text("internal_note"),
    serviceNote: text("service_note"),
    totalPriceJpy: integer("total_price_jpy").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("appointments_store_code_unique").on(t.storeId, t.bookingCode),
    uniqueIndex("appointments_store_idempotency_unique").on(t.storeId, t.idempotencyKey),
    index("appointments_store_start_idx").on(t.storeId, t.startAt),
    index("appointments_staff_start_idx").on(t.staffId, t.startAt),
    index("appointments_customer_idx").on(t.customerId),
  ],
);

export const appointmentServices = pgTable(
  "appointment_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => services.id),
    position: integer("position").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    /** 预约时的价格/时长快照，之后改价不影响本单 */
    priceSnapshotJpy: integer("price_snapshot_jpy").notNull(),
    durationSnapshotMin: integer("duration_snapshot_min").notNull(),
    bufferSnapshotMin: integer("buffer_snapshot_min").notNull(),
    resourceTypeSnapshot: text("resource_type_snapshot"),
    addonsSnapshot: jsonb("addons_snapshot").notNull().default([]),
  },
  (t) => [index("appointment_services_appt_idx").on(t.appointmentId)],
);

/**
 * 占用记录：技师占用（staff_id 非空）与工位占用（resource_id 非空）统一一张表。
 * 另有手写迁移为它加 tstzrange 生成列 + 两条部分排斥约束（EXCLUDE USING gist），
 * 作为并发防重复预约的最后一道数据库级防线：同一技师/同一工位的时间段绝不重叠。
 */
export const resourceAllocations = pgTable(
  "resource_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("allocations_appt_idx").on(t.appointmentId),
    index("allocations_staff_range_idx").on(t.staffId, t.startAt, t.endAt),
    index("allocations_resource_range_idx").on(t.resourceId, t.startAt, t.endAt),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** 退款记录为负数；净营业额 = SUM(amount_jpy) */
    amountJpy: integer("amount_jpy").notNull(),
    method: text("method").notNull(), // cash | card | paypay | line_pay | bank_transfer | other
    status: text("status").notNull().default("paid"), // paid | refunded | partially_refunded（仅正额原单）
    refundOfId: uuid("refund_of_id"),
    /** V12: stable operation UUID for safe retry of a receipt or refund. Nullable for legacy rows. */
    idempotencyKey: uuid("idempotency_key"),
    /** SHA-256 of canonical intent, without raw personal data or tokens stored in this column. */
    idempotencyFingerprint: text("idempotency_fingerprint"),
    /** 合规支付服务商的外部交易号（本系统不保存任何银行卡信息） */
    providerRef: text("provider_ref"),
    note: text("note"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_store_paid_idx").on(t.storeId, t.paidAt),
    index("payments_appt_idx").on(t.appointmentId),
    uniqueIndex("payments_store_idempotency_key_unique").on(t.storeId, t.idempotencyKey),
    check("payments_idempotency_pair_check", sql`(
      (${t.idempotencyKey} IS NULL AND ${t.idempotencyFingerprint} IS NULL)
      OR (${t.idempotencyKey} IS NOT NULL AND ${t.idempotencyFingerprint} IS NOT NULL)
    )`),
  ],
);

/** Each store/business date can only be closed once; closing is append-only in the API. */
export const cashCloses = pgTable(
  "cash_closes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    openingCashJpy: integer("opening_cash_jpy").notNull(),
    countedCashJpy: integer("counted_cash_jpy").notNull(),
    expectedCashJpy: integer("expected_cash_jpy").notNull(),
    varianceJpy: integer("variance_jpy").notNull(),
    receivedJpy: bigint("received_jpy", { mode: "number" }).notNull(),
    refundedJpy: bigint("refunded_jpy", { mode: "number" }).notNull(),
    netJpy: bigint("net_jpy", { mode: "number" }).notNull(),
    cashNetJpy: bigint("cash_net_jpy", { mode: "number" }).notNull(),
    transactionCount: integer("transaction_count").notNull(),
    methodTotals: jsonb("method_totals").notNull(),
    note: text("note"),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cash_closes_store_day_unique").on(t.storeId, t.businessDate)],
);

export const notificationJobs = pgTable(
  "notification_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // booking_created | booking_cancelled | booking_rescheduled | reminder_1day | reminder_3hours
    channel: text("channel").notNull().default("mock"), // line | email | sms | mock
    recipient: text("recipient"),
    payload: jsonb("payload").notNull().default({}),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("queued"), // queued | sending | sent | failed | skipped
    attempts: integer("attempts").notNull().default(0),
    sendingStartedAt: timestamp("sending_started_at", { withTimezone: true }),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notification_jobs_due_idx").on(t.status, t.scheduledAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    ip: text("ip"),
    /** 脱敏后的变更摘要：绝不写入密码、令牌、完整手机号等敏感信息 */
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_store_created_idx").on(t.storeId, t.createdAt)],
);

/** V2: append-only salon care notes. Never expose through the public booking API. */
export const careRecords = pgTable(
  "care_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    category: text("category").notNull(), // nail | lash | beauty
    /** Non-diagnostic salon service notes, category-specific fields validated by API. */
    details: jsonb("details").notNull().default({}),
    memo: text("memo"),
    authoredBy: uuid("authored_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("care_records_customer_created_idx").on(t.storeId, t.customerId, t.createdAt),
    check("care_records_category_ck", sql`${t.category} IN ('nail', 'lash', 'beauty')`),
  ],
);
