# Beauty Salon OS — 竞品与开源研究基线

核验日期：2026-11-19（日本时间）  
适用项目：Beauty Salon OS，美甲＋美容＋美睫一体化预约排单系统  
当前源码基线：/Beauty Salon OS/Beauty_Salon_OS_V5_1_经营可靠性修复.zip

## 1. 结论

不要把多个软件的功能直接堆砌，也不要直接复制商业闭源代码。当前最缺的不是主题色，而是前台操作、资源冲突、防重、电子护理档案、收费日结、消息送达与异常恢复等闭环。每轮先解决1–3个实际风险，优先验证修复，再增加新模块。

## 2. 市场产品：可以借鉴的业务行为

| 来源 | 官方链接 | 已公开的代表功能 | 可独立实现的目标 |
| --- | --- | --- | --- |
| CSNEXT | https://csnext.jp/ | 预约和カルテ同屏、店内客数/设备限制、技师禁做菜单、自由客分配、同时开始约束 | 单屏快速插单；硬约束优先；解释推荐结果 |
| SALON BOARD | https://salonboard.com/ | 网络/电话预约合并、客户历史、卡片/咨询、收银/结账、复购营销 | 统一预约来源；到店→护理→收银→日结的闭环 |
| KaruteKun | https://karutekun.com/ | 预约、护理照片和笔记、收银/分析，提供附加 LINE 预约交流功能 | 按顾客显示护理记录、照片、授权与访问审计 |
| かんざし | https://www.kanzashi.com/about/nail.html | 多渠道预约一元化、同步员工排班、避免重复预约 | 预约渠道来源 ID、幂等导入、冲突队列与人工处理 |
| Reservia | https://www.rsvia.co.jp/ | LINE、Google 预约、在线支付、多语言、设备和班次、提醒 | 渠道适配器、Webhook 幂等和设备时段约束 |

以上是对官方公开说明的提炼，不代表可直接使用其私有 API，也不代表已取得第三方平台自动同步权限。

## 3. 开源项目/优化模型：复用前核查

| 来源 | 地址 | 当前建议 | 许可/成熟度提示 |
| --- | --- | --- | --- |
| OpenSalon | https://github.com/clawnify/OpenSalon | 参考店长日历、员工列、客户卡片、库存/日间表导出 | 仓库页面显示 MIT、README 末尾写 AGPL-3.0，存在不一致。引入代码前检查实际 LICENSE、依赖和拟使用版本 |
| Easy!Appointments | https://github.com/alextselegidis/easyappointments | 参考公开预约页、服务/提供者、工时、Google Calendar、邮件通知 | GPL-3.0；不能未经许可假定能闭源复制其代码 |
| Lumina | https://github.com/effuselabs/lumina | 可研究多租户隔离、预约闭环测试思路 | 项目自述预发布，尚不适合真实顾客；AGPL |
| Timefold Solver | https://github.com/TimefoldAI/timefold-solver | 评估复杂员工/工位/阶段组合约束求解 | 开源社区版 Apache-2.0；Java/Kotlin，单店勿轻率引入独立服务 |
| Google OR-Tools | https://developers.google.com/optimization/scheduling/employee_scheduling | 参考 CP-SAT 硬软约束和覆盖率优化模型 | 优先做概念验证、和现有 TypeScript 评分算法对照 |
| FullCalendar | https://fullcalendar.io/pricing | 可借鉴日历基础交互 | 标准插件 MIT；资源时间轴/资源列属收费 Premium。商业项目不能把试用授权当生产授权 |

## 4. 建议实施顺序（先实现能稳定经营的闭环）

### P0 经营可靠性与安全
1. 预约来源幂等键：相同外部预约事件不会重复生成预约；渠道冲突进入人工处理队列。
2. 收银/退款事务、金额校验、发票/收据关联、日结对账差异记录与审批日志。
3. LINE/邮件使用 `queued`、`sent`、`delivered`（仅在渠道提供凭据时）、`failed`、`retrying` 等真实状态，不可把模拟发送冒充成功。
4. 数据备份恢复演练、角色最小权限、客户联系方式/护理照片访问审计。

### P1 一线操作体验
1. CSNEXT 风格同屏快速预约：查客户→选套餐→推荐时段→确认→提醒。
2. 精确工位/技师/设备占用视图：区分美甲桌、美睫床、美容床，显示不可预约理由。
3. 前台快捷流程：电话插单、到店、开始服务、完成、收款、离店、交接班。
4. 客户カルテ：照片、耗材、禁忌注意、同意记录、复购周期、权限和导出。

### P2 商业增长
1. 允许预约候补，取消后按条件通知（确认后再锁位，避免误约）。
2. 会员套餐、优惠券、券核销与退款核算；多店统一服务目录。
3. 渠道转化率、爽约率、技师占用率、单客价值、客单价、复购率与日结差异。

### P3 受控 AI 能力（选做）
1. 可选本地模型：生成不含敏感内容的护理记录摘要、门店知识库问答、日文措辞建议。
2. AI 不得直接决定资源冲突、改写收款金额、绕过权限、或直接发送含隐私内容的营销消息。
3. AI 建议必须由确定性预约规则和人工授权校验后执行；默认不发送客户数据到第三方模型。

## 5. 每小时迭代验收格式

- 本轮来源：官方页面/仓库链接、核验日期、功能事实、授权风险。
- 业务问题：受影响角色、实际场景、复现方法、优先级。
- 实际改动：源码文件、迁移、测试、可回退办法。
- 证据：语法、类型、单测、集成、浏览器端到端、部署，每项单独列出真实结果。
- 结论：完成/未完成/阻塞及未解决的风险。
- 版本与存储：基于上一版可检查 ZIP 生成新 ZIP，上传 /Beauty Salon OS；不能访问或不能上传时不得声称完成。

## 6. 许可证核对提醒

不能只看 GitHub 仓库标题的 License 徽章；要同时查看 LICENSE 文件、README、第三方依赖及插件商业许可。仅借鉴商业软件公开的业务流程与通用交互思路，避免复制闭源代码、商标和素材。先核实特定版本再决定复用路径。

## V6 本轮具体落实（2026-11-19）

- 借鉴 **SALON BOARD** 所描述的预约—结账—门店经营统计闭环，而非复制任何受保护代码或界面。
- 本轮独立实现每日现金盘点、支付渠道核对、不可变营业日快照及追加写入拦截；对应 `apps/api/src/services/cash-close.ts`、`apps/admin-web/src/pages/CashClose.tsx`、`0004_cash_closes.sql`。
- 算法用 SQL 确定性汇总和事务锁，不需要大模型、OR-Tools 或任何外部服务，避免财务数据外传。
- 许可风险：未从 CSNEXT/SALON BOARD 等闭源软件复制源码；新增代码写在现有项目技术栈中。现有依赖许可仍应在商用发行前审核。
- 验证状态以 `docs/CHANGELOG_V6.md` 为准，未完成的数据库集成验收不能宣称通过。


## V7 本轮研究与源码决策（2026-11-19，日本时间）

- **已核验来源**：[Easy!Appointments 官方仓库](https://github.com/alextselegidis/easyappointments)（GitHub README/License，2026-11-19 检索）。公开功能含网上预约、服务与技师管理、营业时间规则、日历同步、邮件通知；**GPL-3.0**，本轮仅分析需求，未引入任何 GPL 代码。
- **需求来源**：借鉴多渠道预约产品（[かんざし](https://www.kanzashi.com/about/nail.html) 的预约统一管理业务方向）的「不可因重试变双单」业务可靠性目标；没有复制其代码或接口。渠道 webhook 导入仍未实现。
- **本轮实际独立实现**：持久化业务请求 UUID + SHA256 固定请求指纹，预约串行化事务下先检查旧结果；前台同请求按原键重试。只调用现有 PostgreSQL/Node Crypto，不增加任何第三方授权依赖。
- **源码位置**：`apps/api/src/services/booking-idempotency.ts`、`booking.ts`、`routes/public.ts`、`routes/admin.ts`、`apps/customer-web/src/pages/BookingPage.tsx`、`packages/database/migrations/0005_booking_idempotency.sql`。
- **验证**：见 `docs/BUILD_REPORT_V7.json`，区分本地运行通过和仅编写但未执行的 PG 集成用例。未声称联网推送、跨平台同步或商业发布已完成。


## V8 本轮研究与源码决策（2026-11-19，日本时间）

| 核验来源 | 本轮验证的事实 | 独立实现与许可选择 | 实际改动 / 证据 |
| --- | --- | --- | --- |
| [CSNEXT 官方产品页](https://csnext.jp/) | 公开介绍技师 NG 菜单、设备限制、员工班次/休息、预防双重预约等业务约束；本轮 2026-11-19 检索 | 仅参考「排单必须将已预约顾客置于临时请假/维护之上」业务目标，**未复制闭源代码或图片** | `routes/admin.ts` 的封锁写锁+已预约冲突判断、班次删除保护 |
| [Easy!Appointments 官方](https://easyappointments.org/) | 2026-11-19 检索其服务者角色与在线预约工作流，GPL-3.0（官方说明） | 未引入 GPL 代码，基于现有 TypeScript + PostgreSQL 业务层独立实现 | 同事务班次创建、重复模板校验、中日文冲突提示 |
| [PostgreSQL 18 官方范围类型文档](https://www.postgresql.org/docs/current/rangetypes.html) | 时间段使用半开边界 `[)` 与重叠比较适合预约排班；2026-11-19 核验 | 使用参数化 `start_at < block_end AND end_at > block_start`，允许 11:40 结束后 11:40 开始的维护；保持既有 V2 的数据库 GiST 资源排斥约束 | `routes/admin.ts`; `api.test.ts` 中相邻/重叠/并发用例 |

**许可证状态**：本轮未新增任何外部求解器、第三方软件代码、付费日历插件或 AI 模型；新增代码完全属于本项目。沿用的依赖许可证审计仍未完成。**隐私补强**：封锁/请假原因只允许 owner/manager 查询，删除也保留脱敏审计。**验收状态**：独立单元测试通过，数据库 E2E 未执行。详见 `docs/BUILD_REPORT_V8.json`。

## V9 本轮竞品与开源核验（2026-11-19 JST）

| 官网 / 开源来源 | 核验到的业务行为 | 本轮独立实现内容 | 许可证和边界 |
| --- | --- | --- | --- |
| [CSNEXT 官方](https://csnext.jp/) | 公开说明 24 小时预约、双重预约防止、顾客管理与权限设定 | 新增技师停用、去除技能、设备停用/换类型时的已预约保护；参考的是经营安全原则，而非界面或私有 API | 商业闭源；未复制代码或素材 |
| [SALON BOARD 官方](https://salonboard.com/about/) | 线上/电话预约一元管理、预约台账、客户历史、营业结账；PC、平板、智能手机支持 | 让店长日常维护技师/工位资料时不能悄悄破坏既有预约；提供中日文修复引导 | 商业闭源；仅参考通用运营问题 |
| [Easy!Appointments 官方](https://easyappointments.org/) | 多用户角色预约与多提供者日历；公开代码与自有数据库 | 沿用本项目 TypeScript/Drizzle 的确定性约束；没有引入其 PHP 源码 | 官方明确 GPL-3.0；不复制代码、不引入衍生许可证风险 |
| [PostgreSQL 官方 advisory lock 文档](https://www.postgresql.org/docs/current/explicit-locking.html) | 事务级 advisory lock 在事务结束自动释放；调用方必须一致使用，否则无法提供全系统强制约束 | `PUT/DELETE /admin/staff/:id` 与 `PUT/DELETE /admin/resources/:id` 统一使用既有 `storeLock`，在事务内检查再更新 | PostgreSQL 文档；本轮未引入依赖 |

**真实改动**：`apps/api/src/services/master-data-guards.ts` 新增 3 个纯判定函数；`apps/api/src/routes/admin.ts` 新增员工、技能、工位未来预约查询与带门店锁事务；`apps/admin-web/src/pages/{Staff,Resources}.tsx` 添加 HTTP 409 中日文反馈；`packages/i18n/src/{ja,zh-CN}.ts` 新增 3 组词条；`apps/api/src/api.test.ts` 新增 4 场景 PostgreSQL 集成用例；`tests/master-data-guards-unit.test.mjs` 增加 3 项 Node 测试。没有数据库迁移、没有使用大型优化器或 AI 模型，所有预算/预约/收款规则仍为确定性系统。

**实际验证**：Node 原有 10 + 新增 3 = 13 个单元用例执行通过；PostgreSQL 集成 4 场景仅编写、未执行；TypeScript 语法可解析，完整依赖/TS 类型检查、浏览器 E2E 未通过验收。V7/V8 的 ZIP SHA256 本轮已重新核验与原摘要一致，但上传 `/Beauty Salon OS` 的两种文件引用方式均因 `AccessDeny` 失败。本轮生成的 V9 为 V8 候选之上的本地候选，尚未作为正式文件库基线。

## V10：LINE 官方 API 与日本美容门店通知可靠性（2026-11-19 JST）

| 来源与当天核验链接 | 本轮真实业务问题 | 本轮具体新增/修改与检验 | 许可边界 |
| --- | --- | --- | --- |
| [LINE Developers Retry failed API requests](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/) 和 [API Reference](https://developers.line.biz/en/reference/messaging-api/nojs/) | 5xx/timeout 可能已被平台接受，重复 Push 会造成顾客收到两条通知；官方规定 UUID 重试键有效期 24 小时，409 表示同请求已被接受 | `line-delivery.ts` 每个通知固定 UUID，409 accepted 处理、永久/暂时性故障区分；`notification-policy.ts` 23 小时保守补发窗口；本轮新 10 个 Node 单测 | 独立遵守接口规范，不复制 SDK 或闭源源码；官方 API 使用条件仍需遵守 |
| [SALONA 通知流程](https://salona.jp/guide/booking-notifications) | 美容门店经营依赖预约成功、取消、改期、提醒的状态区分；不能将模拟通知误称送达 | `processor.ts` 发送前校验实时预约状态和原时刻；`Settings.tsx` 展示失败/全部通知、重试次数与原因；`admin.ts` 默认不下发通知原文/顾客预约码 | 只参考通用业务流程，不复制商业实现、模板或美术素材 |

此轮实际文件见 `docs/CHANGELOG_V10.md`。Node 纯单测 23/23，PostgreSQL 集成及 LINE 真实频道联调待执行；V7–V9 旧候选文件已核对 SHA256，但 File Library 写入目前仍 AccessDeny，V10 应保留本地可核查 ZIP，不可虚称入库。

## V11 本轮复核：变更营业规则不可损害已确认预约（2026-11-19 JST）

| 来源及复核日期 | 核验到的业务问题/设计 | 本轮独立源码实现 | 许可证与限制 |
| --- | --- | --- | --- |
| [CSNEXT 官方说明](https://csnext.jp/)（2026-11-19 官方网页） | 明确提供双重预约防止、店内设备限制、工作人员 NG 菜单、班次、单屏预约台账等，门店管理需保持预约有效性 | 周营业时间缩窄前先阻止违反新营业窗的有效预约；已预约菜单不可任意停用或换设备。`store-hours-guards.ts`、`master-data-guards.ts`、`routes/admin.ts` | 闭源商业产品：只参考公开业务目标，不复制界面、代码或商标 |
| [Easy!Appointments 官方开源仓库](https://github.com/alextselegidis/easyappointments)（2026-11-19 GitHub） | 员工、服务和工作时间属于预约配置的重要输入；自托管并支持多语言 | `PUT /admin/store` 在数据库事务内一并检查并保存服务时间设置；店长页面单请求、中日文冲突通知 | 仓库标注 **GPL-3.0**；没有复制其 PHP/JS 代码，也未混入开源组件 |
| [PostgreSQL 18 官方事务锁文档](https://www.postgresql.org/docs/current/explicit-locking.html)（2026-11-19 官方文档） | Transaction-level advisory locks 只保护所有参与者主动使用同一锁的事务 | 复用已有 `storeLock`，数据库 SQL 使用 `AT TIME ZONE 'Asia/Tokyo'` + ISO DOW 与客户结束时间查冲突，按门店防止修改和预约的竞态 | PostgreSQL 官方规范；无新增运行依赖。绕过 API 的直接表写入仍需额外数据库侧保护 |

**本轮实际新增/修改文件与验证证据**：见 `docs/CHANGELOG_V11.md` 与 `docs/BUILD_REPORT_V11.json`。不引入 OR-Tools、Timefold 或 AI：此处是确定性事务校验，不需要优化求解，也不接触第三方模型。全部隐私数据保留原数据库，审计仅记录业务配置及变更字段。

## V12 资金重试与审计原子性：本轮核验 2026-11-19 JST

| 公开来源 | 业务事实与启发 | 本轮独立实现代码 | 许可证及验收边界 |
| --- | --- | --- | --- |
| [CSNEXT 官网](https://csnext.jp/) | 面向日本美容、美甲、美睫的统一预约、顾客、门店权限；经营系统的可靠性优先于排单视觉 | 保持既有预约/收银链条，仅加强资金记账防重复，**没有复制软件源码和专有界面** | 商业闭源，仅参考公开业务需求 |
| [Easy!Appointments 官方 GitHub](https://github.com/alextselegidis/easyappointments) | 预约平台包含服务提供者、客户、日历、通知；其 Releases 2026-11 最新安全修复说明也强调跨账户 ID 和重复预约风险 | 将「不因网络重试产生重复业务记录」原则扩展到本系统付款、退款；使用 Node `crypto` + PostgreSQL，无第三方代码复用 | 项目源码 GPL-3.0，本轮未复制、依赖或改编其 PHP/JS |
| [PostgreSQL 18 Unique Index Checks](https://www.postgresql.org/docs/18/index-unique-checks.html)、[Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) | 官方文档说明唯一索引对并发竞争的最终约束；强事务隔离与明确锁可以避免读写竞态 | `payments_store_idempotency_key_unique` + 既有 `cashLedgerLock` + 审计原子写入 | PostgreSQL 官方文档；无需引入求解器、开源模型或闭源 SDK |

本轮实际文件：`routes/admin.ts`、`services/payment-idempotency.ts`、`schema.ts`、`0007_payment_idempotency.sql`、店长收银 UI/请求客户端、8 项新 Node 测试和 3 组仅编写未执行的 PostgreSQL 回归场景。核心财务逻辑完全确定性，不通过外部模型。生产前仍必须完成 PostgreSQL 并发验证、真实第三方支付对账、前端交互和许可证审计。

## V13 本轮中日接入可行性核验（2026-11-19 JST）

| 产品/开源项目及官方出处 | 已核验的真实能力/限制 | 独立实现、授权和适用性决策 | 本轮修改/检查 |
| --- | --- | --- | --- |
| 日本 かんざし [美甲官方页面](https://www.kanzashi.com/about/nail.html)、[FAQ](https://www.kanzashi.com/q_a/index.html) | 公布多预约来源一元管理、双订预防、POS 关联；没有在本轮确认可向任意第三方开放的开发者 API | 参考「不同渠道的事件需统一去重」经营规则，不复制商业代码；真实接口另行合作取得 | `integration-contract.ts`、`integration_inbox` 唯一索引与门店隔离 |
| 日本 SALON BOARD [官网](https://salonboard.com/)、[第三方明确说明](https://salona.jp/faq) | 未查到适用于一般开发者的 HOT PEPPER Beauty/SALON BOARD 公开预约 API；第三方说明自动接入可能触及规则 | 仅保留 CSV/ICS、人工录入、未来合规授权桥接选项；不做后台抓取或凭据共享 | `Integrations.tsx` 中明确未连接；管理页导出 |
| 日本 [LINE Developers Webhook 签名文档](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/) | LINE 原生回调使用消息正文 HMAC-SHA256 与 `x-line-signature`，验签必须使用未经变更的正文 | V13 的 `X-Salon-Signature` 是**本项目自有中转协议**，并非 LINE 原生 API！真实 LINE 适配另行实现 | `routes/integrations.ts` 不接受 LINE 原生签名冒充；签名测试 |
| 中国 [美团生态开放平台](https://openapi.meituan.com/) 及 [技术服务合作中心](https://developer.meituan.com/) | 有第三方开放合作入口和 API 方式，但未核准具体美业预约的可用范围和商户权限 | 需商户+开发者许可、沙箱与业务签约；V13 仅保留 provider ID、私有授权桥接协议 | `cn_meituan` 目录和本地 HMAC 入站测试 |
| 中国 [抖音开放平台权限说明](https://open.douyin.com/platform/resource/docs/accession-guide/type-and-permission) | 生活服务权限与开发者/服务商身份相关，不是所有账号都有 | 保留 `cn_douyin` 适配入口，不实现未经申请的私有订单接口 | 目录 `mode=partner_approval`，界面提示未连接 |
| 开源 [Easy!Appointments](https://github.com/alextselegidis/easyappointments) | 自托管预约，GPL-3.0 | 参考公共业务规范，不复制代码，避免对私有商用发行产生许可义务 | 无第三方代码导入 |
| 开源 [OpenSalon README](https://github.com/clawnify/OpenSalon/blob/main/README.md) | README 表述 AGPL-3.0；GitHub 页面可能显示 MIT，不一致需进一步核准源代码实际许可证 | 暂不引入，仅借鉴明确可独立实现的预约来路/员工日历概念 | 无第三方代码导入 |
| Google [Calendar Events API](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) | 创建事件需要授权，支持 RFC3339 时间与带时区的日历对象 | 本轮仅做脱敏 ICS 手动导出，不声称已支持 OAuth 或自动双向推送 | `/admin/integrations/appointments.ics` + 店长文件下载 |

**本轮业务需求**：跨境门店可能同时使用日本和中国获客/预约软件，未获授权的回调不应进入排单、更不能修改客户资料或资金。**拟独立实现并已落实**：签名事件收件箱、事件幂等、约束初检、人工台账核对、脱敏文件导出。**尚未实现**：任何上述商业平台原生的双向 API 对接，需先核实具体商户/开发者权限与服务条款。**许可**：只使用项目现有开源依赖和 Node 内置 crypto，没有复制外部商业或 GPL/AGPL 源码。**核验**：参见 `docs/BUILD_REPORT_V13.json`，明确区分已执行单测和未执行集成测试。

## V14 轮次更新（2026-11-19 核验）

- 核验对象：OpenSalon（MIT，TS/Hono＋SQLite・Cloudflare D1＋自研框架，约 70 star、无 Release、无收银）、Easy!Appointments（GPL-3.0，PHP/CodeIgniter，v1.6.1 活跃维护）、Lumina（AGPL-3.0，Next.js/Prisma，pre-release 自述不适合真实顾客）、FullCalendar（核心 MIT，Resource Timeline 为付费 Premium）。
- 结论：三家候选底座均不采用（底座不成熟／GPL 传染／AGPL 网络条款）；FullCalendar 不引入（现有自研日历已覆盖需求）。架构决定全文见 `docs/ARCHITECTURE_DECISION_V14.md`，逐项证据见 `docs/OSS_EVALUATION_V14.md`。
- 本轮借鉴的产品思想：SALON BOARD／かんざし 的"取消补位"工作流——热门时段满约不流失、取消后按登记顺序联系补位。已落地为 V14 等候名单模块（顾客端登记＋店长端候选查询），未复制任何闭源实现。
