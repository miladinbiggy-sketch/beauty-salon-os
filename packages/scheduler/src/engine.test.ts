import { describe, expect, it } from "vitest";
import { tokyoMs } from "@salon/shared";
import { findAvailability, planCombo, validatePlacement } from "./engine.js";
import type { ScheduleContext } from "./types.js";

const DATE = "2026-11-20"; // 周五
const t = (hhmm: string) => tokyoMs(DATE, hhmm);

function baseContext(overrides: Partial<ScheduleContext> = {}): ScheduleContext {
  return {
    storeOpenMs: t("10:00"),
    storeCloseMs: t("20:00"),
    services: new Map([
      ["gel", { id: "gel", durationMinutes: 60, bufferMinutes: 10, resourceType: "nail_table", priceJpy: 8000 }],
      ["lash", { id: "lash", durationMinutes: 90, bufferMinutes: 15, resourceType: "lash_bed", priceJpy: 9000 }],
      ["facial", { id: "facial", durationMinutes: 45, bufferMinutes: 10, resourceType: "beauty_bed", priceJpy: 6000 }],
      ["care", { id: "care", durationMinutes: 30, bufferMinutes: 0, resourceType: null, priceJpy: 3000 }],
    ]),
    staff: [
      { id: "A", skillServiceIds: ["gel", "lash", "care"] },
      { id: "B", skillServiceIds: ["gel", "care"] },
      { id: "C", skillServiceIds: ["facial", "care"] },
      { id: "D", skillServiceIds: ["lash"] },
    ],
    resources: [
      { id: "NT1", type: "nail_table" },
      { id: "NT2", type: "nail_table" },
      { id: "LB1", type: "lash_bed" },
      { id: "BB1", type: "beauty_bed" },
    ],
    shifts: [
      { staffId: "A", startMs: t("10:00"), endMs: t("19:00"), breaks: [{ startMs: t("13:00"), endMs: t("14:00") }] },
      { staffId: "B", startMs: t("10:00"), endMs: t("18:00"), breaks: [] },
      { staffId: "C", startMs: t("12:00"), endMs: t("20:00"), breaks: [] },
      { staffId: "D", startMs: t("10:00"), endMs: t("19:00"), breaks: [] },
    ],
    blocked: [],
    staffBusy: [],
    resourceBusy: [],
    ...overrides,
  };
}

const codes = (r: ReturnType<typeof validatePlacement>) =>
  r.ok ? [] : r.conflicts.map((c) => c.code);

describe("planCombo 组合服务时间链", () => {
  it("多项目连续排布：段间插入上一段清洁缓冲", () => {
    const plan = planCombo(baseContext(), ["gel", "care"])!;
    expect(plan.segments.map((s) => s.offsetStartMin)).toEqual([0, 70]);
    expect(plan.customerMinutes).toBe(100); // 60 + 10缓冲 + 30
    expect(plan.blockedMinutes).toBe(100); // care 无尾部缓冲
    expect(plan.totalPriceJpy).toBe(11000);
  });

  it("尾部缓冲计入占用但不计入顾客时长", () => {
    const plan = planCombo(baseContext(), ["gel", "gel"])!;
    expect(plan.customerMinutes).toBe(130);
    expect(plan.blockedMinutes).toBe(140);
  });

  it("未知项目返回 null", () => {
    expect(planCombo(baseContext(), ["nope"])).toBeNull();
    expect(planCombo(baseContext(), [])).toBeNull();
  });
});

describe("validatePlacement 基础与技师冲突", () => {
  it("空闲时段可预约并分配工位", () => {
    const r = validatePlacement(baseContext(), { staffId: "A", serviceIds: ["gel"], startMs: t("10:00") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resourceIds).toEqual(["NT1"]);
      expect(r.customerEndMs).toBe(t("11:00"));
      expect(r.blockedEndMs).toBe(t("11:10"));
    }
  });

  it("同一技师重复预约被拒绝（含缓冲重叠）", () => {
    const ctx = baseContext({
      staffBusy: [{ staffId: "A", startMs: t("10:00"), endMs: t("11:10"), appointmentId: "X" }],
      resourceBusy: [{ resourceId: "NT1", startMs: t("10:00"), endMs: t("11:10"), appointmentId: "X" }],
    });
    const clash = validatePlacement(ctx, { staffId: "A", serviceIds: ["gel"], startMs: t("10:30") });
    expect(clash.ok).toBe(false);
    expect(codes(clash)).toContain("staff_busy");
    if (!clash.ok) expect(clash.conflicts[0]!.conflictingAppointmentId).toBe("X");
    // 11:00 开始仍压在 X 的清洁缓冲（到 11:10）上
    expect(codes(validatePlacement(ctx, { staffId: "A", serviceIds: ["care"], startMs: t("11:00") }))).toContain("staff_busy");
    // 11:10 起恰好衔接
    expect(validatePlacement(ctx, { staffId: "A", serviceIds: ["gel"], startMs: t("11:10") }).ok).toBe(true);
  });

  it("技能不足被拒绝", () => {
    const r = validatePlacement(baseContext(), { staffId: "B", serviceIds: ["lash"], startMs: t("10:00") });
    expect(codes(r)).toContain("skill_missing");
  });
});

describe("工位（资源）约束", () => {
  it("不同技师共用唯一美睫床时冲突", () => {
    const ctx = baseContext({
      staffBusy: [{ staffId: "A", startMs: t("10:00"), endMs: t("11:45"), appointmentId: "Y" }],
      resourceBusy: [{ resourceId: "LB1", startMs: t("10:00"), endMs: t("11:45"), appointmentId: "Y" }],
    });
    // D 本人空闲，但美睫床被 A 占用
    const r = validatePlacement(ctx, { staffId: "D", serviceIds: ["lash"], startMs: t("10:30") });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("resource_busy");
    expect(codes(r)).not.toContain("staff_busy");
    // 床释放后可约
    expect(validatePlacement(ctx, { staffId: "D", serviceIds: ["lash"], startMs: t("11:45") }).ok).toBe(true);
  });

  it("工位维护封锁导致 resource_blocked", () => {
    const ctx = baseContext({
      blocked: [{ resourceId: "LB1", startMs: t("10:00"), endMs: t("20:00") }],
    });
    const r = validatePlacement(ctx, { staffId: "D", serviceIds: ["lash"], startMs: t("12:00") });
    expect(codes(r)).toContain("resource_blocked");
  });

  it("两张美甲桌时第二位顾客可并行", () => {
    const ctx = baseContext({
      staffBusy: [{ staffId: "A", startMs: t("10:00"), endMs: t("11:10"), appointmentId: "X" }],
      resourceBusy: [{ resourceId: "NT1", startMs: t("10:00"), endMs: t("11:10"), appointmentId: "X" }],
    });
    const r = validatePlacement(ctx, { staffId: "B", serviceIds: ["gel"], startMs: t("10:00") });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resourceIds).toEqual(["NT2"]);
  });
});

describe("组合服务跨时间段", () => {
  it("第二段所需工位在中途被占则整单冲突", () => {
    // gel(10:00-11:00,+10) → lash 从 11:10 开始，需要 LB1 11:10-12:55；LB1 12:00 被占
    const ctx = baseContext({
      resourceBusy: [{ resourceId: "LB1", startMs: t("12:00"), endMs: t("13:00"), appointmentId: "Z" }],
    });
    const r = validatePlacement(ctx, { staffId: "A", serviceIds: ["gel", "lash"], startMs: t("10:00") });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("resource_busy");
    if (!r.ok) expect(r.conflicts.find((c) => c.code === "resource_busy")!.serviceId).toBe("lash");
  });

  it("组合服务完整通过时给出总时长与分段工位", () => {
    const r = validatePlacement(baseContext(), { staffId: "A", serviceIds: ["gel", "lash"], startMs: t("10:00") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.customerEndMs).toBe(t("12:40")); // 60+10+90
      expect(r.blockedEndMs).toBe(t("12:55")); // +15 尾部缓冲
      expect(r.resourceIds).toEqual(["NT1", "LB1"]);
    }
  });
});

describe("取消释放与改期", () => {
  it("预约取消后（占用移除）同一时段可再约", () => {
    const busyCtx = baseContext({
      staffBusy: [{ staffId: "A", startMs: t("15:00"), endMs: t("16:10"), appointmentId: "X" }],
      resourceBusy: [{ resourceId: "NT1", startMs: t("15:00"), endMs: t("16:10"), appointmentId: "X" }],
    });
    expect(validatePlacement(busyCtx, { staffId: "A", serviceIds: ["gel"], startMs: t("15:00") }).ok).toBe(false);
    const freedCtx = baseContext(); // 取消 = 从快照中移除该预约的占用
    expect(validatePlacement(freedCtx, { staffId: "A", serviceIds: ["gel"], startMs: t("15:00") }).ok).toBe(true);
  });

  it("改期时排除自身占用；移到他人时段则冲突", () => {
    const ctx = baseContext({
      staffBusy: [
        { staffId: "A", startMs: t("15:00"), endMs: t("16:10"), appointmentId: "Y" },
        { staffId: "A", startMs: t("17:00"), endMs: t("18:10"), appointmentId: "Z" },
      ],
      resourceBusy: [
        { resourceId: "NT1", startMs: t("15:00"), endMs: t("16:10"), appointmentId: "Y" },
        { resourceId: "NT2", startMs: t("17:00"), endMs: t("18:10"), appointmentId: "Z" },
      ],
    });
    // 原地不动（改期校验带 ignoreAppointmentId）→ 通过
    expect(
      validatePlacement(ctx, { staffId: "A", serviceIds: ["gel"], startMs: t("15:00"), ignoreAppointmentId: "Y" }).ok,
    ).toBe(true);
    // 移到 Z 的时段 → 技师冲突
    const moved = validatePlacement(ctx, {
      staffId: "A",
      serviceIds: ["gel"],
      startMs: t("17:00"),
      ignoreAppointmentId: "Y",
    });
    expect(codes(moved)).toContain("staff_busy");
  });
});

describe("排班、午休、请假、营业时间", () => {
  it("员工临时请假当天不可约", () => {
    const ctx = baseContext({ blocked: [{ staffId: "A", startMs: t("00:00"), endMs: t("23:59") }] });
    expect(codes(validatePlacement(ctx, { staffId: "A", serviceIds: ["gel"], startMs: t("10:00") }))).toContain("staff_blocked");
    // 其他员工不受影响
    expect(validatePlacement(ctx, { staffId: "B", serviceIds: ["gel"], startMs: t("10:00") }).ok).toBe(true);
  });

  it("服务时段压午休被拒绝；缓冲尾巴压午休开始允许", () => {
    expect(codes(validatePlacement(baseContext(), { staffId: "A", serviceIds: ["gel"], startMs: t("12:30") }))).toContain("staff_on_break");
    // 12:00-13:00 服务，13:00 午休开始，缓冲 13:00-13:10 允许
    expect(validatePlacement(baseContext(), { staffId: "A", serviceIds: ["gel"], startMs: t("12:00") }).ok).toBe(true);
  });

  it("超出班次与营业时间被拒绝", () => {
    expect(codes(validatePlacement(baseContext(), { staffId: "A", serviceIds: ["gel"], startMs: t("18:30") }))).toContain("staff_not_working");
    expect(codes(validatePlacement(baseContext(), { staffId: "B", serviceIds: ["gel"], startMs: t("09:30") }))).toContain("outside_business_hours");
    expect(codes(validatePlacement(baseContext(), { staffId: "C", serviceIds: ["facial"], startMs: t("11:00") }))).toContain("staff_not_working");
    // C 的 facial 19:15 开始、20:00 结束恰好打烊 → 通过（缓冲越过打烊允许）
    expect(validatePlacement(baseContext(), { staffId: "C", serviceIds: ["facial"], startMs: t("19:15") }).ok).toBe(true);
  });
});

describe("findAvailability 空闲时间计算", () => {
  it("不指定技师时返回所有会做该项目的技师的空位", () => {
    const opts = findAvailability(baseContext(), {
      serviceIds: ["lash"],
      windowStartMs: t("10:00"),
      windowEndMs: t("20:00"),
      stepMinutes: 15,
    });
    expect(opts.length).toBeGreaterThan(0);
    expect(new Set(opts.map((o) => o.staffId))).toEqual(new Set(["A", "D"])); // B/C 不会美睫
  });

  it("已有预约会推迟可约时间（网格对齐）", () => {
    const ctx = baseContext({
      staffBusy: [{ staffId: "A", startMs: t("10:00"), endMs: t("11:10"), appointmentId: "X" }],
      resourceBusy: [{ resourceId: "NT1", startMs: t("10:00"), endMs: t("11:10"), appointmentId: "X" }],
    });
    const opts = findAvailability(ctx, {
      serviceIds: ["gel"],
      staffId: "A",
      windowStartMs: t("10:00"),
      windowEndMs: t("20:00"),
      stepMinutes: 15,
    });
    expect(opts[0]!.startMs).toBe(t("11:15")); // 11:00 仍压缓冲，网格下一格 11:15
  });

  it("午休时段不会出现在可选时间里", () => {
    const opts = findAvailability(baseContext(), {
      serviceIds: ["gel"],
      staffId: "A",
      windowStartMs: t("10:00"),
      windowEndMs: t("20:00"),
      stepMinutes: 15,
    });
    const bad = opts.filter((o) => o.startMs < t("14:00") && o.customerEndMs > t("13:00"));
    expect(bad).toEqual([]);
    expect(opts.some((o) => o.startMs === t("12:00"))).toBe(true);
  });

  it("窗口外不返回（最晚预约时间约束）", () => {
    const opts = findAvailability(baseContext(), {
      serviceIds: ["gel"],
      staffId: "B",
      windowStartMs: t("16:00"),
      windowEndMs: t("17:00"),
      stepMinutes: 15,
    });
    expect(opts.every((o) => o.customerEndMs <= t("17:00"))).toBe(true);
    expect(opts.length).toBeGreaterThan(0);
  });
});

describe("并发抢约的检查-提交模式（引擎层说明性测试）", () => {
  it("同一快照两次校验都通过，但串行提交后第二次必须失败 —— 故 API 必须在事务内校验", () => {
    const ctx = baseContext();
    const req = { staffId: "A", serviceIds: ["gel"], startMs: t("10:00") };
    expect(validatePlacement(ctx, req).ok).toBe(true);
    expect(validatePlacement(ctx, req).ok).toBe(true); // 快照未变 → 都通过（危险窗口）
    // 第一个提交后把占用写回快照（模拟事务串行化后的可见性）
    const afterFirst = baseContext({
      staffBusy: [{ staffId: "A", startMs: t("10:00"), endMs: t("11:10"), appointmentId: "first" }],
      resourceBusy: [{ resourceId: "NT1", startMs: t("10:00"), endMs: t("11:10"), appointmentId: "first" }],
    });
    expect(codes(validatePlacement(afterFirst, req))).toContain("staff_busy");
  });
});
