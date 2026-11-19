# Beauty Salon OS V6 — 实际营业日结与锁账（2026-11-19）

基线：`Beauty_Salon_OS_V5_1_经营可靠性修复.zip`。不替换 V5.1 原文件。

## 这轮真实新增

1. 店长端新「日结对账 / 日次締め」页面，按日本营业日选择日期；显示全部交易汇总、支付渠道拆分、现金净流入；输入开店备用金、实点金额和差额理由；最终二次确认。
2. 新增 `GET /admin/cash-close/preview?date=YYYY-MM-DD`、`POST /admin/cash-close`，仅 owner / manager；不允许未来日结、负数实点、重复锁账。现金差异非零需要至少 3 字符原因。
3. 新增数据库 `cash_closes` 表以及每店/每营业日唯一约束。保留收款净额、退款、渠道、盘点记录、操作人和时间的不可变日结快照。
4. **日结、记账和退款共用同一 PostgreSQL 事务级门店锁**，日结后阻止倒填当日收退款；日结请求携带 `expectedTransactionCount`，拒绝在预览后账本已变化的过时盘点。
5. 核算直接由数据库按日期聚合所有支付流水，不依赖前台最多显示500行的收银列表，避免报表欠算。
6. 新增金额/日期纯函数测试和真实 PostgreSQL API 集成测试用例（权限、重复日结、锁账禁止补记、并发锁账、并发日结与收款）。

## 涉及代码

- `apps/api/src/services/cash-summary.ts` — 纯账本汇总及日期验证
- `apps/api/src/services/cash-close.ts` — PostgreSQL 事务锁和按渠道聚合 SQL
- `apps/api/src/routes/admin.ts` — 日结 API；写入收款/退款锁账保护
- `apps/admin-web/src/pages/CashClose.tsx` — 双语经营日结页面
- `apps/admin-web/src/App.tsx`, `apps/admin-web/src/lib/api.ts` — 导航、路由和类型
- `packages/database/src/schema.ts`, `packages/database/migrations/0004_cash_closes.sql`, `packages/database/migrations/meta/_journal.json` — 数据层
- `packages/i18n/src/zh-CN.ts`, `packages/i18n/src/ja.ts` — 双语入口
- `tests/cash-close-unit.test.mjs`, `apps/api/src/api.test.ts` — 测试

## 操作与迁移

必须先备份 PostgreSQL，再执行原有迁移命令 `npm run db:migrate`，确认 `cash_closes` 表与唯一索引建立。随后重新构建并部署 API 和 admin-web；所有支付/退款写入都经过同一应用版本。分步升级造成部分旧服务未升级时，可能绕过应用层锁账，因此 **不允许新旧 API 节点混用**。

第一次正式试用请在非生产测试库创建一日示例：现金入款 + 退款 + 刷卡收入，检查现金备用金与实点差额；确认锁账后同日补记/退款返回 `409 CONFLICT`，新的营业日仍可入账。历史数据不会自动结账。

### 设计边界

- 本版本是 **单店营业日结**，不是会计/发票系统、税务申报或财务审计服务。现金实点由员工填写，不会自动读取钱箱。
- 已结日如发生确需纠正的漏记，暂时**没有**审批后冲正/补记工作流；需要在营业使用前设计财务订正权限和审计规则。
- 锁账阻止本应用的 API 正常写入，不能代替数据库超级用户审计、外部 POS/支付网关对账。
- 本次只把日结做成店内可操作流程，不声称交易与银行卡/PayPay 服务商已经自动核对。
- 正式上线应测试实机浏览器、服务中断后的数据库恢复、收款与日结并发，以及多店隔离。

### 当前验证结果

- Node 独立账本汇总/日期测试：3/3 通过（无外部 npm 依赖）。
- TypeScript/TSX 语法解析：将运行并在交付时报告。
- PostgreSQL 集成用例：已编写但当前环境缺可用服务，未执行。
- npm 完整依赖安装/前端构建：npm CLI 中途出现 `Exit handler never called`，未验证。
