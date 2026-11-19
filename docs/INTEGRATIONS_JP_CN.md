# Beauty Salon OS V13 — 日本与中国外部软件接入契约

核验日期：2026-11-19（日本时间）

## 现在实际能做什么

- **无商家平台账户也能使用**：店长可导出指定 7 天（后台接口最多 31 天）的脱敏预约 CSV/ICS。包含预约 ID、员工 ID、时间、状态等，不包含姓名、电话、护理敏感记录、支付信息；CSV 适配 Excel UTF-8 BOM 并防公式注入。Google Calendar、Outlook 或其他支持 ICS 的系统可**手动导入文件**；不是实时同步，也没有配置 Google OAuth。
- **仅在获得商户授权并运行自己的中转服务后可接收**：所有列在 `integration-contract.ts` 的中日来源，均可经你控制的中转程序将其格式归一化，走 **Beauty Salon OS 私有签名协议** 写入门店待核对队列。仅接收不含姓名电话的匿名预约引用/时间/技师或项目映射；无法自动创建或修改顾客预约、支付、退款。
- **店长人工核对**：只限 owner/manager 查看来源事件、检查冲突/缺映射，标记「忽略」或关联**已经在 Beauty Salon OS 中真实创建**的预约 UUID，且同门店、开始时间偏差不能超过30分钟。关联仅作台账追踪，不等于修改外部平台订单。操作与审计同事务提交。
- **默认拒绝所有外部入口**：未在服务器设置每店每平台的独立签名密钥，全部 401；不把第三方密码、Cookie、AccessToken 存在数据库或网页。

## V13 自有中转签名协议（不兼容任何第三方原生 webhook）

1. 在商家已授权的前提下，运行自己的适配程序（此处 **不附带** 任何第三方登录、抓取、签约或 OAuth 代码），配置 `PARTNER_WEBHOOK_KEYS_JSON`：

```json
{"11111111-1111-4111-8111-111111111111:custom_bridge":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}
```

仅演示格式，请使用 `openssl rand -hex 32` 为每个门店/渠道生成不同的密钥，放在服务器密钥管理或 `.env`。不要上传真实密钥。线上 HTTPS 必须由 Caddy 保证；配置不得下发给浏览器。

2. 请求：

```http
POST /integrations/bridge/{storeUuid}/{providerId}/events
Content-Type: application/json
X-Salon-Timestamp: 1795050000
X-Salon-Signature: sha256=<HMAC_SHA256_hex>

{
  "eventId": "event-1001",
  "bookingRef": "opaque-booking-ref",
  "eventType": "booking_requested",
  "startAt": "2027-01-18T09:00:00+09:00",
  "endAt": "2027-01-18T10:00:00+09:00",
  "serviceRef": "external-service-code",
  "staffRef": "external-staff-code"
}
```

3. 先生成 `rawBody`（发送时的 UTF-8 原始字节），`unixSeconds = Math.floor(Date.now()/1000)`；签名值为 `HMAC_SHA256(keyBytes, ascii(unixSeconds + ".") || rawBody)` 的 hex。绝对不能在签名之后重新 JSON.stringify 或调整空白。密钥是 64 位 hex 解码后的 32 字节。服务端 5 分钟时间窗口，64KiB 大小上限，恒定时间签名比较。
4. `localServiceId` / `localStaffId` 可选，本地数据库 UUID 必须属于目标门店；未知映射进入 `needs_mapping`，已映射时与已有员工忙碌时段重叠进入 `conflict`。这只是提交时的冲突提示，**没有占位保证**；人工新建预约仍由现有事务锁和排斥约束判定。
5. 同一 `(storeId, providerId, eventId)` + 原始请求相同 -> HTTP 200 `{duplicate:true}`；首次 -> HTTP 202 `{duplicate:false, reviewState}`；同 eventId 但不同内容 -> HTTP 409；签名无效/过期 -> 401。重复和原始请求内容不落库，只存 SHA-256 摘要及筛选后的业务字段。
6. `booking_changed`、`booking_cancelled` 是单独事件，可用于人工核对，**不会自动取消或变更本地预约**。取消事件必须不带起止时间。禁止传姓名、电话、邮箱、疗程禁忌或图片：请求 JSON `strict()` 拒绝额外字段。

## 店长 API

- `GET /admin/integrations/catalog`：每平台的接入条件、是否配置**中转密钥**、是否存在**原生接入**（目前一律 false）；不返回密钥。
- `GET /admin/integrations/inbox?state=all|pending|needs_mapping|conflict|linked|ignored`：最近100条脱敏事件。
- `POST /admin/integrations/inbox/{uuid}/resolve`，body `{"resolution":"ignored"}` 或 `{"resolution":"linked","appointmentId":"<已创建预约UUID>"}`。禁止技师；重复标记409。
- `GET /admin/integrations/appointments.csv?from=<ISO时间>&to=<ISO时间>`：31天以内，最多5000条，脱敏 Excel CSV。
- `GET /admin/integrations/appointments.ics?from=<ISO时间>&to=<ISO时间>`：相同条件，隐私化私人时间块，不含姓名。

全部店长 API 受 Cookie/JWT 登录、CSRF Origin 检查（写操作）、门店隔离保护。

## 对接场景、实现程度与待办

| 场景 | 当前实际状态 | 商业上线前还缺什么 |
| --- | --- | --- |
| 日本 CSNEXT、SALON BOARD/Hot Pepper Beauty、KaruteKun | 预留渠道、CSV/ICS、人审队列 | 官方许可/合作方式与字段映射；不允许未授权抓取或模拟登录 |
| 日本 かんざし、Reservia | 预留渠道；如果签约开放 API 可写官方适配器 | 合作资质、沙箱、增量同步/回滚契约 |
| LINE Messaging API | V10 已有本系统消息发送设计，V13 仅提供来源登记 | 真实 LINE webhook 必须用其**独立的官方** `x-line-signature` 验证和事件模型，不能直接投本 HMAC 接口 |
| 日本/全球 Google Calendar | **已实现手动 ICS 导出** | Google OAuth、变更同步、水位记录、冲突双向解决 |
| 中国美团/大众点评 | 预留来源、签名中转格式 | 服务商/商户授权、可用预约 API 范围确认、沙箱接入 |
| 中国抖音生活服务 | 预留来源 | 系统服务商等权限审核、真实订单/核销 API 及回调验签 |
| 中国微信小程序/公众号、支付宝小程序 | 预留来源、预约前台可另行做小程序入口 | 授权、各自验签与消息模板、支付幂等及合规审查 |
| 中国小红书 | 预留来源、CSV/ICS | 可用官方商业接口确认；不采用非授权自动化 |
| 自有/已获授权的合作方服务 | **V13 HMAC 入站已写入源码（未过 PG 集成验收）** | 在非生产库验证并发、签名、密钥轮换、备份/恢复和隐私政策 |

## 部署顺序与不可夸大之处

1. 停止旧 API 和 Worker，备份数据库并在**假数据**测试环境做恢复演练；按顺序迁移到 `0008_integration_inbox.sql`。
2. 配置 `PARTNER_WEBHOOK_KEYS_JSON` 后启动 API，检查管理页按“中转密钥已配置”显示（**不代表真正连接供应商**）。开启 HTTPS、防暴露来源密钥。滚动更换密钥时需协调中转方，旧签名将被拒绝。
3. 先验证 HMAC 原始字节和过期请求；在测试数据库里反复发送同 eventId、异内容、并发、跨门店引用，确认不会新增预约和收银。再逐平台申请真实授权，接一次集成一个。
4. 定期人工核对待办、保存外部预约台账；CSV/ICS 导出可用于离线手动迁移，但**导入到外部系统可能暴露时段与预约标识**，需获店长授权。
5. V13 **未实现**真实 API 同步、原生供应商回调验签、全量客户同步、跨平台支付清算、跨境个人信息传输合规确认、完成的浏览器/PG 集成验收；不可向客户宣称这些已经上线。
