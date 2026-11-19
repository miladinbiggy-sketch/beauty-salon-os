# Beauty Salon OS V7 — 预约重试幂等与丢失回执恢复（2026-11-19）

基线：`Beauty_Salon_OS_V6_日结锁账与经营对账源码.zip`，保留 V6 的日结、锁账、退款和所有原有界面。

## 高价值经营问题

日本门店顾客在手机上预约，弱网/超时可能导致**服务端已经创建订单，但顾客没有收到确认号**。之前再次点「预约确认」会遇到时间已被自己占用而返回 409，顾客误以为预约失败，前台产生人工补单和客诉。

## 实际实现

1. `POST /public/appointments` 接受可选的 `Idempotency-Key: <UUID>` 头；店长创建预约也支持可选该头；旧客户端不传仍兼容。
2. 在同一门店 PostgreSQL advisory transaction lock 下**先查已完成请求**，匹配后恢复原预约确认号；不会创建重复预约、技师工位占用、提醒作业或审计记录。
3. 同一键但顾客、服务、时段、操作人等不同，返回 409，而不是意外返回他人的预约。数据库按门店保证键唯一并校验键与指纹必须成对出现。
4. 顾客端使用浏览器 `crypto.randomUUID()` 每个提交体分配键；网络失败保留键，重试相同提交恢复原回执；提交体变化自动换键。键与提交体只留当前页面内存，**不写本地存储**。
5. 前端提供中日双语弱网重试提示。跨域 API CORS 允许 `Idempotency-Key`。

## 文件与迁移

- 新 `apps/api/src/services/booking-idempotency.ts` — 无外部依赖的固定字段 SHA-256 指纹（不保存客户明文），支持组合项目附加项顺序无关。
- `apps/api/src/services/booking.ts` — 抢位事务的幂等查询与写入。
- `apps/api/src/routes/{public,admin}.ts` — 接口扩展。
- `apps/api/src/app.ts` — CORS 允许幂等头。
- `apps/customer-web/src/{pages/BookingPage.tsx,lib/api.ts}` — 安全重试。
- `packages/database/{src/schema.ts,migrations/0005_booking_idempotency.sql,migrations/meta/_journal.json}` — 数据库唯一索引与成对一致性检查。
- `tests/booking-idempotency-unit.test.mjs`、`apps/api/src/api.test.ts` — 纯函数与真实 PostgreSQL 并发回归场景。

## 发布与回退

1. 正式升级前执行 PostgreSQL 全量备份，独立测试库先运行 `npm run db:migrate`（新增可空列及唯一索引，不修改历史预约数据）。
2. 全部 API 实例统一升级至 V7，顾客端与新 API 同步部署；不允许混跑旧 API，因为旧实例不会验证新幂等键。
3. 验证同一 UUID 双请求拿到相同预约 ID、通知未重复、换键同一时间仍被拒绝。
4. 回滚建议仅回退应用版本，暂时保留新增表列，不应在有线上预约的情况下直接 DROP 列/索引。

## 已知边界

- 旧顾客网页或第三方系统不传键时仍无幂等保护；官方顾客端新版本已加上。
- **浏览器关闭或刷新会丢失本页内存键**；跨设备和掉电恢复需后续引入受保护的查询凭据/会话，不能仅凭 UUID 取回隐私预约。
- 本地纯函数、TS/TSX 静态测试不代替真实 PostgreSQL、浏览器、Docker 端到端验收。
