# Beauty Salon OS V13 — 日本＋中国平台接入框架与人工核对闭环

日期：2026-11-19（日本时间）
基线：`Beauty_Salon_OS_V12_收银退款幂等与财务审计候选源码.zip`，SHA256 `6fe727d141c81963a401f0f298feecab0192ed42cb8c9f9009eb47b095adc003`；V7–V12 本轮在 `/Beauty Salon OS` 按顺序入库成功，目录二次读取确认。

## 本轮选择的三个真实经营问题

1. 日本、中国平台下单来源多、字段不同，不能凭截图或未授权爬取改写本地排期：新增 provider-neutral 自有签名接入，不存客户隐私或平台密码，不把未验证的订单直接写入正式预约。
2. 合作方网络重试可能重复造成两笔待办，跨门店事件可能误导：数据库唯一键 + SHA256 事件校验，按门店隔离，HMAC-SHA256（32字节随机密钥/5分钟时间窗/恒定时间校验）；在预约 `storeLock` 内完成来源冲突初检。所有事件由店长人工核对，拒绝隐式资金操作。
3. 日常开店需要最简单的跨软件方式：新增店长管理页和无客户 PII 的 CSV/ICS 导出（日本 Excel 与中国 Excel 均可读取 UTF-8 BOM），导出限制 31 天/5000条，用户界面为所选日期起7天。禁止 CSV 公式注入，错误与状态提供中日文说明。

## 实际修改文件

- `apps/api/src/services/integration-contract.ts`（新）——渠道目录、密钥格式验证、HMAC 签名、事件指纹、CSV 安全导出。
- `apps/api/src/routes/integrations.ts`（新）——正式接收端点和带权限的店长查询/确认/CSV/ICS API。
- `apps/api/src/app.ts`、`config.ts`——注册隔离路由、强制有效签名配置；无平台授权默认不开放外部写入。
- `packages/database/migrations/0008_integration_inbox.sql`（新）、`packages/database/src/schema.ts`——幂等唯一索引、状态约束、外键、筛选索引。
- `apps/admin-web/src/pages/Integrations.tsx`（新）、`App.tsx`、`lib/api.ts`、`packages/i18n/src/{ja,zh-CN}.ts`——店长候选清单、待核对队列、手动标记与脱敏文件下载。
- `apps/api/src/api.test.ts`（新增真实 PostgreSQL 场景：已写未运行）、`tests/integration-bridge-unit.test.mjs`（纯 Node 单测）。
- `.env.example`、`infra/docker-compose.yml`、`infra/docker-compose.server.yml`、`README.md`、`docs/INTEGRATIONS_JP_CN.md`、`docs/COMPETITOR_RESEARCH.md`。

## 验收和限制

具体实测数字以 `docs/BUILD_REPORT_V13.json` 为准，旧版本未删除、未覆盖。真实商家凭据和真实顾客数据均未接触。迁移只在测试库先执行、不能直接认定商业验收。本轮没有复制 CSNEXT/SALON BOARD 的闭源代码，也没有纳入 OpenSalon/Easy!Appointments 的强 copyleft 源码或付费 FullCalendar Premium 模块。
