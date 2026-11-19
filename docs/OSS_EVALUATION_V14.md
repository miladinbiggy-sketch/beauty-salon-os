# 开源底座/组件评估：OpenSalon、Easy!Appointments、Lumina（+ FullCalendar）

- 核验日期：2026-11-19（JST）
- 方法：全部结论来自一手来源——通过 GitHub 连接器读取各仓库的 LICENSE 原文、README、package.json、提交列表与 Release 接口；FullCalendar 以官网 fullcalendar.io 为准。未采用任何二手博客的许可证说法（个别二手信息已明确标注）。
- 评估对象背景：Beauty Salon OS 现有技术栈为 TypeScript monorepo（Hono API + Drizzle/PostgreSQL + Redis/BullMQ + React 19 前端，中日双语），已上线运行（V13）。

## 对比表

| 维度 | OpenSalon (clawnify/OpenSalon) | Easy!Appointments (alextselegidis/easyappointments) | Lumina (effuselabs/lumina) |
|---|---|---|---|
| 许可证（LICENSE 原文核验） | **MIT**（Copyright (c) 2026 Clawnify） | **GPL-3.0**（代码；内容 CC BY 3.0） | **AGPL-3.0** |
| 技术栈 | TypeScript、Preact + Tailwind v4 + shadcn/ui、Hono、**SQLite / Cloudflare D1（Wrangler/Workers 运行时）**、Zod；构建于厂商自研框架 `@clawnify/app` ^0.4.9、`@clawnify/db` ^0.4.3 | **PHP 8.2+ / CodeIgniter / MySQL**、jQuery 系前端、REST API | TypeScript strict、**Next.js 14 + React 18、PostgreSQL 15 + Prisma**、NextAuth v5、Tailwind + Radix、Resend 邮件、Jest/Playwright |
| 仓库年龄/热度 | 2026-04-04 创建；70 ★ / 44 forks；4 个 open issues | 2014-11-26 创建；**4,497 ★ / 1,594 forks**；190 个 open issues | 2026-09-07 创建；**1 ★ / 0 forks**；51 个 open issues |
| 最近提交 | 2026-11-17（活跃，但近月提交多为框架版本跟随与 README） | 2026-11-13（持续维护） | 2026-10-29（近三周无新提交） |
| 正式 Release | **无**（releases/latest 返回 404） | **v1.6.1，2026-10-12 发布**，发布说明自称 "stable release, you can use it in production" | **无**（releases/latest 返回 404） |
| 预约 | ✓ 日历（员工分列日视图）、多服务预约、改期、封锁时段、状态流转 | ✓ 成熟：预约、工作时间计划（working plans）、预约规则、改期/取消 | ✓ 公开预约页 + 真实可用时段；所有者日历 |
| 员工 | ✓ 名录、颜色、启停、业绩计数 | ✓ 服务商（providers）+ 服务组织、工作时间 | ✓ 员工与角色（Owner/Staff） |
| 顾客 | ✓ 客户库、备注/偏好、历史预约 | ✓ 顾客管理 | ✓ 客户管理、多租户业务隔离 |
| 收银/POS/支付 | ✗ README 功能表无任何支付/收银 | ✗ 核心无 POS（官网另有付费 Premium 扩展，非开源核心） | △ 标语称含 "financials"，但 README 状态说明大量周边产品未完成；无已交付支付证据 |
| 库存 | ✓ 零售产品、成本/售价、库存量、低库存提醒、SKU | ✗ | ✗ |
| 其他 | CSV 日单导出；单机/本地优先定位 | ✓ Google Calendar 同步、CalDAV（v1.6.1 新增设置）、邮件通知、多语言 | ✓ 多租户隔离为核心设计规则；邮件（Resend）**尚未真正投递**（README 自述） |
| 生产成熟度 | 低-中：自称 production-ready，但仓库 <8 个月、无 release、所依赖框架为 0.4.x pre-1.0、运行时绑定 Cloudflare | **高**：11 年历史、大规模部署、稳定版发布节奏、商业 Premium 业务在运营 | **低**：README 自述 "Pre-release… Not yet suitable for a salon's real customers"，且项目曾停滞后重启 |
| 代码能否进 TS/PG 产品 | 法律上最容易（MIT）；工程上栈部分吻合（TS+Hono），但前端是 Preact 而非 React、DB 是 SQLite/D1 而非 PostgreSQL、且与 `@clawnify/app` 框架耦合 | 不能：PHP 代码无法进入 TS 产品；且 GPL-3.0 代码复制进闭源产品会触发衍生作品开源义务 | 不能（AGPL §13 网络条款，见下）；栈虽相邻（PG），但 ORM/框架不同（Prisma/Next.js vs Drizzle/Hono） |
| 结论 | **借鉴组件与设计，不作底座** | **仅参考（reference only）** | **仅参考（reference only）** |

## 逐项说明

### 1. OpenSalon — MIT，栈最接近，但底座不成立

- **许可证**：LICENSE 原文为标准 MIT，版权方 Clawnify（2026）。2026-11-17 的提交 #28 还专门修正了 README 中与 LICENSE 不一致的许可证表述，说明维护者在意许可证准确性。
- **可复用性**：MIT 允许复制、修改、商用、SaaS 提供服务，无 copyleft 义务，仅需保留版权与许可证声明。这是三者中唯一可以合法把代码搬进闭源商业产品的。
- **为什么不作底座**：
  1. 数据层是 SQLite / Cloudflare D1，运行时是 Cloudflare Workers（`wrangler dev`）。Beauty Salon OS 的核心资产恰恰是 PostgreSQL 排斥约束 + 事务级防重复预约，迁移到底座等于放弃这套已验证的并发控制。
  2. 应用构建在厂商自研框架 `@clawnify/app`（0.4.9，pre-1.0）之上，仓库本身更像该框架的一个应用模板；采用它等于把底座押在一个 2026 年才出现、单一厂商维护的未成熟框架上。
  3. 无收银/支付、无多门店、无通知体系——美容院经营闭环的关键部分仍要自研，而它有的（预约/客户/员工/库存）现有系统已经有且更贴合日本业务（班次、技能、工位、缓冲时间、日结锁账）。
- **可借鉴**：日视图员工分列的交互设计、封锁时段的冲突警告文案与流程、产品库存的低库存提醒模型、CSV 日单导出。多服务预约的时长/价格自动计算逻辑可对照阅读（MIT，引用时保留版权声明即可）。

### 2. Easy!Appointments — 最成熟，但 GPL + PHP 双重不可复用

- **许可证**：LICENSE 原文为 GPL v3（2007 年文本），README 标注 "Code: GPL v3.0 / Content: CC BY 3.0"。
- **SaaS 义务辨析**：GPL-3.0 本身**没有** AGPL 的网络条款——仅把未修改的 GPL 程序作为网络服务运行，不触发源码提供义务。但以下情形会触发完整 copyleft：(1) 修改后**分发**（含交付给门店部署的安装包）；(2) 将其代码复制/改编进自己的产品（衍生作品整体须 GPL)。Beauty Salon OS 若未来采用"卖软件给门店部署"模式，GPL 会直接污染整个产品。因此**不得复制其代码**，只能借鉴功能与流程思想（思想不受版权保护）。
- **技术兼容性**：PHP/CodeIgniter/MySQL，与 TS 栈零复用可能。其价值在领域设计：working plans（员工工作时间计划）、预约规则、Google Calendar 双向同步与 CalDAV 集成的成熟做法，是三者中唯一经过 11 年真实部署打磨的。
- **成熟度**：4,497 ★、v1.6.1 稳定版（2026-10-12）、提交活跃至 2026-11-13，是三者中唯一可称为生产级的。短板：核心无收银/POS、无库存，支付类能力在其商业 Premium 线，不属于开源核心。

### 3. Lumina — AGPL + 自述未成熟，双重否决

- **许可证**：LICENSE 原文为 AGPL v3。README 用白话写明了 §13 的后果："If you offer a modified Lumina to other people over a network, you have to offer them your modified source as well." 对以 SaaS 形式提供给多家门店的商业产品，这意味着**只要把 Lumina 代码（哪怕修改后）作为网络服务提供，就必须向所有用户提供对应源码**——与其商业模式（其团队自己也计划靠付费托管赚钱）直接冲突。除非购买商业授权（仓库未提供此选项），否则不得复用其代码。
- **成熟度**：README 状态段自述 "Pre-release, and in an honest rebuild… booking emails are not delivered yet… **Not yet suitable for a salon's real customers**"，且项目"stalled once before and was restarted"。1 ★、0 forks、无 release、最近提交 2026-10-29。用户总提示词中"尚未达到生产成熟度的部分不能直接用于真实顾客"一条，正对此项目适用。
- **可借鉴（仅设计思想）**：多租户隔离纪律——其 CONTRIBUTING 规定"每条涉及业务数据的查询必须按 businessId 过滤"，与 Beauty Salon OS 已有的跨店隔离修复方向一致；公开预约接口"只返回白名单字段"的做法（2026-10-27 的安全修复）也值得对照自查。

## FullCalendar：MIT 的是日历，资源视图是 Premium

- 官网 fullcalendar.io 原文："Resource views require Premium plugins, but all other demos on this site are MIT." 两档划分：
  - **Standard（免费，MIT）**：日/周/月/列表/多月视图、拖拽、React/Vue/Angular 连接器、iCal feed、rrule 循环插件。
  - **Premium（商业授权，$480/年起，1–10 名开发者）**：**Timeline 视图、Vertical Resource View（资源分列）、资源数据层、打印友好渲染**。
- 对美容院最关键的"员工/工位分列的日排班视图"恰好属于 Premium 的资源视图，不在 MIT 范围内。（二手调研另提到 Premium 插件近年以 GPLv3/AGPLv3 作为 copyleft 备选授权提供——此点未在官网一手页面核实，若考虑走 copyleft 路线使用 Premium 插件，需先向 FullCalendar 官方确认当前版本条款。）
- **现状核查**：Beauty Salon OS **未使用任何日历库**——根 package.json 与 apps/admin-web/package.json（React 19 + react-router-dom 7 + Tailwind 4 + luxon）中无 FullCalendar 或同类依赖，店长端日历是自研的 `apps/admin-web/src/pages/Calendar.tsx`。因此不存在现成的许可证包袱；若未来引入 FullCalendar Standard（MIT）做月/周视图无问题，但员工分列视图要么付 Premium、要么继续自研（现有自研实现已支持拖动改期+确认弹窗，V5 已上线）。

## 总建议（架构路线 B/C，与用户提示词的选项对应）

1. **不换底座**。三个候选中没有任何一个在"许可证 × 技术兼容 × 成熟度"三角上同时成立：OpenSalon 是 MIT 但底座是 SQLite/Cloudflare + 未成熟自研框架；Easy!Appointments 成熟但是 GPL + PHP；Lumina 是 AGPL 且自述不可用于真实顾客。现有系统（PostgreSQL 事务防重、幂等、日结锁账、中日双语、平台适配框架）已上线的能力面大于三者任一的开源部分。
2. **可执行的借鉴清单**：
   - OpenSalon（MIT，可合法参考代码）：库存低库存提醒模型、封锁时段 UX、日单 CSV。
   - Easy!Appointments（仅思想）：working plans 数据模型、Google Calendar/CalDAV 同步的冲突处理流程——现有系统做 Google Calendar 适配器时对照设计，不抄代码。
   - Lumina（仅思想）：租户隔离的查询纪律、公开接口字段白名单——正好可沉淀为现有系统的安全自查清单。
3. **FullCalendar**：暂不引入；自研日历已满足员工分列+拖动改期。若将来需要月视图总览，可单独引入 MIT 的 Standard 插件，不碰 Premium 资源视图即可零成本合规。
