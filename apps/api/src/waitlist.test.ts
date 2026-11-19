import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, hashPassword, schema, type DbHandle } from "@salon/database";
import { DEFAULT_STORE_SETTINGS } from "@salon/shared";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createNotifier } from "./queue.js";

/**
 * V14 等候名单 （等候名单/キャンセル待ち）集成测试：真实 PostgreSQL。
 * 等候条目只是"请联系我"的请求，不是预约——不占任何工位/技师时段。
 */
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://salon:salon@127.0.0.1:55432/salon_test";

const DATE = "2027-06-15";
const DATE2 = "2027-06-16";

let handle: DbHandle;
let app: ReturnType<typeof buildApp>;
let storeId: string;
let otherStoreId: string;
let svcGel: string;
let svcLash: string;
let staffA: string;
let managerToken: string;
let staffToken: string;
let otherManagerToken: string;
let ipCounter = 5000;

async function req(path: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any; cookie: string | null }> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Cookie", init.token);
  if (init.token && init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) {
    headers.set("Origin", "http://localhost:5174");
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("x-forwarded-for", `10.9.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`);
  const res = await app.fetch(new Request(`http://test${path}`, { ...init, headers }));
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? null };
}
const post = (path: string, data: unknown, token?: string) =>
  req(path, { method: "POST", body: JSON.stringify(data), token });

async function login(email: string): Promise<string> {
  const r = await post("/auth/login", { email, password: "test1234" });
  expect(r.status).toBe(200);
  return r.cookie!;
}

const join = (over: Record<string, unknown> = {}) => post("/public/waitlist", {
  storeId, name: "等候客", phone: "09011112222",
  serviceId: svcGel, staffId: null,
  date: DATE, earliestTime: "13:00", latestTime: "16:00", ...over,
});

beforeAll(async () => {
  handle = createDb(TEST_DB_URL);
  const migrationsFolder = new URL("../../../packages/database/migrations", import.meta.url).pathname;
  await migrate(handle.db, { migrationsFolder });
  await handle.db.delete(schema.waitlistEntries);
  const db = handle.db;
  const settings = { ...DEFAULT_STORE_SETTINGS, minLeadMinutes: 0, bookingWindowDays: 3650 };
  const [store] = await db.insert(schema.stores).values({ name: "等候测试店", settings }).returning();
  storeId = store!.id;
  const [other] = await db.insert(schema.stores).values({ name: "等候他店", settings }).returning();
  otherStoreId = other!.id;
  const [gel] = await db.insert(schema.services).values({
    storeId, category: "nail", nameZh: "凝胶美甲", nameJa: "ジェル",
    durationMinutes: 60, bufferMinutes: 10, priceJpy: 7500, resourceType: "nail_table", color: "#f472b6",
  }).returning();
  svcGel = gel!.id;
  const [lash] = await db.insert(schema.services).values({
    storeId, category: "lash", nameZh: "美睫", nameJa: "まつげ",
    durationMinutes: 90, bufferMinutes: 15, priceJpy: 8900, resourceType: "lash_bed", color: "#a78bfa",
  }).returning();
  svcLash = lash!.id;
  const [a] = await db.insert(schema.staff).values({ storeId, name: "技师A", color: "#ec4899", sortOrder: 0 }).returning();
  staffA = a!.id;
  await db.insert(schema.customers).values({ storeId, name: "老顾客", phone: "09011112222" });
  const pw = hashPassword("test1234");
  await db.insert(schema.users).values([
    { storeId, email: "wl-manager@test.salon", passwordHash: pw, role: "manager", name: "店长" },
    { storeId, email: "wl-staff@test.salon", passwordHash: pw, role: "staff", name: "技师A", staffId: staffA },
    { storeId: otherStoreId, email: "wl-other@test.salon", passwordHash: pw, role: "manager", name: "他店长" },
  ]);
  const config = loadConfig({ DATABASE_URL: TEST_DB_URL, QUEUE_DRIVER: "db", TRUST_PROXY: "true", JWT_SECRET: "test-secret-test-secret-123456" });
  app = buildApp({ db, config, notifier: createNotifier(config) });
  managerToken = await login("wl-manager@test.salon");
  staffToken = await login("wl-staff@test.salon");
  otherManagerToken = await login("wl-other@test.salon");
});

afterAll(async () => { await handle.close(); });

describe("V14 等候名单：公开加入", () => {
  it("加入成功并自动关联同门店同手机号的老顾客", async () => {
    const r = await join();
    expect(r.status).toBe(201);
    expect(r.body.duplicate).toBe(false);
    expect(r.body.status).toBe("waiting");
    expect(r.body.customerId).toBeTruthy();
    expect(r.body.date).toBe(DATE);
  });

  it("重复加入返回同一条（幂等），不产生第二条", async () => {
    const first = await join({ phone: "09033334444" });
    expect(first.status).toBe(201);
    const again = await join({ phone: "09033334444" });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.id).toBe(first.body.id);
    const rows = await handle.db.select().from(schema.waitlistEntries)
      .where(eq(schema.waitlistEntries.phone, "09033334444"));
    expect(rows).toHaveLength(1);
  });

  it("校验：过去的日期、时间窗倒置、他店服务、不存在的门店", async () => {
    expect((await join({ phone: "09055550001", date: "2020-01-01" })).status).toBe(400);
    expect((await join({ phone: "09055550002", earliestTime: "16:00", latestTime: "13:00" })).status).toBe(400);
    const [foreign] = await handle.db.insert(schema.services).values({
      storeId: otherStoreId, category: "nail", nameZh: "他店服务", nameJa: "他店",
      durationMinutes: 30, bufferMinutes: 0, priceJpy: 1000, resourceType: "nail_table", color: "#000000",
    }).returning();
    expect((await join({ phone: "09055550003", serviceId: foreign!.id })).status).toBe(400);
    expect((await join({ phone: "09055550004", storeId: "11111111-1111-4111-8111-111111111111" })).status).toBe(404);
  });
});

describe("V14 等候名单：店长工作台", () => {
  it("技师无权查看，他店长看不到本店条目", async () => {
    expect((await req(`/admin/waitlist?date=${DATE}`, { token: staffToken })).status).toBe(403);
    const other = await req(`/admin/waitlist?date=${DATE}`, { token: otherManagerToken });
    expect(other.status).toBe(200);
    expect(other.body).toHaveLength(0);
    const mine = await req(`/admin/waitlist?date=${DATE}`, { token: managerToken });
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBeGreaterThanOrEqual(2);
    expect(mine.body[0].serviceNameZh).toBe("凝胶美甲");
  });

  it("补位候选：时间窗覆盖空位时刻才匹配，服务过滤生效", async () => {
    await join({ phone: "09066660001", serviceId: svcLash, earliestTime: "18:00", latestTime: "19:30" });
    await join({ phone: "09066660002", serviceId: null, earliestTime: "10:00", latestTime: "20:00", date: DATE2 });
    const at14 = await req(`/admin/waitlist/candidates?date=${DATE}&time=14:00&serviceId=${svcGel}`, { token: managerToken });
    expect(at14.status).toBe(200);
    const phones = at14.body.map((r: any) => r.phone);
    expect(phones).toContain("09011112222");
    expect(phones).not.toContain("09066660001"); // 时间窗 18:00 起，不覆盖 14:00
    const lash = await req(`/admin/waitlist/candidates?date=${DATE}&time=18:30&serviceId=${svcLash}`, { token: managerToken });
    expect(lash.body.map((r: any) => r.phone)).toContain("09066660001");
    const anyService = await req(`/admin/waitlist/candidates?date=${DATE2}&time=12:00`, { token: managerToken });
    expect(anyService.body.map((r: any) => r.phone)).toContain("09066660002"); // 未指定服务的条目匹配任意服务
  });

  it("通知与状态流转：notify 幂等，关闭后不可再操作，写审计", async () => {
    const created = await join({ phone: "09077770001", date: DATE2 });
    const id = created.body.id;
    const n1 = await post(`/admin/waitlist/${id}/notify`, {}, managerToken);
    expect(n1.status).toBe(200);
    expect(n1.body.status).toBe("notified");
    expect(n1.body.notifiedAt).toBeTruthy();
    const n2 = await post(`/admin/waitlist/${id}/notify`, {}, managerToken);
    expect(n2.status).toBe(200);
    expect(n2.body.status).toBe("notified");
    const booked = await post(`/admin/waitlist/${id}/status`, { status: "booked" }, managerToken);
    expect(booked.status).toBe(200);
    expect(booked.body.status).toBe("booked");
    expect((await post(`/admin/waitlist/${id}/notify`, {}, managerToken)).status).toBe(409);
    expect((await post(`/admin/waitlist/${id}/status`, { status: "cancelled" }, managerToken)).status).toBe(409);
    const audits = await handle.db.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, id));
    expect(audits.map((a) => a.action).sort()).toEqual(["waitlist.notify", "waitlist.status"]);
  });
});
