> **V12 资金流水可靠性（待入库候选，不可直接商用）**：收款和退款支持请求头 `Idempotency-Key: <UUID>`。同门店同键、同内容的并发请求或网络重试只记一笔，复用 UUID 修改金额/退款目标返回 HTTP 409；已日结的成功请求仍能凭原键找回，而不能再新增入账。资金写入及审计写入处于同一事务。前台单次操作使用稳定 UUID，网络失败保留该键供原内容重试；仍须真实 PostgreSQL 并发和完整前后端构建测试。新增 `0007_payment_idempotency.sql`，必须停机备份并按序迁移后启用 V12。详见 [V12 实改记录](docs/CHANGELOG_V12.md) 和 [V12 真实验证](docs/BUILD_REPORT_V12.json)。

> **V11 已预约顾客保护与门店设置原子保存（本地待入库候选源码）**：更改周营业时间若使已有预约超出营业时段，API 返回 409 并回滚；合并门店设置和周营业时间为单个数据库事务提交，避免前台显示失败却部分成功；已有预约的服务菜单不得直接停用或切换所需设备类型。新增中日双语提醒，纯单元测试与 PostgreSQL 集成用例。无新迁移，但 0000–0006 仍需按序执行。参见 [V11 改动](docs/CHANGELOG_V11.md)、[真实验证报告](docs/BUILD_REPORT_V11.json)。**尚未完成完整构建、PostgreSQL 和浏览器验收，不可直接商用部署。**

> **V10 通知送达可靠性升级（本地待入库候选源码）**：LINE 通知首发即携带稳定 UUID 重试键，409（已接受）正确处理；发送中任务使用 10 分钟租约和 23 小时保守重试上限；已取消、改期或已到店的旧提醒发送前被抑制；Mock 日志不再输出顾客姓名、手机号与预约码；店长「设置」新增投递状态面板并限制 API 输出字段。需执行 `0006_notification_delivery_safety.sql`，并完成 PostgreSQL/浏览器联调后才可生产。见 [V10 修改记录](docs/CHANGELOG_V10.md)。

> **V9 员工与工位变更保护（未入库候选源码）**：技师已有未结束预约时，不允许直接停用；已有预约使用的项目技能不能删；已分配给未来预约的工位不能停用或更改工位类型。所有检查与写入使用预约相同门店事务锁；顾客取消后可以再操作。新增长显的中日双语冲突提示与变更审计。参见 [V9 修改记录](docs/CHANGELOG_V9.md)。V7–V9 仍须入库并通过 PostgreSQL/浏览器测试，**不是已上线商业系统**。

> **V8 班次与设备维护安全保护（源码候选版）**：店长创建请假、临时封锁和维护时，在同门店预约事务锁内检查现有预约和同资源已封锁区间；阻止既有顾客预约被覆盖。新增班次日期/午休校验、重复班次拒绝、保留预约时禁止删除班次、技师隐私封锁访问限制；中日双语明确告知冲突与改期办法。参见 [V8 修改记录](docs/CHANGELOG_V8.md)。**真实 PostgreSQL、浏览器、部署仍待验收。**

> **V7 线上预约重试保护**：顾客弱网超时后原请求可安全重试并恢复相同预约确认号；数据库按门店约束请求键唯一，避免重复通知和占位。需先执行 `0005_booking_idempotency.sql` 并完成集成测试。参见 [V7 修改记录](docs/CHANGELOG_V7.md)。

> **V6 日结经营可靠性升级**：增加真实的收款日结对账、现金实点差额、不可变锁账快照、跨日收退款写入保护，以及过期预览拦截。参见 [CHANGELOG_V6](docs/CHANGELOG_V6.md)。数据库及浏览器端完整测试尚未通过，不能视为生产验收。

> **V5.1 经营可靠性修复**：修复退款接口的越界变量引用、模拟通知虚假“已送达”状态和通知标题空白。查看 [商用级差距审计](docs/COMMERCIAL_READINESS.md)。**尚未完成全量生产构建与数据库联调，不可作为商用验收结论。**

# Beauty Salon OS

> **V5 前端与经营流程升级版**：在 V4 业务/安全逻辑上，重新设计店长侧边栏、日历工作台、顾客预约页、客户/收银/报表页，新增拖拽改期确认、接待工作清单、客户/流水 CSV 导出、加载失败重试及过期请求防覆盖。无新数据库迁移。参见 [V5 修改记录](docs/CHANGELOG_V5.md) 与 [V5 实际经营验收清单](docs/QA_V5.md)。本环境尚未完成 npm 依赖安装、前端真实构建、Docker/浏览器与 PostgreSQL 端到端验证。

> **V4 Pro 源码修复版**：延续 V3 的日历与 Cookie 安全改造，新增数据库会话吊销、员工权限即时更新、顾客改期限制、跨门店关联检查和并发退款行锁。参见 [V4 改动](docs/CHANGELOG_V4.md) 与 [V4 部署](docs/DEPLOY_V4.md)。**本环境仍未完成 npm/数据库/Docker 全量验证，不可直接作为生产验收。**

面向日本市场的美甲 / 美睫 / 美容一体化预约排单管理系统。
顾客手机网页预约（中日双语）、店长 CS 风格排单日历、技师手机端日程，三端共用一套真实排单引擎——不是画日历，而是带事务与数据库约束的防冲突预约系统。

## 快速开始（本地开发）

前置：Node.js 22+、PostgreSQL 16+、Redis 7+（Redis 仅用于通知队列加速，缺失时可设 `QUEUE_DRIVER=db` 降级为纯数据库轮询，预约功能不受影响）。

```bash
cp .env.example .env            # 按需改 DATABASE_URL 等
npm install
npm run db:migrate              # 执行迁移
npm run db:seed                 # 写入演示数据（幂等，可跳过）
npm run dev:api                 # API → http://localhost:8787
npm run dev:worker              # 通知 Worker（另一个终端）
npm run dev:customer            # 顾客端 → http://localhost:5173
npm run dev:admin               # 管理端 → http://localhost:5174
```

本地开发演示账号（仅可通过非生产模式的 `npm run db:seed` 创建，禁止正式营业使用）：

| 角色 | 邮箱 | 说明 |
|---|---|---|
| 店主 owner | `owner@demo.salon` | 全部权限 + 账号管理 |
| 店长 manager | `manager@demo.salon` | 店务管理 |
| 技师 staff | `staff@demo.salon` | 关联技师「佐藤 美咲」，仅看自己的日程/业绩与被分配的客户 |

演示门店 ID：`11111111-1111-4111-8111-111111111111`（前端通过 `VITE_STORE_ID` 注入）。

## Docker 部署

```bash
cd infra
cp ../.env.example .env   # 改 POSTGRES_PASSWORD / JWT_SECRET / SALON_DOMAIN
docker compose up -d --build
```

正式部署前通过 `npm run db:bootstrap` 创建店主，且需要先设置强密钥与 `CORS_ORIGINS`。打开 `http://localhost:8080`（顾客端）、`http://localhost:8080/admin/`（管理端）。完整服务器部署见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 架构

```
beauty-salon-os/
├─ apps/
│  ├─ customer-web/   顾客端（React + Vite + Tailwind，响应式 PWA，中日双语）
│  ├─ admin-web/      店长端 + 技师端（同一应用按角色分流；核心是排单日历）
│  ├─ api/            Hono API（认证/RBAC/预约事务/收银/报表）
│  └─ worker/         通知 Worker（BullMQ 唤醒 + DB 轮询兜底，LINE/mock 发送）
├─ packages/
│  ├─ scheduler/      纯函数排单引擎（可用时间计算、组合项目排布、冲突校验）
│  ├─ database/       Drizzle schema + 迁移 + 种子（PostgreSQL）
│  ├─ shared/         枚举、时间工具（Asia/Tokyo）、错误类型
│  └─ i18n/           中日词条（类型强制两套词条键集合一致）
├─ infra/             Docker Compose、Caddy、Dockerfile
├─ tests/             跨包演练测试（从零恢复等）
└─ docs/              部署教程、功能清单
```

模块化单体，不拆微服务：排单引擎是无 I/O 的纯函数包，API 把数据库状态快照喂给它、在同一事务内复核落库；前端只调 API，不复制排单规则。

### 关键设计决定

- **ORM 选 Drizzle 而非 Prisma**：SQL-first、无引擎二进制、迁移就是可审查的 SQL 文件，排斥约束等 PostgreSQL 高级特性可以手写迁移补齐；部署镜像更小。
- **防重复预约三重防线**（任一层失效都有下一层兜底）：
  1. 预约事务内按门店取 `pg_advisory_xact_lock`，同店预约串行化；
  2. 排单引擎在事务内用最新快照复核（班次/技能/请假/工位/缓冲）；
  3. 数据库对 `resource_allocations` 建部分排斥约束（`EXCLUDE USING gist`，按技师、按工位各一条，仅对 active 行生效）——绕过应用层也写不进重叠占用，冲突以 SQLSTATE 23P01 返回并映射为 HTTP 409。
- **组合项目语义**：多项目按顺序首尾相接，后一段开始 = 前一段结束 + 前一段清洁缓冲；技师与工位按「服务时长 + 缓冲」整段占用；仅服务部分必须落在班次/营业时间内（缓冲尾巴允许越过休息开始或打烊）。
- **价格/时长快照**：预约落库时把当时的价格、时长、附加项写入 `appointment_services`，事后改价不影响历史订单（有测试覆盖）。
- **通知可靠性**：`notification_jobs` 表是事实来源；BullMQ 只做即时唤醒，Worker 用 `FOR UPDATE SKIP LOCKED` 原子领取 + 失败退避重试（60s × 次数，最多 3 次）；Redis 挂掉不影响预约与通知最终送达。
- **时区**：业务时间统一 Asia/Tokyo；数据库用 `timestamptz` 存储，前后端只在边界做时区换算，引擎内部用 epoch 毫秒纯计算。
- **密码**：Node 内置 scrypt 哈希（无原生依赖）；登录限流；数据库可撤销会话 + JWT 最长 12 小时；审计日志写入前脱敏（密码/token/手机号/邮箱等字段打码）。

### 参考项目与许可

- **OpenSalon**（仓库许可证信息有待复核，不引入代码）：借鉴其预约业务流程与信息架构。未采用其代码作为基础——它是 Preact + SQLite + Cloudflare 的单店应用，与本项目 PostgreSQL 多门店预留、工位约束、React 技术栈要求不匹配。
- **Easy!Appointments**（GPL-3.0，PHP）：仅参考公开的预约流程，未复制代码（许可证与技术栈均不适合）。
- **CSNEXT**（商业闭源）：仅参考其公开描述的排单交互逻辑（横轴技师、纵轴时间、色块、拖拽）；界面为原创实现，未使用其代码、素材、商标。

## 测试

```bash
npm run test:unit  # 无外部依赖的纯规则单元测试（Node.js 22+）
npm test           # 包含 PostgreSQL API / Cookie / CSRF / 排单集成回归，需安装依赖与测试数据库
```

覆盖任务书要求的场景：同技师重复预约、跨技师共用工位、组合服务跨段、取消释放资源、改期冲突、8 路并发抢约（恰好 1 成功）、员工请假、中日切换（词条键集合类型校验 + 协商测试）、越权访问他人客户数据、备份恢复（迁移重放 + pg_dump/pg_restore 整库演练）。逐项对照见 [docs/FEATURES.md](docs/FEATURES.md)。

## 备份与恢复

```bash
DATABASE_URL=postgres://... ./scripts/backup.sh ./backups
DATABASE_URL=postgres://... ./scripts/restore.sh ./backups/salon-YYYYMMDD-HHMMSS.dump
```

## 文档

- [V5 变更记录（店长/顾客前端）](docs/CHANGELOG_V5.md)
- [V5 经营验收清单](docs/QA_V5.md)
- [V4 修复记录](docs/CHANGELOG_V4.md)
- [V4 测试与升级](docs/DEPLOY_V4.md)
- [部署教程（日本 Ubuntu 服务器）](docs/DEPLOY.md)
- [已完成 / 未完成功能清单](docs/FEATURES.md)


## V13 日本・中国平台集成接口（未完成第三方授权）

店长导航新增「中日平台接入中心」。可查看日本/中国候选渠道、授权中转 Inbox，以及导出无顾客 PII 的 CSV / ICS 文件。
第三方原生平台接入**并未自动完成**：已完成的是商家自有/获授权中转的 HMAC 签名事件接收接口、去重和人工核对，平台方授权、双向排期同步、微信/美团/PayPay 资金调用另行开发与验证。
参见 `docs/INTEGRATIONS_JP_CN.md`、`docs/CHANGELOG_V13.md`、数据库迁移 `0008_integration_inbox.sql`。

## V14 等候名单与取消补位

所选日期无空位时，顾客可在预约页登记等候（幂等防重复、自动关联老顾客档案）；店长端新增「等候名单」页，按日查看登记、标记通知与成约，并可用「补位候选查询」按空出的时间找候选顾客。等候条目不是预约、不占用时段。
V14 同时修复了 V13 的迁移日志缺失（0008 未登记会静默跳过）等问题，并完成开源底座评估与架构决定。参见 `docs/CHANGELOG_V14.md`、`docs/ARCHITECTURE_DECISION_V14.md`、数据库迁移 `0009_waitlist.sql`。
