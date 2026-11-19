# V3 → V4 安全升级与测试

**升级先在备用服务器和测试数据库演练。严禁把现有 `apps/api/src/api.test.ts` 指向生产数据库：测试会 TRUNCATE 多张业务表。**

## 1. 升级前

1. 停止新的顾客预约入口，记录服务器当前 V3 版本与环境变量。
2. 使用 `scripts/backup.sh` 对生产 PostgreSQL 执行备份，并在隔离数据库练习恢复；备份客户照片和 `.env`（仅保存到受限安全位置）。
3. 复制 V4 工程到新目录，保留生产数据库数据卷，不要运行 `db:seed`。
4. 检查 PostgreSQL 16+、Node 22+、Redis 7+ 及 Caddy HTTPS，生产的 `JWT_SECRET`、`CORS_ORIGINS`、`SESSION_COOKIE_PATH`、`TRUST_PROXY`、`RATE_LIMIT_DRIVER` 保持正确配置。

## 2. 独立测试环境运行

```bash
npm ci
npm run typecheck
npm test                     # 必须仅针对 TEST_DATABASE_URL 指向的独立测试数据库
npm run build:web
npm run build -w @salon/api
npm run build -w @salon/worker
```

对隔离数据库备份后执行：

```bash
npm run db:migrate             # 自动执行 0003_auth_sessions.sql
```

验证 `auth_sessions` 表已经创建：

```sql
SELECT to_regclass('public.auth_sessions');
```

**不要先迁移生产再排查未通过的测试。** 新增迁移仅创建一张会话表和两个索引，不修改旧客户/订单表。

## 3. 人工验收清单

- 在同域 HTTPS 完成登录、刷新会话、登出，确认登出前保存的 Cookie 不能再获取 `/auth/me`。
- 停用一个测试技师账号，旧会话立即 401；重新启用后仍需重新登录。
- 变更测试员工角色，旧会话失效，新登录拿到新角色。
- 顾客预约、取消、改期、多个顾客抢约同一时间没有撞单，改期不能绕过提前时间限制。
- 订单完成、录入现金收款、两台客户端同时申请退款，台账累计退款不得超过原支付金额。
- 其他门店技师／设备不能被绑定到本店，请假、排班、客户资料访问都要隔离。
- LINE 未配置时仅模拟通知；配置后需要对实际官方账号另行联调。
- 检查手机、电脑端日历、登录、导航和双语页面。

## 4. 上线切换

- 检查数据库备份可恢复，确保已执行并通过全部测试。
- 在维护窗口部署 V4，并执行正式数据库迁移，然后启动 API/Worker/静态前端。
- **V3 登录状态全部失效**：请通知店长、前台、技师重新登录。
- 核对接入层外部 API 前缀与 Cookie Path 一致：独立站 `/api`，子路径模式 `/salon-api`。
- 监控错误日志、预约创建与变更、通知队列积压、退款台账和 PostgreSQL 连接数。

## 5. 回滚

保留 V3 完整构建产物；如需回滚到 V3，需知晓 V4 的新会话 JWT 与 V3 不兼容，所有账号将重新登录。V4 的 `auth_sessions` 是可保留的附加表，不建议回滚时删除该表以免影响审计；不要清理客户或预约数据。不可在已写入新订单后用旧数据库备份直接覆盖生产。

## 6. 当前未完成

完整依赖安装、数据库迁移与 Postgres 联调、真实支付网关退款、图像上传与存储、LINE 官方账号联调、完整渗透测试和性能压测仍未完成，不应直接接受真实支付或宣称已通过生产验收。
