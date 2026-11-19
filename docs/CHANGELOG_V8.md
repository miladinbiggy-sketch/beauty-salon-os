# Beauty Salon OS V8 — 已有预约与临时封锁冲突保护（2026-11-19）

## 基线与升级状态
- 本地已核验 `Beauty_Salon_OS_V7_预约幂等重试与丢失回执恢复源码.zip` 的 SHA-256：`f96cc8545f985bc7a6d48c80ac55cceb1377edbadc0e1c7059ecdf2d562df019`，在 V7 的全部 V6/V5.1 功能上开发本版。
- **重要**：本轮尝试将 V7 入库到 `/Beauty Salon OS`，工具返回 `AccessDeny`。因此 V7/V8 都必须在成功入库及真实集成测试后才可标为文件库正式版本；不得宣称已完成生产升级。运行中的库内已知最后验证文件仍为 V6。

## 修复场景 A：临时请假/设备维护覆盖已接待顾客
以前店长可以给已经有预约的技师加请假，或维护预约中使用的美睫床；数据库保留预约，但前台显示不可约，容易出现到店后无人接待。且先检查再插入会与顾客实时预约并发竞争。

现在 `POST /admin/blocked-times`：
1. 使用与 `createBooking/rescheduleBooking/cancelBooking` **相同的门店 PostgreSQL 事务 advisory lock**（`storeLock`），保证检查与封锁写入同事务。
2. 只以 `resource_allocations` 的**有效**技师/设备占用为准（含服务结束后清洁缓冲）；排除已取消、no-show 释放的占用。
3. 在 `[start, end)` 半开时段检测冲突（允许刚好相邻），阻止与现有预约或同一技师/设备已封锁时段重叠；返回 HTTP 409 和冲突预约 ID/封锁 ID 供店长处理。
4. 校验门店技师/设备所有权、时间先后及最多 366 天，成功后与封锁同事务写**不包含请假原因明文**的操作审计。
5. 依旧可以先为顾客改期/取消，再创建请假或维护封锁；不自动取消顾客订单。

## 修复场景 B：错误班次和午休导致线上预约错误
以前手动/批量生成的班次没有严格校验，可能出现跨午夜、不在班次内的休息、重叠休息，甚至同日重复班次；删除一个有未处理预约的班次可能把已有订单变成“技师不上班”状态。

现在：
1. 独立 `schedule-guards.ts` 对日本营业日做真实日历检查（含闰日），要求班次不跨午夜，午休全部落在班次内且不重叠。
2. 单条新增与批量生成班次都在同一门店写锁和事务中执行，拒绝重复 (staff,date) 与重复模板 (staff,weekday)；批量生成失败不会留下一半排班。
3. 删除班次前阻止删除当日仍存在有效预约的技师班次，返回 409 提醒先改期/取消。增加创建/删除/批量生成审计。
4. 员工页面针对冲突/校验错误给出中日双语说明，不再只显示“操作失败”，并提示先去日历调整已有预约。
5. 请假/病假原因是敏感员工信息：`GET /admin/blocked-times` 仅店主/店长能看；封锁删除在同一写锁事务中执行并记录不含原因的审计。

## 涉及文件
- `apps/api/src/routes/admin.ts`: 预约与封锁/班次写入串行化；冲突查询；完整事务/审计。
- `apps/api/src/services/booking.ts`: `storeLock` 导出供门店其它预约资源写入使用。
- `apps/api/src/services/schedule-guards.ts`: 纯函数校验日本日期、班次和封锁时段。
- `apps/admin-web/src/pages/Staff.tsx`: 冲突二语引导、表单休息时间配对校验。
- `packages/i18n/src/{ja,zh-CN}.ts`: 冲突和校验错误词条。
- `apps/api/src/api.test.ts`: 5 组新增 PostgreSQL 集成测试（**仅编写，未在本环境执行**）。
- `tests/schedule-guards-unit.test.mjs`: 4 项 Node 内置单测（已执行）。
- `docs/COMPETITOR_RESEARCH.md`, `docs/BUILD_REPORT_V8.json`, `README.md`, `package*.json`。
- **本版不增加数据库迁移**，沿用 0000–0005，但部署 V7→V8 仍要求完成 V7 的 `0005_booking_idempotency.sql` 迁移。

## 验证与残余风险
- 已运行：Node 内置 10/10 单元测试通过（含原 V6/V7 共 6 项和 V8 新增 4 项）；83 个 TS/TSX 文件 TypeScript 语法解析无错误；相对导入路径全解析通过；ZIP 校验将记录于 BUILD_REPORT_V8。
- 未通过：完整 `npm run typecheck`，当前环境无项目依赖 `luxon`, `drizzle-orm`, `vitest`, `@types/node` 等，TypeScript 报错不可据此判断产品类型正确；无法运行 `vitest`/真实 PostgreSQL/浏览器 E2E。
- 风险：**跨表业务约束由 API 同门店事务锁保证，不是数据库跨表硬约束**；若运维直接写 SQL 或还有其它未上锁的管理路径，仍可绕过保护。历史已有冲突封锁/重复排班不自动清理，需另行做数据修复脚本及数据库巡检；资源停用、改营业时间、强制更改技师技能的其它管理入口仍需后续锁与预约检查。
- 各门店营业日为 Asia/Tokyo；禁跨日班次是当前产品明确约束。上线须安排备份、灰度、升级所有 API 实例并完整复测，不能直接商用。

## 回滚
- V8 无新增迁移，若出现不可控错误可回退应用到 V7，保留 0005 schema 和业务数据。
- 不要通过直接写 SQL 删除/合并历史预约或封锁来绕开冲突提示；先到日历为客户调整预约。
