# V10：LINE 防重复发送、过期提醒抑制与通知运维（2026-11-19 JST）

## 实际经营问题与原因

1. LINE Messaging API 对超时/5xx 的响应存在不确定性：接口已接受消息但客户端未获回执时，旧 Worker 重试可能让顾客收到两条预约提醒。旧版 Push 没有 `X-Line-Retry-Key`。
2. 原 Worker `UPDATE ... RETURNING *` 使用原始 PostgreSQL snake_case 结果强转成 Drizzle camelCase 行，重试异常时 `row.scheduledAt` 是 `undefined`；旧版 Worker 每次启动直接回收**所有** `sending` 任务（包括其他实例正在处理的任务）。订单改期/取消后，已领取通知可能仍发送旧预约时间。
3. `MockSender` 会把顾客姓名、手机、服务内容、预约码等渲染后的通知正文原样写入日志；店长只能通过 API 看到失败状态，没有可操作的 UI。

## 实际源码修改

- `apps/worker/src/line-delivery.ts`：独立 LINE Push 传输，首次和重试均使用通知任务数据库 UUID 作 `X-Line-Retry-Key`。带 `x-line-accepted-request-id` 的 HTTP 409 表示 LINE 已接受同一个请求；其余 4xx（429 除外）终止盲目重试，5xx/网络异常尝试有限退避；12 秒请求超时。严格区分「平台接受」与「顾客已送达/已读」。依赖 Node 20 原生 `fetch`，未加入第三方 LINE SDK。
- `apps/worker/src/processor.ts`：原子 `UPDATE ... RETURNING id` 领取后通过 Drizzle 正常读取 camelCase 行，修复重试所需的 `scheduledAt` 类型和时间值；领取时保存 `sendingStartedAt` / `firstAttemptAt`，只回收超过 10 分钟的发送租约；不在 LINE 24 小时重试键窗口外自动补发（留 1 小时缓冲），记录需人工核查。对关联预约校验当前状态及 `startAt`，略过旧确认、旧改期通知、过期提醒。
- `packages/database/migrations/0006_notification_delivery_safety.sql`：新增两列及发送中租约索引；迁移期间已有 `sending` 任务因旧版不具 LINE 重试键，标记为 `failed` 并要求人工核对，绝不自动无键重发。
- `apps/worker/src/senders.ts`：模拟渠道日志只输出任务 ID、类型和未投递状态，不记录客户识别信息。
- `apps/api/src/routes/admin.ts`：通知查询只返回店长需要的最小记录（已遮盖的收件人、类型、状态、次数、时间、失败原因），不返回包含客户姓名/预约码的原始 `payload`；响应禁止缓存。
- `apps/admin-web/src/pages/Settings.tsx` + `packages/i18n/src/{ja,zh-CN}.ts`：中日双语「通知投递记录」面板，默认筛选失败，查看模拟/跳过及平台接受状态、尝试次数、错误原因，支持刷新；**没有**未经核实的人工一键重发按钮。
- `tests/notification-delivery-unit.test.mjs`：10 个新纯单测，包含稳定重试键、LINE 409/401/503、重复提醒规则、23 小时窗口；`apps/worker/src/worker.test.ts`：3 个新 PostgreSQL 集成场景，编写但尚未在本环境运行。

## 规则与残留风险

- 官方 LINE 说明 `X-Line-Retry-Key` 的去重有效期为 **24 小时**，同 key 的 409 代表平台已接受，**不保证顾客真正收到或阅读**；本版采取较保守的 23 小时窗口，过时后 `failed` 要人工核查，不能盲目补发。
- 旧版已经 `sent` 的通知不会补发；迁移前旧 `sending` 的通知自动标记失败以防重复，需人工核对顾客联络记录。
- 读取预约状态到外部 LINE 接受之间仍可能发生取消/改期竞争，不能宣称完全消除这一时间窗；后续可扩展带版本号的预约事件和发出前事务协议。
- 仍需 Node 依赖齐全、真实 PostgreSQL、LINE 官方测试频道及浏览器 UI 测试。生产部署先备份 PostgreSQL，暂停旧 Worker，按顺序执行迁移，启动 V10 API/Worker；旧 Worker 不得在 V10 schema 下混跑。
- 从 V9 升级需新增 `0006` 迁移；V7 的 `0005` 仍为前置迁移。若需回滚应用到 V9，请先停止 V10 Worker 并做兼容性/迁移回滚评估，不要直接删列导致生产记录损失。

## 参考资料及许可

- [LINE Developers：Retry failed API requests](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)（2026-11-19 核验）：规定 `X-Line-Retry-Key`、24h 窗口、409 accepted、4xx/5xx 分类，参考规范独立实现。
- [LINE Developers：Messaging API reference](https://developers.line.biz/en/reference/messaging-api/nojs/)（2026-11-19 核验）：Push API 允许重试键头。
- [SALONA：通知メール / LINE Push のテンプレ編集](https://salona.jp/guide/booking-notifications)（2026-11-19 核验）：日本门店强调预约成功、改期、取消、提醒应具备独立的状态和时机。本轮借鉴通知可操作性，不复制其实现和文案。
- 仅使用现有项目与 Node 原生 API，没有复制闭源竞品源码，没有引入 GPL/AGPL 代码，也没有添加付费 FullCalendar 插件。
