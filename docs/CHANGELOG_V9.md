# V9：技师/设备资料变更不得破坏预约（2026-11-19，日本时间）

## 实际业务问题

V8 已能拒绝“技师请假、设备维护覆盖未来预约”，但店长仍可通过技师/工位基础资料维护来绕过保护：

1. `PUT/DELETE /admin/staff/:id` 直接停用技师，使已经预约的顾客突然没有可用技师；`PUT` 移除项目技能时，同样可能使历史有效预约无法继续服务。
2. `PUT/DELETE /admin/resources/:id` 直接停用工位或把“美睫床”改成“美容床”，既有预约的工位占用仍在，但店长端台账与预约规则将不一致。
3. 原先更改员工及工位时没有完整的同事务校验与变更审计；并发新预约可能在“先查后停用”窗口内成功。

## 本轮源码改动

- `apps/api/src/routes/admin.ts`：在员工/工位 `PUT`、`DELETE` 内先取与 `createBooking` 相同的 `storeLock`，在同一 PostgreSQL 事务中检查 `blocked_end_at/end_at > now`、预约状态与有效占用。发现未来/尚在进行的有效预约，返回 HTTP 409 与冲突预约 ID（仅店长/店主可调用）。允许纯改名；不干扰无关联历史预约。取消并释放占用后可重新尝试。变更以最小必要信息写入操作审计。
- 技师技能变更：与技师主资料**同一个事务**，计算被移除的技能 ID，与该技师未来订单 `appointment_services` 比对；失败自动回滚整个改名/技能修改，避免留下部分成功状态。
- `apps/api/src/services/master-data-guards.ts`：单元可验证的变更分类逻辑与技能集合差集。
- `apps/admin-web/src/pages/Staff.tsx`、`Resources.tsx`：HTTP 409 返回的中日文引导，工位列表额外解释预约保护规则。
- `packages/i18n/src/{zh-CN,ja}.ts`：新增错误与操作说明。
- `tests/master-data-guards-unit.test.mjs`：3 个无 DB 纯规则测试；`apps/api/src/api.test.ts`：4 个待运行真实数据库集成用例，覆盖员工停用、技能原子回滚、工位停用/换类型及并发竞争。
- `package.json/package-lock.json`：同步版本 0.9.0，增加独立 `npm run test:unit`。

## 验证、限制和上线前操作

- 纯函数 Node 单测共 13/13 通过（需 `node --experimental-strip-types`，因为环境 Node 22.16.0 不默认读取 `.ts`）。
- 所有 86 个 TS/TSX 文件语法解析无诊断，后续静态导入完整性与 ZIP 校验见 `BUILD_REPORT_V9.json`。
- `npm ci` 安装依赖超时，`npm run typecheck` 因多项依赖不齐失败，**不能证明无 TypeScript 类型错误**。PostgreSQL 集成与浏览器 E2E **未运行**。需要补齐依赖、启动真实测试数据库（建议隔离库）、跑完所有回归和数据迁移演练后再讨论商用发布。
- 本版 **无新增数据库迁移**；从 V6 升到本版仍必须依次应用 V7 的 `0005_booking_idempotency.sql`；保留 V6 的锁账与 V8 的班次规则。
- 限制：PostgreSQL advisory lock 是协作式应用锁；直接 SQL 改主数据仍可能绕过 API 保护。已有历史错误状态不会被自动修复。技能被删后旧预约继续占用的异常数据须单独检查。员工/资源/技能基础资料不做自动改期，以避免未经顾客同意而改服务。
- **交付身份**：V7/V8 文件本轮 SHA256 均已核验，但入库两次都返回 `AccessDeny`；因此本地 V9 只是继承了 V8 的候选源码，未入库不得标作库内正式基线。保留 V6 作为最后一次明确已入库的版本，等待文件库写入恢复后按 V7→V8→V9 顺序上传与验收。

## 回滚

V9 无数据库变更，可回滚应用到 V8 并保留数据库。回滚会移除员工/工位基础资料的预约保护，**不建议在有未来预约时对这些资料做修改**。
