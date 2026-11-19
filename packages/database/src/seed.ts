import { eq } from "drizzle-orm";
import { addDaysTokyo, todayTokyo, tokyoMs, DEFAULT_STORE_SETTINGS } from "@salon/shared";
import { createDb, databaseUrlFromEnv } from "./index.js";
import { hashPassword } from "./password.js";
import * as s from "./schema.js";

/**
 * 演示种子数据（明确标注为 DEMO）：一家东京美容店、9 个项目、4 名技师、
 * 7 个工位、未来 14 天排班、5 位顾客与少量预约。
 * 演示账号（密码均为 demo1234）：
 *   owner@demo.salon / manager@demo.salon / staff@demo.salon
 * 幂等：门店已存在则跳过。
 */

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const DEMO_PASSWORD = "demo1234";

const SERVICES = [
  { key: "gel-one", category: "nail", nameZh: "单色凝胶美甲", nameJa: "ジェルネイル ワンカラー", durationMinutes: 60, bufferMinutes: 10, priceJpy: 7500, resourceType: "nail_table", color: "#f472b6" },
  { key: "gel-french", category: "nail", nameZh: "法式凝胶美甲", nameJa: "フレンチネイル", durationMinutes: 90, bufferMinutes: 10, priceJpy: 9500, resourceType: "nail_table", color: "#fb7185" },
  { key: "gel-foot", category: "nail", nameZh: "足部凝胶美甲", nameJa: "フットジェル", durationMinutes: 60, bufferMinutes: 10, priceJpy: 8000, resourceType: "nail_table", color: "#e879f9" },
  { key: "nail-care", category: "nail", nameZh: "卸甲 + 手部护理", nameJa: "オフ＋ハンドケア", durationMinutes: 45, bufferMinutes: 5, priceJpy: 4500, resourceType: "nail_table", color: "#fda4af" },
  { key: "lash-ext", category: "lash", nameZh: "美睫嫁接 120 根", nameJa: "まつげエクステ 120本", durationMinutes: 90, bufferMinutes: 15, priceJpy: 8900, resourceType: "lash_bed", color: "#a78bfa" },
  { key: "lash-perm", category: "lash", nameZh: "睫毛烫", nameJa: "まつげパーマ", durationMinutes: 60, bufferMinutes: 10, priceJpy: 6500, resourceType: "lash_bed", color: "#818cf8" },
  { key: "facial-basic", category: "beauty", nameZh: "基础面部护理", nameJa: "フェイシャル ベーシック", durationMinutes: 60, bufferMinutes: 10, priceJpy: 9800, resourceType: "beauty_bed", color: "#34d399" },
  { key: "facial-pore", category: "beauty", nameZh: "毛孔深层清洁", nameJa: "毛穴ディープクレンジング", durationMinutes: 45, bufferMinutes: 10, priceJpy: 7800, resourceType: "beauty_bed", color: "#2dd4bf" },
  { key: "hair-removal", category: "beauty", nameZh: "腋下脱毛", nameJa: "脇脱毛", durationMinutes: 30, bufferMinutes: 5, priceJpy: 3800, resourceType: "beauty_bed", color: "#6ee7b7" },
] as const;

const STAFF_DEFS = [
  { key: "sato", name: "佐藤 美咲", nameJa: "佐藤 美咲", color: "#ec4899", skills: ["gel-one", "gel-french", "gel-foot", "nail-care"], shift: { start: "10:00", end: "19:00", breakStart: "13:00", breakEnd: "14:00" } },
  { key: "tanaka", name: "田中 健", nameJa: "田中 健", color: "#3b82f6", skills: ["gel-one", "gel-foot", "nail-care"], shift: { start: "10:00", end: "18:00", breakStart: null, breakEnd: null } },
  { key: "suzuki", name: "鈴木 愛", nameJa: "鈴木 愛", color: "#8b5cf6", skills: ["lash-ext", "lash-perm"], shift: { start: "11:00", end: "20:00", breakStart: "14:00", breakEnd: "15:00" } },
  { key: "takahashi", name: "高橋 葵", nameJa: "高橋 葵", color: "#10b981", skills: ["facial-basic", "facial-pore", "hair-removal", "lash-perm"], shift: { start: "12:00", end: "20:00", breakStart: null, breakEnd: null } },
] as const;

const RESOURCES = [
  { type: "nail_table", name: "美甲桌 1" },
  { type: "nail_table", name: "美甲桌 2" },
  { type: "nail_table", name: "美甲桌 3" },
  { type: "lash_bed", name: "美睫床 1" },
  { type: "lash_bed", name: "美睫床 2" },
  { type: "beauty_bed", name: "美容床 1" },
  { type: "beauty_bed", name: "美容床 2" },
] as const;

const CUSTOMERS = [
  { name: "山田 花", nameKana: "ヤマダ ハナ", phone: "09011112222", email: "hana@example.jp" },
  { name: "李 小雨", nameKana: "リ シャオユー", phone: "08033334444", email: null },
  { name: "佐佐木 希", nameKana: "ササキ ノゾミ", phone: "07055556666", email: null },
  { name: "王 美玲", nameKana: "オウ メイリン", phone: "09077778888", email: "meiling@example.cn" },
  { name: "中村 結衣", nameKana: "ナカムラ ユイ", phone: "08099990000", email: null },
] as const;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demonstration accounts in production");
  }
  const handle = createDb(databaseUrlFromEnv());
  const db = handle.db;
  try {
    const [existing] = await db.select().from(s.stores).where(eq(s.stores.id, STORE_ID));
    if (existing) {
      console.log("Seed skipped: demo store already exists.");
      return;
    }

    await db.insert(s.stores).values({
      id: STORE_ID,
      name: "Salon Lumière 涩谷店（演示）",
      nameJa: "サロン ルミエール 渋谷店（デモ）",
      phone: "03-0000-0000",
      address: "東京都渋谷区道玄坂 1-2-3",
      settings: { ...DEFAULT_STORE_SETTINGS },
    });

    // 营业时间：周二休息，其余 10:00–20:00
    for (let weekday = 1; weekday <= 7; weekday++) {
      await db.insert(s.businessHours).values({
        storeId: STORE_ID,
        weekday,
        openTime: "10:00",
        closeTime: "20:00",
        isClosed: weekday === 2,
      });
    }

    await db.insert(s.roles).values([
      { name: "owner", permissions: ["*"] },
      { name: "manager", permissions: ["appointments:*", "customers:*", "services:*", "staff:*", "payments:*", "reports:read", "settings:write"] },
      { name: "staff", permissions: ["appointments:own", "customers:assigned"] },
    ]);

    const serviceIds = new Map<string, string>();
    for (const [i, svc] of SERVICES.entries()) {
      const [row] = await db
        .insert(s.services)
        .values({ storeId: STORE_ID, sortOrder: i, ...svc })
        .returning();
      serviceIds.set(svc.key, row!.id);
    }
    const gelId = serviceIds.get("gel-one")!;
    await db.insert(s.serviceAddons).values([
      { serviceId: gelId, nameZh: "水钻装饰（1 颗）", nameJa: "ストーンアート（1粒）", priceJpy: 500, durationMinutes: 5 },
      { serviceId: gelId, nameZh: "延长甲片（1 根）", nameJa: "長さ出し（1本）", priceJpy: 800, durationMinutes: 10 },
      { serviceId: serviceIds.get("lash-ext")!, nameZh: "下睫毛追加", nameJa: "下まつげ追加", priceJpy: 1500, durationMinutes: 15 },
    ]);

    const staffIds = new Map<string, string>();
    for (const [i, st] of STAFF_DEFS.entries()) {
      const [row] = await db
        .insert(s.staff)
        .values({ storeId: STORE_ID, name: st.name, nameJa: st.nameJa, color: st.color, sortOrder: i })
        .returning();
      staffIds.set(st.key, row!.id);
      await db.insert(s.staffSkills).values(
        st.skills.map((k) => ({ staffId: row!.id, serviceId: serviceIds.get(k)! })),
      );
    }

    const resourceIds: string[] = [];
    for (const r of RESOURCES) {
      const [row] = await db.insert(s.resources).values({ storeId: STORE_ID, ...r }).returning();
      resourceIds.push(row!.id);
    }

    const passwordHash = hashPassword(DEMO_PASSWORD);
    await db.insert(s.users).values([
      { storeId: STORE_ID, email: "owner@demo.salon", passwordHash, role: "owner", name: "店主（演示）" },
      { storeId: STORE_ID, email: "manager@demo.salon", passwordHash, role: "manager", name: "店长（演示）" },
      { storeId: STORE_ID, email: "staff@demo.salon", passwordHash, role: "staff", name: "佐藤 美咲", staffId: staffIds.get("sato") },
    ]);

    const customerIds: string[] = [];
    for (const cust of CUSTOMERS) {
      const [row] = await db.insert(s.customers).values({ storeId: STORE_ID, ...cust }).returning();
      customerIds.push(row!.id);
    }

    // 未来 14 天排班（跳过周二休息日）
    const today = todayTokyo();
    for (let d = 0; d < 14; d++) {
      const date = addDaysTokyo(today, d);
      if (isTuesdayDate(date)) continue; // 周二店休，不排班
      for (const st of STAFF_DEFS) {
        const [shift] = await db
          .insert(s.shifts)
          .values({ storeId: STORE_ID, staffId: staffIds.get(st.key)!, date, startTime: st.shift.start, endTime: st.shift.end })
          .returning();
        if (st.shift.breakStart && st.shift.breakEnd && shift) {
          await db.insert(s.shiftBreaks).values({ shiftId: shift.id, startTime: st.shift.breakStart, endTime: st.shift.breakEnd });
        }
      }
    }

    // 少量演示预约（今天/明天，时间互不冲突）
    const demoBookings: { cust: number; staffKey: string; svcKey: string; dayOffset: number; start: string; durMin: number; bufMin: number; resourceIdx: number }[] = [
      { cust: 0, staffKey: "sato", svcKey: "gel-one", dayOffset: 0, start: "10:00", durMin: 60, bufMin: 10, resourceIdx: 0 },
      { cust: 1, staffKey: "suzuki", svcKey: "lash-ext", dayOffset: 0, start: "11:00", durMin: 90, bufMin: 15, resourceIdx: 3 },
      { cust: 2, staffKey: "takahashi", svcKey: "facial-basic", dayOffset: 0, start: "13:00", durMin: 60, bufMin: 10, resourceIdx: 5 },
      { cust: 3, staffKey: "sato", svcKey: "gel-french", dayOffset: 1, start: "10:30", durMin: 90, bufMin: 10, resourceIdx: 0 },
    ];
    let codeSeq = 1;
    for (const b of demoBookings) {
      const date = addDaysTokyo(today, b.dayOffset);
      if (isTuesdayDate(date)) continue;
      const svc = SERVICES.find((x) => x.key === b.svcKey)!;
      const startMs = tokyoMs(date, b.start);
      const endMs = startMs + b.durMin * 60_000;
      const blockedEndMs = endMs + b.bufMin * 60_000;
      const [appt] = await db
        .insert(s.appointments)
        .values({
          storeId: STORE_ID,
          customerId: customerIds[b.cust]!,
          staffId: staffIds.get(b.staffKey)!,
          status: "confirmed",
          startAt: new Date(startMs),
          endAt: new Date(endMs),
          blockedEndAt: new Date(blockedEndMs),
          bookingCode: `DEMO000${codeSeq++}`,
          source: "online",
          locale: "ja",
          totalPriceJpy: svc.priceJpy,
        })
        .returning();
      await db.insert(s.appointmentServices).values({
        appointmentId: appt!.id,
        serviceId: serviceIds.get(b.svcKey)!,
        position: 0,
        startAt: new Date(startMs),
        endAt: new Date(endMs),
        priceSnapshotJpy: svc.priceJpy,
        durationSnapshotMin: b.durMin,
        bufferSnapshotMin: b.bufMin,
        resourceTypeSnapshot: svc.resourceType,
        addonsSnapshot: [],
      });
      await db.insert(s.resourceAllocations).values([
        { appointmentId: appt!.id, staffId: staffIds.get(b.staffKey)!, startAt: new Date(startMs), endAt: new Date(blockedEndMs) },
        { appointmentId: appt!.id, resourceId: resourceIds[b.resourceIdx]!, startAt: new Date(startMs), endAt: new Date(blockedEndMs) },
      ]);
    }

    console.log("Seed complete.");
    console.log(`  Store ID: ${STORE_ID}`);
    console.log("  Demo accounts (password demo1234): owner@demo.salon / manager@demo.salon / staff@demo.salon");
  } finally {
    await handle.close();
  }
}

/** 用纯日期算术判断周二（避免时区 API 绕路）：2026-01-06 是周二，之后每 7 天 */
function isTuesdayDate(date: string): boolean {
  const base = Date.UTC(2026, 0, 6); // 2026-01-06 Tuesday
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const cur = Date.UTC(y, m - 1, d);
  const diffDays = Math.round((cur - base) / 86_400_000);
  return ((diffDays % 7) + 7) % 7 === 0;
}

await main();
