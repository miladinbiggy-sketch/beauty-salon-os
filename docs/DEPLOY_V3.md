# Beauty Salon OS V3 测试与部署说明

## 上线风险说明
此次包含登录机制变更。请先备份旧源码、旧镜像与整库（含护理档案），在独立测试环境验证。现有线上服务**未**被本次文件修改自动更新。

1. 从 `infra/.env` 检查 `JWT_SECRET` 至少32字符随机串、`CORS_ORIGINS` 为**准确的管理端来源**（示例 `https://salon.example.jp` 或 `https://qingliu666.com`，不带路径）。
2. 生产 Compose 中 `TRUST_PROXY=true`、`RATE_LIMIT_DRIVER=redis`。同时确认 `SESSION_COOKIE_PATH` 与浏览器访问 API 的外部前缀一致：独立域名模式 `/api`，现有站点子路径模式 `/salon-api`。修改前缀会让现有 Cookie 失效，需重新登录。确保 `app:8787` 无公网端口，只有可信 Caddy 可访问。Caddy 必须清理来自外网的任意 `X-Forwarded-For`/`X-Real-IP` 伪造头。若 API 公网直连，不允许 `TRUST_PROXY=true`。
3. Caddy 必须为管理端和 API 配置 HTTPS；生产 Cookie `Secure`，不能在普通 HTTP 域名完成登录。
4. 使用 `npm ci`、`npm run typecheck`、`npm test`、`npm run build:web` 以及 API/Worker 构建。本轮尚未执行完整命令。请在**独立测试库**执行 API 集成测试，测试套件会 TRUNCATE 表。
5. 用浏览器在管理端进行“登录 → 刷新页面恢复会话 → 创建预约 → 改期 → 刷新日历 → 退出 → 再访问被保护页面”，并验证浏览器本地存储中没有 JWT。
6. 用 DevTools 检查 `salon_session` 为 HttpOnly/Secure/SameSite=Lax。用 Postman 无 Origin 发送已带会话 Cookie 的写请求，应返回 403。
7. 断开 Redis，验证登录/公开预约写请求会拒绝而不会放行；恢复 Redis 后重试。检查代理 IP 的实际归属正确。
8. 管理端周视图同一日期3位技师同时服务的卡片应分列显示、不会覆盖；搜索或状态筛选应仅改变显示，不改订单。
9. 验证无明显问题后，先小规模试营业；出现问题立即回滚上一版应用镜像，按备份进行恢复演练。

## 不能宣称已完成
- 不保证当前 ZIP 可以直接在生产服务器运行；完整依赖构建、PostgreSQL 并发集成、浏览器自动化未在此环境完成。
- 登出仍是清理 Cookie，不是服务端 JWT 立即失效；计划中的服务端会话撤销、照片、自动候补、真实收款仍未实现。
