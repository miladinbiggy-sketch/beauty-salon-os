import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, schema, type DbHandle } from "@salon/database";
import { claimJobById, processDueJobs } from "./processor.js";
import { renderMessage } from "./senders.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://salon@127.0.0.1:55432/salon_test";

let handle: DbHandle;
let storeId: string;
let customerId: string;
let staffId: string;

beforeAll(async () => {
  handle = createDb(TEST_DB_URL);
  await migrate(handle.db, { migrationsFolder: new URL("../../../packages/database/migrations", import.meta.url).pathname });
  const [store] = await handle.db.insert(schema.stores).values({ name: "Worker测试店" }).returning();
  storeId = store!.id;
  const [customer] = await handle.db.insert(schema.customers).values({ storeId, name: "测试顾客", phone: "09000000001" }).returning();
  const [staff] = await handle.db.insert(schema.staff).values({ storeId, name: "测试技师" }).returning();
  customerId = customer!.id;
  staffId = staff!.id;
});

afterAll(async () => {
  await handle.db.delete(schema.notificationJobs).where(eq(schema.notificationJobs.storeId, storeId));
  await handle.db.delete(schema.appointments).where(eq(schema.appointments.storeId, storeId));
  await handle.db.delete(schema.customers).where(eq(schema.customers.storeId, storeId));
  await handle.db.delete(schema.staff).where(eq(schema.staff.storeId, storeId));
  await handle.db.delete(schema.stores).where(eq(schema.stores.id, storeId));
  await handle.close();
});

async function insertJob(overrides: Partial<typeof schema.notificationJobs.$inferInsert> = {}) {
  const [row] = await handle.db
    .insert(schema.notificationJobs)
    .values({
      storeId,
      type: "booking_created",
      channel: "mock",
      recipient: "09000000000",
      scheduledAt: new Date(Date.now() - 1000),
      payload: {
        bookingCode: "TEST1234",
        customerName: "テスト",
        storeName: "Worker测试店",
        startAt: "2027-01-15T01:00:00.000Z",
        services: [{ nameZh: "凝胶美甲", nameJa: "ジェルネイル" }],
        totalPriceJpy: 7500,
      },
      ...overrides,
    })
    .returning();
  return row!;
}

describe("通知 Worker", () => {
  it("mock 通知被记录为 skipped 而非假装发送成功", async () => {
    const job = await insertJob();
    const n = await processDueJobs(handle.db, undefined);
    expect(n).toBeGreaterThanOrEqual(1);
    const [after] = await handle.db
      .select()
      .from(schema.notificationJobs)
      .where(eq(schema.notificationJobs.id, job.id));
    expect(after!.status).toBe("skipped");
    expect(after!.sentAt).toBeNull();
    expect(after!.lastError).toContain("mock delivery");
    expect(after!.attempts).toBe(1);
  });

  it("未到期任务不被领取", async () => {
    const job = await insertJob({ scheduledAt: new Date(Date.now() + 3600_000) });
    await processDueJobs(handle.db, undefined);
    const [after] = await handle.db
      .select()
      .from(schema.notificationJobs)
      .where(eq(schema.notificationJobs.id, job.id));
    expect(after!.status).toBe("queued");
    await handle.db.delete(schema.notificationJobs).where(eq(schema.notificationJobs.id, job.id));
  });

  it("channel=line 但未配置 token：永久失败而非盲目重试，记录原因", async () => {
    const job = await insertJob({ channel: "line", recipient: "Uxxxxxxxx" });
    await processDueJobs(handle.db, undefined);
    const [after] = await handle.db
      .select()
      .from(schema.notificationJobs)
      .where(eq(schema.notificationJobs.id, job.id));
    expect(after!.status).toBe("failed"); // 缺少凭据不会通过重复尝试自行恢复
    expect(after!.attempts).toBe(1);
    expect(after!.lastError).toContain("LINE_CHANNEL_ACCESS_TOKEN");
    await handle.db.delete(schema.notificationJobs).where(eq(schema.notificationJobs.id, job.id));
  });

  it("文案渲染包含预约码、日文项目名与金额", () => {
    const text = renderMessage({
      id: "x",
      type: "reminder_1day",
      channel: "mock",
      recipient: null,
      payload: {
        bookingCode: "ABCD2345",
        storeName: "Salon",
        startAt: "2027-01-15T01:00:00.000Z",
        services: [{ nameZh: "凝胶美甲", nameJa: "ジェルネイル" }],
        totalPriceJpy: 7500,
      },
    });
    expect(text).toContain("明日のご予約");
    expect(text).toContain("明日预约提醒");
    expect(text).toContain("ABCD2345");
    expect(text).toContain("ジェルネイル");
    expect(text).toContain("凝胶美甲");
    expect(text).toContain("¥7,500");
  });

  it("claim returns a typed scheduledAt and records first attempt/lease", async () => {
    const job = await insertJob({ scheduledAt: new Date(Date.now() - 10_000) });
    const claimed = await claimJobById(handle.db, job.id);
    expect(claimed).not.toBeNull();
    expect(claimed!.scheduledAt).toBeInstanceOf(Date);
    expect(claimed!.firstAttemptAt).toBeInstanceOf(Date);
    expect(claimed!.sendingStartedAt).toBeInstanceOf(Date);
    expect(claimed!.attempts).toBe(1);
    await handle.db.delete(schema.notificationJobs).where(eq(schema.notificationJobs.id, job.id));
  });

  it("已取消预约的排队提醒被抑制，不触发 LINE 或发送尝试", async () => {
    const start = new Date("2027-03-15T01:00:00.000Z");
    const [appointment] = await handle.db.insert(schema.appointments).values({
      storeId, customerId, staffId, status: "cancelled", startAt: start,
      endAt: new Date(start.getTime() + 3600_000), blockedEndAt: new Date(start.getTime() + 3600_000),
      bookingCode: "WORKV10A", totalPriceJpy: 8000,
    }).returning();
    const job = await insertJob({ appointmentId: appointment!.id, channel: "line", recipient: "Uxxx", type: "reminder_1day" });
    await processDueJobs(handle.db, undefined);
    const [after] = await handle.db.select().from(schema.notificationJobs).where(eq(schema.notificationJobs.id, job.id));
    expect(after!.status).toBe("skipped");
    expect(after!.lastError).toContain("stale notice");
    expect(after!.sentAt).toBeNull();
  });

  it("改期后旧提醒被抑制，且队列记录不被误报送达", async () => {
    const start = new Date("2027-03-16T01:00:00.000Z");
    const [appointment] = await handle.db.insert(schema.appointments).values({
      storeId, customerId, staffId, status: "confirmed", startAt: start,
      endAt: new Date(start.getTime() + 3600_000), blockedEndAt: new Date(start.getTime() + 3600_000),
      bookingCode: "WORKV10B", totalPriceJpy: 8000,
    }).returning();
    const job = await insertJob({ appointmentId: appointment!.id, channel: "line", recipient: "Uxxx", type: "reminder_3hours" });
    await processDueJobs(handle.db, undefined);
    const [after] = await handle.db.select().from(schema.notificationJobs).where(eq(schema.notificationJobs.id, job.id));
    expect(after!.status).toBe("skipped");
    expect(after!.sentAt).toBeNull();
  });

});
