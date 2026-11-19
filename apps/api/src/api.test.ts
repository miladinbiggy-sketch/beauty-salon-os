import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, hashPassword, schema, type DbHandle } from "@salon/database";
import { DEFAULT_STORE_SETTINGS, toIso, tokyoMs } from "@salon/shared";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createNotifier } from "./queue.js";
import { signedPayload } from "./services/integration-contract.js";

/**
 * API 集成测试：连真实 PostgreSQL（TEST_DATABASE_URL，
 * 默认本地 55432 端口的 salon_test 库），跑真实迁移、真实事务与排斥约束。
 * 每个场景使用独立日期，避免用例之间互相占位。
 */
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://salon@127.0.0.1:55432/salon_test";

const D = {
  perm: "2027-01-15",
  race: "2027-01-16",
  resource: "2027-01-17",
  combo: "2027-01-18",
  cancel: "2027-01-19",
  resched: "2027-01-20",
  leave: "2027-01-21",
  snap: "2027-01-22",
  retry: "2027-01-23",
  guardBlock: "2027-01-24",
  guardRace: "2027-01-25",
  masterStaff: "2027-03-10",
  masterSkill: "2027-03-11",
  masterResource: "2027-03-12",
  masterRace: "2027-03-13",
  hoursGuard: "2027-04-21",
  serviceGuard: "2027-04-22",
  integration: "2027-05-12",
};
const ALL_DATES = Object.values(D);
const t = (date: string, hhmm: string) => toIso(tokyoMs(date, hhmm));

let handle: DbHandle;
let app: ReturnType<typeof buildApp>;
let storeId: string;
let svcGel: string;
let svcLash: string;
let staffA: string;
let staffB: string;
let ownerToken: string;
let managerToken: string;
let staffToken: string;
let ipCounter = 0;

async function req(path: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any; cookie: string | null }> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Cookie", init.token);
  if (init.token && init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) {
    headers.set("Origin", "http://localhost:5174");
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  // 每个请求模拟不同来源 IP，避免触发公开接口的防滥用限流（生产规则本身正确）
  headers.set("x-forwarded-for", `10.0.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`);
  const res = await app.fetch(new Request(`http://test${path}`, { ...init, headers }));
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? null };
}

const post = (path: string, data: unknown, token?: string) =>
  req(path, { method: "POST", body: JSON.stringify(data), token });

const patch = (path: string, data: unknown, token?: string) =>
  req(path, { method: "PATCH", body: JSON.stringify(data), token });

const put = (path: string, data: unknown, token?: string) =>
  req(path, { method: "PUT", body: JSON.stringify(data), token });

async function login(email: string): Promise<string> {
  const r = await post("/auth/login", { email, password: "test1234" });
  expect(r.status).toBe(200);
  expect(r.cookie).toMatch(/^salon_session=/);
  return r.cookie!;
}

beforeAll(async () => {
  handle = createDb(TEST_DB_URL);
  const migrationsFolder = new URL("../../../packages/database/migrations", import.meta.url).pathname;
  await migrate(handle.db, { migrationsFolder });
  await handle.db.execute(
    `TRUNCATE auth_sessions, notification_jobs, payments, resource_allocations, appointment_services, appointments,
     blocked_times, shift_breaks, shifts, staff_skills, service_addons, services, resources, staff,
     customers, users, roles, business_hours, stores, audit_logs CASCADE`,
  );
  const db = handle.db;
  const [store] = await db
    .insert(schema.stores)
    .values({ name: "测试店", settings: { ...DEFAULT_STORE_SETTINGS, minLeadMinutes: 0, bookingWindowDays: 3650 } })
    .returning();
  storeId = store!.id;
  for (let weekday = 1; weekday <= 7; weekday++) {
    await db.insert(schema.businessHours).values({ storeId, weekday, openTime: "10:00", closeTime: "20:00", isClosed: false });
  }
  const [gel] = await db
    .insert(schema.services)
    .values({ storeId, category: "nail", nameZh: "凝胶美甲", nameJa: "ジェル", durationMinutes: 60, bufferMinutes: 10, priceJpy: 7500, resourceType: "nail_table", color: "#f472b6" })
    .returning();
  const [lash] = await db
    .insert(schema.services)
    .values({ storeId, category: "lash", nameZh: "美睫", nameJa: "まつげ", durationMinutes: 90, bufferMinutes: 15, priceJpy: 8900, resourceType: "lash_bed", color: "#a78bfa" })
    .returning();
  svcGel = gel!.id;
  svcLash = lash!.id;
  await db.insert(schema.resources).values([
    { storeId, type: "nail_table", name: "美甲桌1" },
    { storeId, type: "nail_table", name: "美甲桌2" },
    { storeId, type: "lash_bed", name: "美睫床1" }, // 只有一张美睫床 —— 资源竞争测试的前提
  ]);
  const [a] = await db.insert(schema.staff).values({ storeId, name: "技师A", color: "#ec4899", sortOrder: 0 }).returning();
  const [b] = await db.insert(schema.staff).values({ storeId, name: "技师B", color: "#3b82f6", sortOrder: 1 }).returning();
  staffA = a!.id;
  staffB = b!.id;
  await db.insert(schema.staffSkills).values([
    { staffId: staffA, serviceId: svcGel },
    { staffId: staffA, serviceId: svcLash },
    { staffId: staffB, serviceId: svcGel },
    { staffId: staffB, serviceId: svcLash },
  ]);
  for (const date of ALL_DATES) {
    for (const staffId of [staffA, staffB]) {
      await db.insert(schema.shifts).values({ storeId, staffId, date, startTime: "10:00", endTime: "20:00" });
    }
  }
  const pw = hashPassword("test1234");
  await db.insert(schema.users).values([
    { storeId, email: "owner@test.salon", passwordHash: pw, role: "owner", name: "店主" },
    { storeId, email: "manager@test.salon", passwordHash: pw, role: "manager", name: "店长" },
    { storeId, email: "staff@test.salon", passwordHash: pw, role: "staff", name: "技师A", staffId: staffA },
  ]);

  const config = loadConfig({ DATABASE_URL: TEST_DB_URL, QUEUE_DRIVER: "db", TRUST_PROXY: "true", JWT_SECRET: "test-secret-test-secret-123456" });
  app = buildApp({ db, config, notifier: createNotifier(config) });
  ownerToken = await login("owner@test.salon");
  managerToken = await login("manager@test.salon");
  staffToken = await login("staff@test.salon");
  void ownerToken;
});

afterAll(async () => {
  await handle.close();
});

describe("认证与权限", () => {
  it("登录签发 HttpOnly Cookie，不再将 JWT 返回给前端", async () => {
    const r = await post("/auth/login", { email: "owner@test.salon", password: "test1234" });
    expect(r.status).toBe(200);
    expect(r.cookie).toMatch(/^salon_session=/);
    expect(r.body.token).toBeUndefined();
    const me = await req("/auth/me", { token: r.cookie! });
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("owner");
  });

  it("Cookie 修改操作必须有可信 Origin，外站不能跨站修改", async () => {
    const missing = await app.fetch(new Request("http://test/auth/logout", {
      method: "POST", headers: { Cookie: ownerToken },
    }));
    expect(missing.status).toBe(403);
    const foreign = await app.fetch(new Request("http://test/auth/logout", {
      method: "POST", headers: { Cookie: ownerToken, Origin: "https://evil.example" },
    }));
    expect(foreign.status).toBe(403);
    const good = await req("/auth/logout", { method: "POST", token: ownerToken });
    expect(good.status).toBe(200);
    expect(good.cookie).toMatch(/^salon_session=/);
    const revoked = await req("/auth/me", { token: ownerToken });
    expect(revoked.status).toBe(401);
  });
  it("停用技师账号后已有会话立即失效，重新启用不恢复旧会话", async () => {
    const [member] = await handle.db.select().from(schema.users).where(eq(schema.users.email, "staff@test.salon"));
    const owner = await login("owner@test.salon");
    expect((await req("/auth/me", { token: staffToken })).status).toBe(200);
    expect((await put(`/admin/users/${member!.id}`, { active: false }, owner)).status).toBe(200);
    expect((await req("/auth/me", { token: staffToken })).status).toBe(401);
    expect((await put(`/admin/users/${member!.id}`, { active: true }, owner)).status).toBe(200);
    expect((await req("/auth/me", { token: staffToken })).status).toBe(401);
    staffToken = await login("staff@test.salon");
  });

  it("修改员工权限立即撤销旧会话并以新权限重新登录", async () => {
    const [member] = await handle.db.select().from(schema.users).where(eq(schema.users.email, "staff@test.salon"));
    const owner = await login("owner@test.salon");
    expect((await put(`/admin/users/${member!.id}`, { role: "manager" }, owner)).status).toBe(200);
    expect((await req("/auth/me", { token: staffToken })).status).toBe(401);
    const managerCookie = await login("staff@test.salon");
    const me = await req("/auth/me", { token: managerCookie });
    expect(me.body.user.role).toBe("manager");
    expect((await put(`/admin/users/${member!.id}`, { role: "staff" }, owner)).status).toBe(200);
    staffToken = await login("staff@test.salon");
  });

  it("错误密码登录被拒", async () => {
    const r = await post("/auth/login", { email: "owner@test.salon", password: "wrong" });
    expect(r.status).toBe(401);
  });

  it("技师不能访问客户列表（403）", async () => {
    const r = await req("/admin/customers", { token: staffToken });
    expect(r.status).toBe(403);
  });

  it("技师查看无关客户被拒；有预约关系后可查看", async () => {
    const created = await post(
      "/public/appointments",
      { storeId, name: "顾客甲", phone: "09000001111", staffId: staffB, startAt: t(D.perm, "10:00"), selections: [{ serviceId: svcGel }] },
    );
    expect(created.status).toBe(201);
    const customerId = created.body.customer.id as string;
    const denied = await req(`/admin/customers/${customerId}`, { token: staffToken });
    expect(denied.status).toBe(403);
    const own = await post(
      "/public/appointments",
      { storeId, name: "顾客甲", phone: "09000001111", staffId: staffA, startAt: t(D.perm, "12:00"), selections: [{ serviceId: svcGel }] },
    );
    expect(own.status).toBe(201);
    const allowed = await req(`/admin/customers/${customerId}`, { token: staffToken });
    expect(allowed.status).toBe(200);
  });

  it("预约查询需要正确的手机号（防枚举）", async () => {
    const created = await post(
      "/public/appointments",
      { storeId, name: "顾客乙", phone: "09000002222", staffId: staffA, startAt: t(D.perm, "15:00"), selections: [{ serviceId: svcGel }] },
    );
    expect(created.status).toBe(201);
    const code = created.body.bookingCode as string;
    const bad = await post("/public/appointments/lookup", { storeId, bookingCode: code, phone: "09099999999" });
    expect(bad.status).toBe(404);
    const good = await post("/public/appointments/lookup", { storeId, bookingCode: code, phone: "09000002222" });
    expect(good.status).toBe(200);
    expect(good.body.internalNote).toBeNull();
  });
});

describe("预约主流程", () => {
  it("可用时间包含当天班次内的空位", async () => {
    const sel = encodeURIComponent(JSON.stringify([{ serviceId: svcGel }]));
    const r = await req(`/public/availability?storeId=${storeId}&date=${D.race}&sel=${sel}&staffId=${staffB}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((o: any) => o.staffId === staffB)).toBe(true);
  });

  it("同一技师同一时段重复预约 → 409", async () => {
    const payload = { storeId, name: "顾客丙", phone: "09000003333", staffId: staffA, startAt: t(D.race, "17:00"), selections: [{ serviceId: svcGel }] };
    const first = await post("/public/appointments", payload);
    expect(first.status).toBe(201);
    const second = await post("/public/appointments", { ...payload, phone: "09000004444", name: "顾客丁" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");
  });

  it("8 个并发抢同一时段：恰好 1 个成功", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        post("/public/appointments", {
          storeId,
          name: `抢约${i}`,
          phone: `0901111000${i}`,
          staffId: staffB,
          startAt: t(D.race, "17:00"),
          selections: [{ serviceId: svcGel }],
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    expect(ok.length).toBe(1);
    expect(conflicts.length).toBe(7);
  });

  it("不同技师共用唯一美睫床：第二个被资源冲突拒绝", async () => {
    const a = await post("/public/appointments", {
      storeId, name: "睫毛甲", phone: "09022221111", staffId: staffA, startAt: t(D.resource, "10:00"), selections: [{ serviceId: svcLash }],
    });
    expect(a.status).toBe(201);
    const b = await post("/public/appointments", {
      storeId, name: "睫毛乙", phone: "09022222222", staffId: staffB, startAt: t(D.resource, "10:30"), selections: [{ serviceId: svcLash }],
    });
    expect(b.status).toBe(409);
    expect(JSON.stringify(b.body.error.details ?? [])).toContain("resource_busy");
    // B 同时段做美甲（不同工位）可以
    const c = await post("/public/appointments", {
      storeId, name: "睫毛乙", phone: "09022222222", staffId: staffB, startAt: t(D.resource, "10:30"), selections: [{ serviceId: svcGel }],
    });
    expect(c.status).toBe(201);
  });

  it("组合服务连续排布：第二段从第一段结束+缓冲后开始，总价为两项之和", async () => {
    const r = await post("/public/appointments", {
      storeId, name: "组合顾客", phone: "09033331111", staffId: staffB, startAt: t(D.combo, "13:00"),
      selections: [{ serviceId: svcGel }, { serviceId: svcLash }],
    });
    expect(r.status).toBe(201);
    const segs = r.body.services;
    expect(segs).toHaveLength(2);
    expect(segs[0].startAt).toBe(t(D.combo, "13:00"));
    expect(segs[0].endAt).toBe(t(D.combo, "14:00"));
    expect(segs[1].startAt).toBe(t(D.combo, "14:10")); // 60 分钟 + 10 分钟清洁缓冲
    expect(segs[1].endAt).toBe(t(D.combo, "15:40"));
    expect(r.body.totalPriceJpy).toBe(7500 + 8900);
    expect(segs[1].resourceId).not.toBeNull(); // 美睫段分配到美睫床
  });

  it("取消后释放时段，可再次预约", async () => {
    const created = await post("/public/appointments", {
      storeId, name: "取消顾客", phone: "09044441111", staffId: staffA, startAt: t(D.cancel, "18:30"), selections: [{ serviceId: svcGel }],
    });
    expect(created.status).toBe(201);
    const code = created.body.bookingCode as string;
    const cancelled = await post("/public/appointments/cancel", { storeId, bookingCode: code, phone: "09044441111" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    const rebook = await post("/public/appointments", {
      storeId, name: "取消顾客", phone: "09044441111", staffId: staffA, startAt: t(D.cancel, "18:30"), selections: [{ serviceId: svcGel }],
    });
    expect(rebook.status).toBe(201);
  });

  it("改期到冲突时段被拒，改到空闲时段成功", async () => {
    const first = await post("/public/appointments", {
      storeId, name: "改期甲", phone: "09055551111", staffId: staffB, startAt: t(D.resched, "10:00"), selections: [{ serviceId: svcGel }],
    });
    expect(first.status).toBe(201);
    const second = await post("/public/appointments", {
      storeId, name: "改期乙", phone: "09055552222", staffId: staffB, startAt: t(D.resched, "13:00"), selections: [{ serviceId: svcGel }],
    });
    expect(second.status).toBe(201);
    const code2 = second.body.bookingCode as string;
    const clash = await post("/public/appointments/reschedule", {
      storeId, bookingCode: code2, phone: "09055552222", startAt: t(D.resched, "10:00"),
    });
    expect(clash.status).toBe(409);
    const okMove = await post("/public/appointments/reschedule", {
      storeId, bookingCode: code2, phone: "09055552222", startAt: t(D.resched, "16:00"),
    });
    expect(okMove.status).toBe(200);
    expect(okMove.body.startAt).toBe(t(D.resched, "16:00"));
    // 原时段 13:00 已释放，可再约
    const refill = await post("/public/appointments", {
      storeId, name: "改期丙", phone: "09055553333", staffId: staffB, startAt: t(D.resched, "13:00"), selections: [{ serviceId: svcGel }],
    });
    expect(refill.status).toBe(201);
  });

  it("员工请假后：可用时间为空，预约返回 staff_blocked", async () => {
    const blocked = await post(
      "/admin/blocked-times",
      { staffId: staffB, type: "leave", startAt: t(D.leave, "00:00"), endAt: t(D.leave, "23:59"), reason: "临时请假" },
      managerToken,
    );
    expect(blocked.status).toBe(201);
    const sel = encodeURIComponent(JSON.stringify([{ serviceId: svcGel }]));
    const avail = await req(`/public/availability?storeId=${storeId}&date=${D.leave}&sel=${sel}&staffId=${staffB}`);
    expect(avail.status).toBe(200);
    expect(avail.body).toEqual([]);
    const attempt = await post("/public/appointments", {
      storeId, name: "请假顾客", phone: "09066661111", staffId: staffB, startAt: t(D.leave, "11:00"), selections: [{ serviceId: svcGel }],
    });
    expect(attempt.status).toBe(409);
    expect(JSON.stringify(attempt.body.error.details ?? [])).toContain("staff_blocked");
    await req(`/admin/blocked-times/${blocked.body.id}`, { method: "DELETE", token: managerToken });
  });

  it("价格快照：改价后旧预约金额不变", async () => {
    const before = await post("/public/appointments", {
      storeId, name: "快照顾客", phone: "09077771111", staffId: staffA, startAt: t(D.snap, "11:30"), selections: [{ serviceId: svcGel }],
    });
    expect(before.status).toBe(201);
    expect(before.body.totalPriceJpy).toBe(7500);
    const upd = await put(`/admin/services/${svcGel}`, { priceJpy: 9000 }, managerToken);
    expect(upd.status).toBe(200);
    const lookup = await post("/public/appointments/lookup", {
      storeId, bookingCode: before.body.bookingCode, phone: "09077771111",
    });
    expect(lookup.body.totalPriceJpy).toBe(7500);
    await put(`/admin/services/${svcGel}`, { priceJpy: 7500 }, managerToken);
  });
});

describe("状态流转、收银与报表", () => {
  it("完整闭环：建单 → 到店 → 开始 → 完成 → 收款 → 报表 → 部分退款", async () => {
    const created = await post(
      "/admin/appointments",
      { customerName: "闭环顾客", customerPhone: "09088881111", staffId: staffA, startAt: t(D.race, "14:00"), selections: [{ serviceId: svcGel }], source: "admin" },
      managerToken,
    );
    expect(created.status).toBe(201);
    const apptId = created.body.id as string;

    for (const status of ["arrived", "in_service", "completed"]) {
      const r = await patch(`/admin/appointments/${apptId}/status`, { status }, managerToken);
      expect(r.status, `status ${status}`).toBe(200);
      expect(r.body.status).toBe(status);
    }
    const bad = await patch(`/admin/appointments/${apptId}/status`, { status: "arrived" }, managerToken);
    expect(bad.status).toBe(400);

    const pay = await post("/admin/payments", { appointmentId: apptId, amountJpy: 7500, method: "cash", paidAt: t(D.race, "15:00") }, managerToken);
    expect(pay.status).toBe(201);

    const report = await req(`/admin/reports/summary?from=${D.race}&to=${D.race}`, { token: managerToken });
    expect(report.status).toBe(200);
    expect(report.body.revenueJpy).toBe(7500);
    const perf = (report.body.staffPerformance as any[]).find((p) => p.staffId === staffA);
    expect(perf.completedCount).toBeGreaterThanOrEqual(1);

    const refund = await post(`/admin/payments/${pay.body.id}/refund`, { amountJpy: 2500, paidAt: t(D.race, "15:30") }, managerToken);
    expect(refund.status).toBe(201);
    expect(refund.body.refundOfId).toBe(pay.body.id);
    expect(refund.body.amountJpy).toBe(-2500);
    const report2 = await req(`/admin/reports/summary?from=${D.race}&to=${D.race}`, { token: managerToken });
    expect(report2.body.revenueJpy).toBe(5000);
    const over = await post(`/admin/payments/${pay.body.id}/refund`, { amountJpy: 6000 }, managerToken);
    expect(over.status).toBe(400);
    // Parallel requests must not issue more refunds than original amount.
    const attempts = await Promise.all(Array.from({ length: 5 }, () =>
      post(`/admin/payments/${pay.body.id}/refund`, { amountJpy: 1000 }, managerToken),
    ));
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(5);
    const extra = await post(`/admin/payments/${pay.body.id}/refund`, { amountJpy: 1 }, managerToken);
    expect(extra.status).toBe(400);
  });

  it("技师只能变更自己的预约状态", async () => {
    const created = await post(
      "/admin/appointments",
      { customerName: "他人顾客", customerPhone: "09088882222", staffId: staffB, startAt: t(D.race, "11:00"), selections: [{ serviceId: svcGel }], source: "admin" },
      managerToken,
    );
    expect(created.status).toBe(201);
    const r = await patch(`/admin/appointments/${created.body.id}/status`, { status: "arrived" }, staffToken);
    expect(r.status).toBe(403);
  });

  it("技师日程接口只返回自己的预约", async () => {
    const r = await req(`/staff/schedule?date=${D.perm}`, { token: staffToken });
    expect(r.status).toBe(200);
    expect(r.body.every((a: any) => a.staff.id === staffA)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
  });

  it("技师业绩接口可用", async () => {
    const r = await req(`/staff/performance?from=${D.race}&to=${D.race}`, { token: staffToken });
    expect(r.status).toBe(200);
    expect(r.body.completedCount).toBeGreaterThanOrEqual(1);
    expect(r.body.revenueJpy).toBeGreaterThanOrEqual(7500);
  });
});

/* V2 Pro regression scenarios: manager-only optimizer and append-only salon care records. */
describe("V2 智能推荐与电子护理档案", () => {
  it("技师不能调用门店全局优化器；店长只能得到合法可约时段", async () => {
    const body = { date: D.resched, selections: [{ serviceId: svcGel }], strategy: "balanced", limit: 5 };
    const no = await post("/admin/schedule/recommendations", body, staffToken);
    expect(no.status).toBe(403);
    const yes = await post("/admin/schedule/recommendations", body, managerToken);
    expect(yes.status).toBe(200);
    expect(yes.body.slots.length).toBeGreaterThan(0);
    expect(yes.body.slots.length).toBeLessThanOrEqual(5);
    expect(yes.body.slots.every((s: any) => typeof s.score === "number" && s.reasons instanceof Array)).toBe(true);
  });

  it("护理记录仅向关联员工或店长开放，拒绝不匹配的订单", async () => {
    const booking = await post("/public/appointments", {
      storeId, name: "护理顾客", phone: "09099995555", staffId: staffB,
      startAt: t(D.snap, "10:00"), selections: [{ serviceId: svcGel }],
    });
    expect(booking.status).toBe(201);
    const customerId = booking.body.customer.id;
    const endpoint = `/admin/customers/${customerId}/care-records`;
    expect((await req(endpoint, { token: staffToken })).status).toBe(403);
    expect((await post(endpoint, { category: "nail", details: { color: "soft pink" } }, staffToken)).status).toBe(403);
    const created = await post(endpoint, {
      category: "nail", details: { shape: "oval", color: "pink", design: "French" }, memo: "Service note",
      appointmentId: booking.body.id,
    }, managerToken);
    expect(created.status).toBe(201);
    const listed = await req(endpoint, { token: managerToken });
    expect(listed.status).toBe(200);
    expect(listed.body.some((r: any) => r.id === created.body.id && r.details.color === "pink")).toBe(true);
    expect((await post(endpoint, { category: "beauty", details: { medicalDiagnosis: "invalid" } }, managerToken)).status).toBe(400);
    expect((await req(`/public/customers/${customerId}/care-records`)).status).toBe(404);
  });

  it("跨门店员工不能被排进本店班次、请假表或绑定本店账号", async () => {
    const [foreign] = await handle.db.insert(schema.stores).values({ name: "无关门店" }).returning();
    const [foreignStaff] = await handle.db.insert(schema.staff).values({ storeId: foreign!.id, name: "外店员工" }).returning();
    expect((await post("/admin/shifts/generate", {
      fromDate: D.perm, weeks: 1,
      items: [{ staffId: foreignStaff!.id, weekday: 5, startTime: "10:00", endTime: "18:00" }],
    }, managerToken)).status).toBe(400);
    expect((await post("/admin/blocked-times", {
      staffId: foreignStaff!.id, type: "leave", startAt: t(D.perm, "10:00"), endAt: t(D.perm, "11:00"),
    }, managerToken)).status).toBe(400);
    const owner = await login("owner@test.salon");
    expect((await post("/admin/users", {
      email: "foreign-assignment@test.salon", password: "another-password", role: "staff", name: "Invalid",
      staffId: foreignStaff!.id,
    }, owner)).status).toBe(400);
  });

  it("公开改期不能绕过提前预约时间，即使原订单此前合法", async () => {
    const [store] = await handle.db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
    const settings = { ...(store!.settings as Record<string, unknown>), minLeadMinutes: 60 };
    await handle.db.update(schema.stores).set({ settings }).where(eq(schema.stores.id, storeId));
    try {
      const booked = await post("/public/appointments", {
        storeId, name: "改期限制测试", phone: "09055557777", staffId: staffA,
        startAt: t(D.resched, "18:00"), selections: [{ serviceId: svcGel }],
      });
      expect(booked.status).toBe(201);
      const tooSoon = await post("/public/appointments/reschedule", {
        storeId, bookingCode: booked.body.bookingCode, phone: "09055557777",
        startAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      });
      expect(tooSoon.status).toBe(400);
      expect(tooSoon.body.error.details?.code).toBe("LEAD_TIME");
    } finally {
      await handle.db.update(schema.stores).set({ settings: store!.settings }).where(eq(schema.stores.id, storeId));
    }
  });

  it("跨门店附加服务不能通过 ID 直接修改", async () => {
    const [otherStore] = await handle.db.insert(schema.stores).values({ name: "另一家门店" }).returning();
    const [otherService] = await handle.db.insert(schema.services).values({
      storeId: otherStore!.id, category: "nail", nameZh: "其他门店项目", nameJa: "別店舗メニュー",
      durationMinutes: 60, bufferMinutes: 0, priceJpy: 5000,
    }).returning();
    const [addon] = await handle.db.insert(schema.serviceAddons).values({
      serviceId: otherService!.id, nameZh: "私有附加", nameJa: "限定", durationMinutes: 10, priceJpy: 1000,
    }).returning();
    const res = await put(`/admin/addons/${addon!.id}`, { priceJpy: 1 }, managerToken);
    expect(res.status).toBe(404);
    const [unchanged] = await handle.db.select().from(schema.serviceAddons).where(eq(schema.serviceAddons.id, addon!.id));
    expect(unchanged?.priceJpy).toBe(1000);
  });
});

/* V6 merchant cash closing: a closed Tokyo business day must not be mutated. */
describe("V6 营业日结与锁账", () => {
  const businessDate = "2026-11-15";
  const paidAt = (hour: number) => toIso(tokyoMs(businessDate, `${String(hour).padStart(2,"0")}:00`));
  it("仅管理者能查看完整日结预览", async () => {
    expect((await req(`/admin/cash-close/preview?date=${businessDate}`, {token: staffToken})).status).toBe(403);
    expect((await post("/admin/cash-close", {date:businessDate,openingCashJpy:0,countedCashJpy:0,expectedTransactionCount:0}, staffToken)).status).toBe(403);
    expect((await req("/admin/cash-close/preview?date=2026-02-30", {token: managerToken})).status).toBe(400);
  });

  it("现金实点、差额原因、日结快照、回写拦截", async () => {
    const cash = await post("/admin/payments", {amountJpy:9000,method:"cash",paidAt:paidAt(10)}, managerToken);
    const card = await post("/admin/payments", {amountJpy:2000,method:"card",paidAt:paidAt(11)}, managerToken);
    expect(cash.status).toBe(201); expect(card.status).toBe(201);
    const refund = await post(`/admin/payments/${cash.body.id}/refund`, {amountJpy:1000,paidAt:paidAt(12)}, managerToken);
    expect(refund.status).toBe(201);
    const preview = await req(`/admin/cash-close/preview?date=${businessDate}`, {token:managerToken});
    expect(preview.status).toBe(200);
    expect(preview.body.summary).toMatchObject({receivedJpy:11000, refundedJpy:1000, netJpy:10000, cashNetJpy:8000, transactionCount:3});
    expect(preview.body.closed).toBe(null);
    expect((await post("/admin/cash-close", {date:businessDate,openingCashJpy:2000,countedCashJpy:9900,expectedTransactionCount:3},managerToken)).status).toBe(400);
    const closed = await post("/admin/cash-close", {date:businessDate,openingCashJpy:2000,countedCashJpy:10000,expectedTransactionCount:3}, managerToken);
    expect(closed.status).toBe(201);
    expect(closed.body).toMatchObject({businessDate,expectedCashJpy:10000,varianceJpy:0,netJpy:10000});
    expect((await post("/admin/cash-close", {date:businessDate,openingCashJpy:2000,countedCashJpy:10000,expectedTransactionCount:3},managerToken)).status).toBe(409);
    expect((await post("/admin/payments", {amountJpy:1000,method:"cash",paidAt:paidAt(13)},managerToken)).status).toBe(409);
    expect((await post(`/admin/payments/${card.body.id}/refund`, {amountJpy:100,paidAt:paidAt(14)},managerToken)).status).toBe(409);
    const again = await req(`/admin/cash-close/preview?date=${businessDate}`, {token:managerToken});
    expect(again.body.closed.id).toBe(closed.body.id);
    expect(again.body.summary.netJpy).toBe(10000);
  });

  it("日结与收款同时提交时不可漏账", async () => {
    const d = "2026-11-13";
    const [close, payment] = await Promise.all([
      post("/admin/cash-close", {date:d,openingCashJpy:0,countedCashJpy:0,expectedTransactionCount:0},managerToken),
      post("/admin/payments", {amountJpy:500,method:"card",paidAt:toIso(tokyoMs(d,"13:00"))},managerToken),
    ]);
    expect([201, 409]).toContain(payment.status);
    if (payment.status === 201) {
      // Payment acquired the lock first: stale preview must be rejected.
      expect(close.status).toBe(409);
      const preview = await req(`/admin/cash-close/preview?date=${d}`, {token:managerToken});
      expect(preview.body.summary.netJpy).toBe(500);
      expect(preview.body.closed).toBe(null);
    } else {
      // Close acquired the lock first: any later backdated payment must be refused.
      expect(close.status).toBe(201);
      const preview = await req(`/admin/cash-close/preview?date=${d}`, {token:managerToken});
      expect(preview.body.closed.netJpy).toBe(0);
    }
  });

  it("并发日结请求必须只有一个成功", async () => {
    const d = "2026-11-14";
    const [a,b] = await Promise.all([
      post("/admin/cash-close", {date:d, openingCashJpy:0, countedCashJpy:0,expectedTransactionCount:0},managerToken),
      post("/admin/cash-close", {date:d, openingCashJpy:0, countedCashJpy:0,expectedTransactionCount:0},managerToken),
    ]);
    expect([a.status,b.status].sort()).toEqual([201,409]);
  });
});


describe("V7 线上预约幂等重试", () => {
  it("同 UUID 并发请求只保留一个预约，丢失成功响应后可恢复同一确认号", async () => {
    const idem = "550e8400-e29b-41d4-a716-446655440000";
    const body = {
      storeId, name: "重试客户", phone: "09087654321", staffId: staffA,
      startAt: t(D.retry, "15:00"), selections: [{ serviceId: svcGel }], locale: "ja",
    };
    const retry = () => req("/public/appointments", {
      method: "POST", headers: { "Idempotency-Key": idem }, body: JSON.stringify(body),
    });
    const [first, second] = await Promise.all([retry(), retry()]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.bookingCode).toBe(first.body.bookingCode);
    const [matching] = await handle.db.select({ count: sql<number>`count(*)::int` }).from(schema.appointments)
      .where(eq(schema.appointments.idempotencyKey, idem));
    expect(matching?.count).toBe(1);
    const originalJobs = await handle.db.select().from(schema.notificationJobs)
      .where(eq(schema.notificationJobs.appointmentId, first.body.id));
    expect(originalJobs.length).toBeGreaterThan(0);
    const retryAgain = await retry();
    expect(retryAgain.body.id).toBe(first.body.id);
    const sameJobs = await handle.db.select().from(schema.notificationJobs)
      .where(eq(schema.notificationJobs.appointmentId, first.body.id));
    expect(sameJobs.length).toBe(originalJobs.length);
    const reused = await req("/public/appointments", {
      method: "POST", headers: { "Idempotency-Key": idem },
      body: JSON.stringify({ ...body, phone: "09000000000" }),
    });
    expect(reused.status).toBe(409);
    const distinct = await req("/public/appointments", {
      method: "POST", headers: { "Idempotency-Key": "550e8400-e29b-41d4-a716-446655440001" },
      body: JSON.stringify(body),
    });
    expect(distinct.status).toBe(409); // same slot, NEW key -> scheduler prevents double reservation
  });

  it("恶意或空白幂等请求头被拒绝", async () => {
    const result = await req("/public/appointments", {
      method: "POST", headers: { "Idempotency-Key": "not-a-uuid" },
      body: JSON.stringify({ storeId, name: "test", phone: "09055555555", startAt: t(D.retry, "18:00"), selections: [{ serviceId: svcGel }] }),
    });
    expect(result.status).toBe(400);
  });
});


describe("V8 临时封锁和班次经营安全", () => {
  it("普通技师不能读取同事的请假与病假原因", async () => {
    const blocked = await req("/admin/blocked-times", { token: staffToken });
    expect(blocked.status).toBe(403);
  });
  it("已有顾客预约不能被后来请假或设备维护覆盖；边界相接允许，重叠封锁拒绝", async () => {
    const created = await post("/public/appointments", {
      storeId, name: "保护预约顾客", phone: "09012121212", staffId: staffA,
      startAt: t(D.guardBlock, "10:00"), selections: [{ serviceId: svcLash }],
    });
    expect(created.status).toBe(201);
    const staffBlock = await post("/admin/blocked-times", {
      staffId: staffA, type: "leave", startAt: t(D.guardBlock, "10:30"), endAt: t(D.guardBlock, "11:30"),
    }, managerToken);
    expect(staffBlock.status).toBe(409);
    const resourceId = created.body.services[0].resourceId;
    expect(resourceId).toBeTruthy();
    const resourceBlock = await post("/admin/blocked-times", {
      resourceId, type: "maintenance", startAt: t(D.guardBlock, "10:30"), endAt: t(D.guardBlock, "11:00"),
    }, managerToken);
    expect(resourceBlock.status).toBe(409);
    // End of lash service is 11:30 and buffer (15 min per seed) until 11:45.
    // NOTE: upstream test said 11:40, contradicting its own seed bufferMinutes=15;
    // the app correctly rejected 11:40 as overlapping the cleanup buffer. Fixed to 11:45.
    const adjacent = await post("/admin/blocked-times", {
      resourceId, type: "maintenance", startAt: t(D.guardBlock, "11:45"), endAt: t(D.guardBlock, "12:20"),
    }, managerToken);
    expect(adjacent.status).toBe(201);
    const dup = await post("/admin/blocked-times", {
      resourceId, type: "maintenance", startAt: t(D.guardBlock, "12:00"), endAt: t(D.guardBlock, "12:30"),
    }, managerToken);
    expect(dup.status).toBe(409);
    const cancelled = await post("/admin/appointments/" + created.body.id + "/cancel", { reason: "客户要求取消" }, managerToken);
    expect(cancelled.status).toBe(200);
    const afterCancel = await post("/admin/blocked-times", {
      staffId: staffA, type: "leave", startAt: t(D.guardBlock, "10:30"), endAt: t(D.guardBlock, "11:30"),
    }, managerToken);
    expect(afterCancel.status).toBe(201);
  });

  it("并发预约与请假互斥，不能同时成功", async () => {
    const [a, b] = await Promise.all([
      post("/public/appointments", { storeId, name: "并发保护", phone: "09013131313", staffId: staffB,
        startAt: t(D.guardRace, "14:00"), selections: [{ serviceId: svcGel }] }),
      post("/admin/blocked-times", { staffId: staffB, type: "leave",
        startAt: t(D.guardRace, "14:00"), endAt: t(D.guardRace, "15:00") }, managerToken),
    ]);
    expect([a.status,b.status].sort()).toEqual([201,409]);
  });

  it("新班次必须有效且不重复，已有预约的班次不能删除", async () => {
    const date = "2027-03-02"; // not part of the auto-seeded shifts
    const bad = await post("/admin/shifts", { staffId: staffA, date, startTime: "10:00", endTime: "18:00",
      breaks: [{ startTime: "12:00", endTime: "12:50" }, { startTime: "12:20", endTime: "13:00" }] }, managerToken);
    expect(bad.status).toBe(400);
    const invalidDate = await post("/admin/shifts", { staffId: staffA, date: "2027-02-29", startTime: "10:00", endTime: "18:00" }, managerToken);
    expect(invalidDate.status).toBe(400);
    const shift = await post("/admin/shifts", { staffId: staffA, date, startTime: "10:00", endTime: "18:00",
      breaks: [{ startTime: "12:00", endTime: "12:30" }] }, managerToken);
    expect(shift.status).toBe(201);
    const again = await post("/admin/shifts", { staffId: staffA, date, startTime: "11:00", endTime: "17:00" }, managerToken);
    expect(again.status).toBe(409);
    const booked = await post("/public/appointments", { storeId, name: "锁定班次顾客", phone: "09014141414", staffId: staffA,
      startAt: t(date, "15:00"), selections: [{ serviceId: svcGel }] });
    expect(booked.status).toBe(201);
    const deniedDelete = await req(`/admin/shifts/${shift.body.id}`, { method: "DELETE", token: managerToken });
    expect(deniedDelete.status).toBe(409);
    const cancel = await post(`/admin/appointments/${booked.body.id}/cancel`, { reason: "顾客改期" }, managerToken);
    expect(cancel.status).toBe(200);
    const deleted = await req(`/admin/shifts/${shift.body.id}`, { method: "DELETE", token: managerToken });
    expect(deleted.status).toBe(200);
  });

  it("批量班次拒绝重复模板和错位休息，正确模板可原子创建", async () => {
    const date = "2027-03-08"; // Monday
    const invalid = await post("/admin/shifts/generate", { fromDate: date, weeks: 1,
      items: [{ staffId: staffB, weekday: 1, startTime: "10:00", endTime: "18:00", breaks: [{ startTime: "18:10", endTime: "18:30" }] }] }, managerToken);
    expect(invalid.status).toBe(400);
    const same = { staffId: staffB, weekday: 1, startTime: "10:00", endTime: "18:00" };
    const dup = await post("/admin/shifts/generate", { fromDate: date, weeks: 1, items: [same, same] }, managerToken);
    expect(dup.status).toBe(400);
    const generated = await post("/admin/shifts/generate", { fromDate: date, weeks: 1, items: [same] }, managerToken);
    expect(generated.status).toBe(200);
    expect(generated.body).toEqual({ created: 1, skipped: 0 });
    const retry = await post("/admin/shifts/generate", { fromDate: date, weeks: 1, items: [same] }, managerToken);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ created: 0, skipped: 1 });
  });
});

describe("V9 关键员工/工位资料变更不破坏已确认预约", () => {
  async function newStaff(name: string, date: string, skills: string[]) {
    const created = await post("/admin/staff", { name, color: "#ff8800", skillServiceIds: skills }, managerToken);
    expect(created.status).toBe(201);
    const shift = await post("/admin/shifts", { staffId: created.body.id, date, startTime: "10:00", endTime: "19:00" }, managerToken);
    expect(shift.status).toBe(201);
    return created.body.id as string;
  }

  it("技师已有预约时 PUT/DELETE 停用均409；取消后可停用，重命名仍允许", async () => {
    const id = await newStaff("V9技师停用保护", D.masterStaff, [svcGel]);
    const booked = await post("/public/appointments", { storeId, name: "V9技师顾客", phone: "09002002001",
      staffId: id, startAt: t(D.masterStaff, "14:00"), selections: [{ serviceId: svcGel }] });
    expect(booked.status).toBe(201);
    expect((await put(`/admin/staff/${id}`, { active: false }, managerToken)).status).toBe(409);
    expect((await req(`/admin/staff/${id}`, { method: "DELETE", token: managerToken })).status).toBe(409);
    expect((await put(`/admin/staff/${id}`, { name: "新名字" }, managerToken)).status).toBe(200);
    expect((await post(`/admin/appointments/${booked.body.id}/cancel`, { reason: "顾客改期" }, managerToken)).status).toBe(200);
    expect((await req(`/admin/staff/${id}`, { method: "DELETE", token: managerToken })).status).toBe(200);
  });

  it("移除未来顾客已预订的技能失败且回滚；新增技能或取消预约后移除成功", async () => {
    const id = await newStaff("V9技能保护", D.masterSkill, [svcGel, svcLash]);
    const booked = await post("/public/appointments", { storeId, name: "V9技能顾客", phone: "09002002002",
      staffId: id, startAt: t(D.masterSkill, "16:00"), selections: [{ serviceId: svcLash }] });
    expect(booked.status).toBe(201);
    const blocked = await put(`/admin/staff/${id}`, { name: "不应保留的新名", skillServiceIds: [svcGel] }, managerToken);
    expect(blocked.status).toBe(409);
    const current = await req("/admin/staff", { token: managerToken });
    const row = current.body.find((s: any) => s.id === id);
    expect(row.name).toBe("V9技能保护");
    expect(row.skillServiceIds).toContain(svcLash);
    expect((await post(`/admin/appointments/${booked.body.id}/cancel`, {}, managerToken)).status).toBe(200);
    const ok = await put(`/admin/staff/${id}`, { skillServiceIds: [svcGel] }, managerToken);
    expect(ok.status).toBe(200);
    expect(ok.body.skillServiceIds).toEqual([svcGel]);
  });

  it("已预约的工位禁止 PUT/DELETE 停用与类型变更，取消后允许；改名称允许", async () => {
    const service = await post("/admin/services", { category: "beauty", nameZh: "V9美容疗程", nameJa: "フェイシャル",
      durationMinutes: 45, bufferMinutes: 10, priceJpy: 4500, resourceType: "beauty_bed" }, managerToken);
    expect(service.status).toBe(201);
    const id = await newStaff("V9美容师", D.masterResource, [service.body.id]);
    const equipment = await post("/admin/resources", { type: "beauty_bed", name: "V9独立美容床" }, managerToken);
    expect(equipment.status).toBe(201);
    const booked = await post("/public/appointments", { storeId, name: "V9工位顾客", phone: "09002002003",
      staffId: id, startAt: t(D.masterResource, "14:00"), selections: [{ serviceId: service.body.id }] });
    expect(booked.status).toBe(201);
    expect(booked.body.services[0].resourceId).toBe(equipment.body.id);
    expect((await put(`/admin/resources/${equipment.body.id}`, { active: false }, managerToken)).status).toBe(409);
    expect((await put(`/admin/resources/${equipment.body.id}`, { type: "lash_bed" }, managerToken)).status).toBe(409);
    expect((await req(`/admin/resources/${equipment.body.id}`, { method: "DELETE", token: managerToken })).status).toBe(409);
    expect((await put(`/admin/resources/${equipment.body.id}`, { name: "美容床VIP" }, managerToken)).status).toBe(200);
    expect((await post(`/admin/appointments/${booked.body.id}/cancel`, {}, managerToken)).status).toBe(200);
    expect((await req(`/admin/resources/${equipment.body.id}`, { method: "DELETE", token: managerToken })).status).toBe(200);
  });

  it("并发抢约与停用技师不能双双成功", async () => {
    const id = await newStaff("V9并发技师", D.masterRace, [svcGel]);
    const [booking, deactivation] = await Promise.all([
      post("/public/appointments", { storeId, name: "V9并发预约", phone: "09002002004",
        staffId: id, startAt: t(D.masterRace, "14:00"), selections: [{ serviceId: svcGel }] }),
      req(`/admin/staff/${id}`, { method: "DELETE", token: managerToken }),
    ]);
    expect(booking.status === 201 && deactivation.status === 200).toBe(false);
    expect([200, 201, 400, 409]).toContain(booking.status);
    expect([200, 409]).toContain(deactivation.status);
  });
});


describe("V11 营业时间与服务资料变更安全", () => {
  it("营业时间必须是七个唯一的有效工作日", async () => {
    const before = await req("/admin/store", { token: managerToken });
    const hours = before.body.businessHours;
    const duplicate = hours.map((h: any, i: number) => i === 6 ? { ...h, weekday: 1 } : h);
    expect((await put("/admin/business-hours", { hours: duplicate }, managerToken)).status).toBe(400);
    const reversed = hours.map((h: any, i: number) => i === 0 ? { ...h, isClosed: false, openTime: "20:00", closeTime: "10:00" } : h);
    expect((await put("/admin/business-hours", { hours: reversed }, managerToken)).status).toBe(400);
    const denied = await put("/admin/business-hours", { hours }, staffToken);
    expect(denied.status).toBe(403);
  });

  it("预约存在时缩短营业时间返回409；综合设置变更整个事务回滚；取消后才可调整", async () => {
    const created = await post("/public/appointments", { storeId, name: "V11日结前客户", phone: "09020270101", staffId: staffA,
      startAt: t(D.hoursGuard, "18:30"), selections: [{ serviceId: svcGel }] });
    expect(created.status).toBe(201);
    const before = await req("/admin/store", { token: managerToken });
    const weekday = (new Date(`${D.hoursGuard}T00:00:00Z`).getUTCDay() + 6) % 7 + 1;
    const hours = before.body.businessHours.map((h: any) => h.weekday === weekday ? { ...h, isClosed: false, closeTime: "19:00" } : h);
    const conflict = await put("/admin/business-hours", { hours }, managerToken);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.appointmentId).toBe(created.body.id);
    const atomic = await put("/admin/store", { name: "V11不应提交", settings: { bookingWindowDays: 7 }, businessHours: hours }, managerToken);
    expect(atomic.status).toBe(409);
    const unchanged = await req("/admin/store", { token: managerToken });
    expect(unchanged.body.name).toBe(before.body.name);
    expect(unchanged.body.settings.bookingWindowDays).toBe(before.body.settings.bookingWindowDays);
    expect(unchanged.body.businessHours.find((h: any)=>h.weekday===weekday).closeTime).toBe(before.body.businessHours.find((h: any)=>h.weekday===weekday).closeTime);
    expect((await post(`/admin/appointments/${created.body.id}/cancel`, {}, managerToken)).status).toBe(200);
    const updated = await put("/admin/store", { name: before.body.name, settings: { bookingWindowDays: before.body.settings.bookingWindowDays }, businessHours: hours }, managerToken);
    expect(updated.status).toBe(200);
    const after = await req("/admin/store", { token: managerToken });
    expect(after.body.businessHours.find((h: any)=>h.weekday===weekday).closeTime).toBe("19:00");
    expect((await put("/admin/business-hours", { hours: before.body.businessHours }, managerToken)).status).toBe(200);
  });

  it("已预约服务不能停用或更换工位类型，其他描述/价格修改仍允许；取消后能停用", async () => {
    const service = await post("/admin/services", { category:"other", nameZh:"V11客制服务", nameJa:"V11サービス",
      priceJpy:5000, durationMinutes:30, bufferMinutes:5, resourceType:null }, managerToken);
    expect(service.status).toBe(201);
    const staff = await req("/admin/staff", { token: managerToken });
    const existing = staff.body.find((x:any)=>x.id===staffA);
    expect((await put(`/admin/staff/${staffA}`, { skillServiceIds:[...existing.skillServiceIds,service.body.id] }, managerToken)).status).toBe(200);
    const booked = await post("/public/appointments", { storeId, name:"V11项目保护顾客", phone:"09020270102", staffId:staffA,
      startAt:t(D.serviceGuard,"14:00"), selections:[{serviceId:service.body.id}] });
    expect(booked.status).toBe(201);
    expect((await put(`/admin/services/${service.body.id}`, { active:false }, managerToken)).status).toBe(409);
    expect((await put(`/admin/services/${service.body.id}`, { resourceType:"nail_table" }, managerToken)).status).toBe(409);
    expect((await req(`/admin/services/${service.body.id}`, { method:"DELETE", token:managerToken })).status).toBe(409);
    expect((await put(`/admin/services/${service.body.id}`, { nameJa:"V11予約継続", priceJpy:6000 }, managerToken)).status).toBe(200);
    expect((await post(`/admin/appointments/${booked.body.id}/cancel`, {}, managerToken)).status).toBe(200);
    expect((await req(`/admin/services/${service.body.id}`, { method:"DELETE", token:managerToken })).status).toBe(200);
  });
});


/* V12: PostgreSQL-backed receipt/refund idempotency, locking and audit atomicity. */
describe("V12 收款与退款弱网重试：不重复流水", () => {
  const paidAt = (day: string, hour: number) => t(day, `${String(hour).padStart(2,"0")}:00`);
  const keyedPost = (path: string, body: unknown, key: string, token = managerToken) =>
    req(path, {method:"POST",body:JSON.stringify(body),token,
      headers:{"Idempotency-Key":key}});

  it("同一笔收款并发和重试只建一笔，记一次审计，改金额返回 409", async () => {
    const key="128d140e-5783-4b7d-9cc2-64d545a67001";
    const receipt={amountJpy:7200,method:"cash",paidAt:paidAt("2026-11-07",11)};
    const [a,b]=await Promise.all([
      keyedPost("/admin/payments",receipt,key),keyedPost("/admin/payments",receipt,key),
    ]);
    expect([a.status,b.status].sort()).toEqual([200,201]);
    expect(a.body.id).toBe(b.body.id);
    expect(a.body.idempotencyKey).toBeUndefined();
    const replay=await keyedPost("/admin/payments",receipt,key);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(a.body.id);
    expect((await keyedPost("/admin/payments",{...receipt,amountJpy:7300},key)).status).toBe(409);
    expect((await keyedPost("/admin/payments",receipt,key,staffToken)).status).toBe(403);
    const rows=await handle.db.select().from(schema.payments).where(eq(schema.payments.idempotencyKey,key));
    expect(rows).toHaveLength(1);
    const audits=await handle.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId,a.body.id));
    expect(audits.filter(x=>x.action==="payment.create")).toHaveLength(1);
  });

  it("当日日结以后已成功交易仍可按同一个 UUID 读回，新的交易被拒绝", async () => {
    const key="128d140e-5783-4b7d-9cc2-64d545a67002";
    const body={amountJpy:5000,method:"card",paidAt:paidAt("2026-11-08",12)};
    const first=await keyedPost("/admin/payments",body,key);
    expect(first.status).toBe(201);
    const close=await post("/admin/cash-close",{
      date:"2026-11-08",openingCashJpy:0,countedCashJpy:0,expectedTransactionCount:1,
    },managerToken);
    expect(close.status).toBe(201);
    const replay=await keyedPost("/admin/payments",body,key);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect((await keyedPost("/admin/payments",body,"128d140e-5783-4b7d-9cc2-64d545a67012")).status).toBe(409);
  });

  it("退款并发与跨操作 UUID 冲突不重复减款，审计只创建一次", async () => {
    const receiptKey="128d140e-5783-4b7d-9cc2-64d545a67003";
    const orig=await keyedPost("/admin/payments",{
      amountJpy:8500,method:"paypay",paidAt:paidAt("2026-11-06",11),
    },receiptKey);
    expect(orig.status).toBe(201);
    const refundPath=`/admin/payments/${orig.body.id}/refund`;
    const body={amountJpy:3000,paidAt:paidAt("2026-11-09",13)};
    expect((await keyedPost(refundPath,body,receiptKey)).status).toBe(409);
    const refundKey="128d140e-5783-4b7d-9cc2-64d545a67004";
    const [a,b]=await Promise.all([
      keyedPost(refundPath,body,refundKey),keyedPost(refundPath,body,refundKey),
    ]);
    expect([a.status,b.status].sort()).toEqual([200,201]);
    expect(a.body.id).toBe(b.body.id);
    expect(a.body.amountJpy).toBe(-3000);
    expect((await keyedPost(refundPath,{...body,amountJpy:3100},refundKey)).status).toBe(409);
    const refunds=await handle.db.select().from(schema.payments).where(eq(schema.payments.refundOfId,orig.body.id));
    expect(refunds).toHaveLength(1);
    const [original]=await handle.db.select().from(schema.payments).where(eq(schema.payments.id,orig.body.id));
    expect(original?.status).toBe("partially_refunded");
    const audit=await handle.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId,orig.body.id));
    expect(audit.filter(x=>x.action==="payment.refund")).toHaveLength(1);
    // Same refund can still be recovered after its business day is closed.
    const close=await post("/admin/cash-close",{
      date:"2026-11-09",openingCashJpy:0,countedCashJpy:0,expectedTransactionCount:1,
    },managerToken);
    expect(close.status).toBe(201);
    expect((await keyedPost(refundPath,body,refundKey)).status).toBe(200);
  });
});


describe("V13 中日授权桥接接口：真实 PostgreSQL / 审核隔离", () => {
  const secretHex = "bd".repeat(32);
  async function bridge(event: unknown, opts?: { tamper?: boolean; badKey?: boolean }) {
    const config = loadConfig({ DATABASE_URL: TEST_DB_URL, QUEUE_DRIVER: "db", TRUST_PROXY: "true",
      JWT_SECRET: "test-secret-test-secret-123456", PARTNER_WEBHOOK_KEYS_JSON:
      JSON.stringify({ [`${storeId}:cn_meituan`]: secretHex }) });
    const securedApp = buildApp({ db: handle.db, config, notifier: createNotifier(config) });
    const body = JSON.stringify(event);
    const now = Math.floor(Date.now() / 1000);
    const sig = signedPayload(Buffer.from(opts?.badKey ? "aa".repeat(32) : secretHex, "hex"), now, Buffer.from(body));
    const res = await securedApp.fetch(new Request(`http://test/integrations/bridge/${storeId}/cn_meituan/events`, {
      method: "POST", body: opts?.tamper ? body + " " : body,
      headers: { "Content-Type": "application/json", "X-Salon-Timestamp": String(now),
        "X-Salon-Signature": `sha256=${sig}` },
    }));
    return { status: res.status, body: (await res.json()) as any };
  }

  it("same signed booking event is saved once; reuse eventId with changed content -> 409", async () => {
    const event = { eventId: "cn-event-1", bookingRef: "cn-order-1", eventType: "booking_requested",
      startAt: t(D.integration, "14:00"), endAt: t(D.integration, "15:00"), serviceRef: "nails" };
    const a = await bridge(event);
    expect(a.status).toBe(202);
    expect(a.body.reviewState).toBe("needs_mapping");
    const same = await bridge(event);
    expect(same.status).toBe(200);
    expect(same.body.id).toBe(a.body.id);
    expect((await bridge({ ...event, serviceRef: "lashes" })).status).toBe(409);
    expect((await bridge(event, { tamper: true })).status).toBe(401);
    expect((await bridge(event, { badKey: true })).status).toBe(401);
    const all = await handle.db.select().from(schema.integrationInbox)
      .where(eq(schema.integrationInbox.externalEventId, "cn-event-1"));
    expect(all).toHaveLength(1);
  });

  it("intake cannot auto-book, manager sees inbox and staff cannot see; linking requires existing booking", async () => {
    const event = { eventId: "cn-event-2", bookingRef: "cn-order-2", eventType: "booking_requested",
      startAt: t(D.integration, "16:00"), endAt: t(D.integration, "17:00"),
      localStaffId: staffA, localServiceId: svcGel };
    const received = await bridge(event);
    expect(received.status).toBe(202);
    expect(received.body.reviewState).toBe("pending");
    expect((await req("/admin/integrations/inbox", { token: staffToken })).status).toBe(403);
    const manager = await req("/admin/integrations/inbox", { token: managerToken });
    expect(manager.status).toBe(200);
    expect(manager.body.some((r: any) => r.id === received.body.id)).toBe(true);
    expect(manager.body[0].payloadDigest).toBeUndefined();
    expect((await post(`/admin/integrations/inbox/${received.body.id}/resolve`,
      { resolution: "linked", appointmentId: "11111111-1111-4111-8111-111111111111" }, managerToken)).status).toBe(400);
    const localBooking = await post("/admin/appointments", {
      customerName: "Integration Test", customerPhone: "09012345678", staffId: staffA,
      startAt: event.startAt, selections: [{ serviceId: svcGel }], source: "admin",
    }, managerToken);
    expect(localBooking.status).toBe(201);
    const linked = await post(`/admin/integrations/inbox/${received.body.id}/resolve`,
      { resolution: "linked", appointmentId: localBooking.body.id }, managerToken);
    expect(linked.status).toBe(200);
    expect(linked.body.reviewState).toBe("linked");
    const collision = await bridge({ ...event, eventId: "cn-event-3", bookingRef: "cn-order-3" });
    expect(collision.status).toBe(202);
    expect(collision.body.reviewState).toBe("conflict");
    expect((await post(`/admin/integrations/inbox/${received.body.id}/resolve`,
      { resolution: "ignored" }, managerToken)).status).toBe(409);
  });

  it("exports keep customer private and are limited to managers", async () => {
    const from = encodeURIComponent(t(D.integration, "00:00"));
    const to = encodeURIComponent(t("2027-05-13", "00:00"));
    const csv = await req(`/admin/integrations/appointments.csv?from=${from}&to=${to}`, { token: managerToken });
    expect(csv.status).toBe(200);
    expect(String(csv.body)).not.toContain("09012345678");
    expect(String(csv.body)).not.toContain("Integration Test");
    expect((await req(`/admin/integrations/appointments.csv?from=${from}&to=${to}`, { token: staffToken })).status).toBe(403);
  });
});
