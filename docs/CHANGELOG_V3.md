# Beauty Salon OS — V3 继续修复记录（2026-11-18）

> 对用户上传的 V2 ZIP 做增量修改，不删现有门店、服务、预约/护理记录数据。**代码已改动，但本机缺失 npm 包和数据库，完整构建/迁移/HTTP 测试均未验证。上线前必须在测试环境跑通。**

## 本轮实际改动

### 专业排单工作台
- 新增 `apps/admin-web/src/lib/calendar-layout.ts`：周视图跨技师同一时间预约自动分 lane，无重叠则恢复全宽。新增四项算法单测。
- 增加预约搜索（顾客姓名、电话、预约码、项目、技师）、状态过滤（有效／全部／完成／取消）、技师过滤，筛选仅改变可见卡片，不更改实际预约数据。
- 增加当前日期范围的有效预约数、待服务数、已完成数和**预约预计金额（非收银收入）**。
- 增加东京当前时间线、刷新按钮、页面获得焦点自动重载与45秒自动更新。
- 禁止点击休业日空白时间进行无效插单，标注定休日；预约卡片可通过键盘 Enter/空格打开详情。
- 修复异步请求竞态：切换日期后忽略旧日期请求响应；加载失败清空过期资料并显示错误。

### 管理端登录和会话
- 登录响应不再返回 JWT，改为服务端 Set-Cookie `salon_session`，`HttpOnly`、`SameSite=Lax`，生产加 `Secure`，12小时到期；生产 Cookie Path 必须为外部 API 前缀（独立站 `/api`、已有域名子路径 `/salon-api`），避免 Cookie 被同域其他服务收到。
- 前端首次启动自动清理 V2 遗留的浏览器 JWT 键，改为 `credentials: include` + `/auth/me` 会话恢复；登出请求服务器清除 Cookie。
- 对 Cookie 身份的 POST/PUT/PATCH/DELETE 强制 Origin 属于 `CORS_ORIGINS`；禁止 Cookie 写操作走 `*`；API 保留显式 bearer 认证支持外部可信客户端，浏览器端不使用。
- 加强 JWT claims 校验，新增登录 Cookie／Origin／登出测试。

### 限流与可信代理
- 生产启用 Redis 原子计数共享限流，登录同时采用每 IP 和每 IP＋账号限额，并拒绝来源不在许可名单的浏览器登录；涵盖登录、公开预约和订单码查询/取消/改期；Redis 失联时**拒绝请求**，不会不受限放行；使用哈希键保护邮箱/IP。
- 正式部署必须 `RATE_LIMIT_DRIVER=redis`；本地测试可以为 `memory`。
- 默认不信任 `X-Forwarded-For`，仅 `TRUST_PROXY=true` 且 API 私网隔离/可信 Caddy 清洗转发头时采用代理 IP。
- Compose 新增生产配置；新增 `security.test.ts` 验证防护设定。

## 已知限制和必须复测
- 尚未实现**服务端撤销已签发 JWT**：登出会删除本浏览器 Cookie，已泄漏的旧 JWT 直到12小时过期仍可能有效；正式商用需增加 `session_id` + 服务端会话表/吊销机制、账号禁用立即生效和强制下线。
- Redis 固定时间窗限流，不是精细滑动窗；单 IP 误伤、反代客户端 IP 注入和多实例压测需实际验证。
- 此轮没有改动 DB schema，原有 `0002_care_records.sql` 迁移仍需在隔离测试库验证；也没有把 V2 的“候补、支付、照片、LINE联调”宣称为完成。
- 前端周视图超多同时段预约时会形成较窄 lane；仍需浏览器端视觉测试和可访问性测试。
- 必须运行：`npm ci && npm run typecheck && npm test && npm run build:web && npm run build -w @salon/api`；API 集成测试会清空独立测试库，绝不能指向生产。
- 升级会让旧版存储在 localStorage 的会话失效，用户需重新登录；需使用 HTTPS 及正确 `CORS_ORIGINS`。
