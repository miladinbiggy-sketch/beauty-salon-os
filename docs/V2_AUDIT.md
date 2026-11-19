# Beauty Salon OS V2 — 源码审计记录（历史版本）

> 请以 [V3 变更记录](CHANGELOG_V3.md) 为准判断本轮是否已经修复该风险。

审计范围：用户提供的 `Beauty Salon OS 源码.zip`，静态代码审查（不是线上验证）。

| 模块 | 原版现状 | 证据 | 处理方式 | 本轮状态 |
|---|---|---|---|---|
| 预约核心 | 真实排单、事务锁和 PostgreSQL 排斥约束 | `packages/scheduler/src/engine.ts`, `apps/api/src/services/booking.ts`, `0001_allocation_exclusion.sql` | 保留 | 未重写 |
| 推荐时间 | 按开始时间先后排序，没有软目标 | `findAvailability()` | 加可解释的 3 策略软排序，保留硬约束 | 新增 `recommend.ts` 和 API/UI |
| 顾客档案 | 客户资料、消费和预约历史，缺分类护理参数 | `apps/admin-web/src/pages/Customers.tsx` | 新增独立追加式カルテ | 新增表/API/UI |
| 权限隔离 | 附加服务按 ID 修改时未校验归属门店；员工技能未校验服务归属 | `admin.ts` 原 `/addons/:id`、`staff` 端点 | 补门店归属校验 | 已修改 |
| 管理员身份 | JWT 12h，管理端令牌存在 localStorage | `auth.ts`, `lib/api.ts` | 尚未完成 HttpOnly 会话迁移 | **遗留 P0** |
| 限流 | 进程内 Map，信任转发 IP 头 | `ratelimit.ts` | 生产应迁移到 Redis/可信代理鉴权 | **遗留 P0** |
| 跨域配置 | `CORS_ORIGINS=*` 可用于生产 | `config.ts`, compose | 生产拒绝通配并要求明确强密钥 | 已修改 |
| 演示账号 | 登录页有一键填充 demo1234；demo seed 可写入 | `Login.tsx`, `seed.ts` | 移除登录按钮；生产阻断演示 seed；加入正式 owner 初始化 | 已修改 |
| 顾客照片/隐私 | 仅文字备注，没有私有文件存储 | `Customers.tsx` | 暂不在无加密对象存储时增加照片上传 | 未实现 |
| 多阶段排单 | 一个技师串行执行组合服务 | `planCombo()` | 需要新段模型和迁移，不能靠推荐器实现 | 未实现 |
| 候补/定金 | 未建立完整生命周期 | 原始 schema | 等 hold、报价/支付、限时 offer 设计评审 | 未实现 |

**验证边界：** 本轮成功解析所有 TypeScript/TSX 源文件，增量功能的完整 TS 类型检查、PostgreSQL 迁移执行、Vitest、Docker 构建尚未执行成功；原因是工作环境中 npm 包拉取超时、离线缓存不全且没有 Docker/PostgreSQL 工具。交付前须按 `DEPLOY_V2.md` 执行验证，不应将 ZIP 直接用于真实收款。
