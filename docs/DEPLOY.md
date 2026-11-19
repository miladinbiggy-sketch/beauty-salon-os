> ⚠️ 本文档属于原始 V1。**V3 正式部署请优先按照 [DEPLOY_V3.md](DEPLOY_V3.md)**。其中“先使用演示账号登录”的流程已经停用；不要在生产环境植入已知密码。

# 部署教程：在日本 Ubuntu 服务器上上线 Beauty Salon OS

适用：Ubuntu 24.04 LTS（东京区域 VPS，如 Vultr / ConoHa / さくら）。两种方式：

- **方式 A：独立域名**（推荐正式营业）——本项目自带 Caddy 自动签发 HTTPS。
- **方式 B：挂到已有站点子路径**（如 `qingliu666.com/salon/`）——复用已有 Caddy，见文末。

---

## 方式 A：独立域名部署

### 1. 准备服务器

```bash
sudo apt-get update && sudo apt-get upgrade -y
# 安装 Docker（官方脚本）
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # 重新登录后生效
```

### 2. 域名解析

在域名服务商处把 `salon.你的域名.jp` 的 A 记录指向服务器公网 IP，等待生效（`dig +short salon.你的域名.jp` 能看到 IP 即可）。Caddy 会在首次访问时自动向 Let's Encrypt 申请证书，服务器需放行 80/443。

### 3. 上传代码并配置

```bash
git clone <仓库地址> beauty-salon-os   # 或用 scp/rsync 上传源码包
cd beauty-salon-os/infra
cp ../.env.example .env
```

编辑 `.env`，至少改这几项：

```ini
POSTGRES_PASSWORD=<强密码>
JWT_SECRET=<openssl rand -hex 32 的输出>
SALON_DOMAIN=salon.你的域名.jp
WEB_PORT=80
WEB_HTTPS_PORT=443
SEED_DEMO=false
STORE_ID=<你的门店 ID，见下方第 5 步>
```

### 4. 启动

```bash
docker compose up -d --build
docker compose ps        # postgres/redis/app healthy，migrate/seed 已退出(0)
docker compose logs app --tail 20
```

首次启动会自动：执行数据库迁移 → 启动 API / Worker / Web（Caddy）。

### 5. 创建正式门店与店主账号

演示种子是 `SEED_DEMO=true` 时才写入的演示数据。正式使用：

1. 使用 `packages/database/src/bootstrap.ts` 创建真实门店与初始店主账号（见 [DEPLOY_V2.md](DEPLOY_V2.md)）；
2. 在管理端配置营业时间、门店名、技师与服务项目；
3. 不要在生产环境创建任何演示账号；
4. 把 `.env` 的 `STORE_ID` 改为正式门店 ID，`SEED_DEMO=false`，`docker compose up -d --build web` 重建前端（门店 ID 在构建时注入顾客端）。

### 6. LINE 通知（可选）

1. 在 LINE Developers 创建 Messaging API 频道，取得 Channel access token（长期）；
2. `.env` 设置 `LINE_CHANNEL_ACCESS_TOKEN=<token>`，`docker compose up -d worker`；
3. 管理端「设置」开启 `lineConfigured`，并在客户档案里录入顾客的 LINE user ID；
4. 未配置时通知以 mock 模式记录在「通知」页，不会假装发送成功。

### 7. 备份（务必设置）

```bash
# 服务器 crontab：每天 04:30 备份，保留 14 天
30 4 * * * cd /path/beauty-salon-os && DATABASE_URL=postgres://salon:<密码>@localhost:5432/salon ./scripts/backup.sh /var/backups/salon && find /var/backups/salon -name 'salon-*.dump' -mtime +14 -delete
```

（容器内的 postgres 默认不映射宿主机端口；如需从宿主机直连，在 compose 给 postgres 加 `ports: ["127.0.0.1:5432:5432"]`，仅绑定本机回环。或者用脚本的 Docker 模式：不设 DATABASE_URL 时自动经容器执行。）

恢复：`./scripts/restore.sh /var/backups/salon/salon-YYYYMMDD-HHMMSS.dump`。

### 8. 日常运维

```bash
docker compose ps                 # 状态
docker compose logs -f app        # API 日志
docker compose logs -f worker     # 通知日志
docker compose pull && docker compose up -d --build   # 更新
```

---

## 方式 B：挂到已有站点子路径（qingliu666.com/salon/）

适用于先上线试运行、与现有站点共用域名与 Caddy 的场景：

1. 本系统以独立 compose 项目部署在本机回环端口（如 API 8787、前端静态文件目录）；
2. 前端构建时设置 `VITE_API_BASE=/salon-api`、`base: './'`（已默认相对路径）；
3. 在现有 Caddyfile 增加：

```caddy
handle_path /salon/* {
    root * /srv/salon-customer
    try_files {path} /index.html
    file_server
}
handle_path /salon-admin/* {
    root * /srv/salon-admin
    try_files {path} /index.html
    file_server
}
handle_path /salon-api/* {
    reverse_proxy 127.0.0.1:8787
}
```

4. **改完 Caddyfile 必须重启 Caddy 容器并验证线上内容**（单文件 bind mount 的 Caddyfile 在宿主机改文件会换 inode，容器内仍是旧文件，仅 `caddy reload` 不生效）；
5. 上线后验证：顾客端能打开、能查可用时间、能完成一笔预约；同时确认原站点（如中转站 `/api/status`）仍正常。

---

## 安全清单（上线前逐项确认）

- [ ] `JWT_SECRET`、`POSTGRES_PASSWORD` 已换成随机强值，且不在代码仓库里
- [ ] 演示账号已删除或改密；`SEED_DEMO=false`
- [ ] 服务器 SSH 禁用密码登录（确认密钥可登录后再改）
- [ ] 防火墙只放行 22/80/443；PostgreSQL / Redis 不暴露公网
- [ ] 备份定时任务已设置并做过一次恢复演练
- [ ] 支付只走合规服务商（本系统只记录收款方式与金额，不接触银行卡信息）
