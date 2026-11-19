# Beauty Salon OS V2 — Ubuntu / Docker 增量部署

## 1. 上线前处理

- **先在测试库运行，不能在用户现有生产库直接试迁移。** 先备份旧数据库，留存旧源码包和旧 Docker 镜像。
- Node.js 22+；npm registry 可访问；Docker Compose v2；PostgreSQL 16。
- 用 `openssl rand -hex 32` 生成 JWT_SECRET；自行设置强数据库密码。
- 在 `infra/.env` 写明 `CORS_ORIGINS=https://salon.example.jp`，不能写 `*`。本地示例 `http://localhost:8080`。
- `.env` 的 `SEED_DEMO=false` 必须保持；生产 Compose 现在明确禁止以已知 demo1234 密码初始化。

## 2. 本地测试

```bash
cp .env.example .env
npm ci
# 设置 DATABASE_URL 指向测试数据库
npm run db:migrate
npm run typecheck
npm test
npm run build:web
npm run build -w @salon/api
npm run build -w @salon/worker
```

集成测试默认 `TEST_DATABASE_URL=postgres://salon@127.0.0.1:55432/salon_test`，会 `TRUNCATE ... CASCADE`；**必须是独立测试库，不可指向生产库**。首次升级需要核查 `0002_care_records.sql` 的建表、索引以及运行后数据是否仍然存在。

## 3. Docker 启动和创建正式店主

```bash
cd infra
cp ../.env.example .env
# 修改数据库密码、JWT_SECRET、SALON_DOMAIN 和 CORS_ORIGINS
# 首先保持 STORE_ID 为占位值、SEED_DEMO=false
docker compose up -d --build
```

第一次要创建自己的门店和店主，不要使用演示账号：

```bash
# 在当前 shell 中安全输入密码，不放进命令行历史
read -r -s -p 'Owner password: ' OWNER_PASSWORD; echo
export OWNER_PASSWORD
export OWNER_EMAIL='owner@example.jp'
export STORE_NAME='My Salon'
docker compose run --rm -e OWNER_PASSWORD -e OWNER_EMAIL -e STORE_NAME migrate \
  npx tsx packages/database/src/bootstrap.ts
unset OWNER_PASSWORD
```

命令打印新门店 UUID。将它复制到 `infra/.env` 的 `STORE_ID`，然后执行 `docker compose up -d --build web` 以更新顾客端构建时门店 ID。新建店主在 `/admin/` 登录，先录入服务、技师、工位和排班，再开放顾客预约。

## 4. 核验步骤

1. 打开 `/health`（经 Caddy 为 `/api/health`）确认数据库健康。
2. 店主登录，打开排单日历，选择项目和“智能空档推荐”，检查不同策略给出合理位置。
3. 从推荐卡进入预约弹窗，验证时间、技师和项目预选；提交后刷新日历并检查重叠约束。
4. 在客户详情新增美甲、美睫、美容记录；退出/登录后确认记录依旧存在。
5. 用另一店的用户访问护理记录或修改附加项，必须返回 403/404。
6. 手动修改 CORS_ORIGINS 为 `*`，production API 必须拒绝启动；恢复正确配置。
7. 测试备份/恢复一遍，再考虑接入真实客流。

## 5. 失败与回滚

若新版本运行异常，停止 Web/API 写入，恢复已保存的旧镜像/代码版本；**只有在确认旧版本与新增 schema 兼容时才可保留新库**，否则从部署前备份恢复完整测试过的旧库。`0002` 是新增表，无旧表结构变更，但仍需要在真实升级前演练。不要直接删除生产数据库或 `docker compose down -v`。

## 6. 限制

新增智能推荐只建议可预约时间，不创建保留位；顾客提交时原系统事务仍会做最终占用校验。护理档案暂为仅文字追加记录，没有图片上传、电子签字、医疗资料处理或客户自助下载。支付是记账功能，不是实际信用卡支付。详细安全要求见 `SECURITY_V2.md`。
