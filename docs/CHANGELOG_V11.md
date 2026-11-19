# Beauty Salon OS V11 — 营业时间与服务菜单保护（2026-11-19 JST）

## 基线 / 入库

- 真实代码基线：`Beauty_Salon_OS_V10_LINE通知去重与过期提醒保护候选源码.zip`。
- V10 SHA-256：`844a5f3fe7b61ea23b858efdc0fc74a7a8cd6271a14b683db6d790d8628cc790`，本轮重新检验一致；V7/V8/V9 也与已记录 SHA-256 一致，ZIP CRC 均通过。
- 本轮启动时 `/Beauty Salon OS` Library 目录读取返回内部错误；V7 的入库重试返回 `AccessDeny`。不能称后续候选版本已成为文件库正式基线；本轮尝试 V11 上传仍返回 `AccessDeny`。因此 V11 是**本地可核验候选源码**，尚未入库；最后已确认入库版本是 V6。

## 真正解决的经营问题

1. **店长把周三营业时间从 10:00–20:00 改为 10:00–19:00，已有顾客预约 18:30–19:30**。旧 API 会直接改营业时间，顾客照样有一张已确认却不在营业时间内的订单。V11 在事务级门店预约锁下按东京当地星期、时间核对未来未结束的有效预约；关闭整天、提前打烊或推迟开门导致冲突时返回 HTTP 409 和具体预约 ID、星期序号。不泄露顾客联系方式。
2. **店长保存门店电话、设置及营业时间，旧前端连续请求两次**。若第一笔保存成功、第二笔因预约冲突失败，界面显示失败但实际上门店资料已经被部分修改。V11 前端现在只发送 `PUT /admin/store` 一次，传 `businessHours`、店名、设置等，数据库在一个事务里检查+更新+记录审计；任一环节失败全部回滚。旧的 `PUT /admin/business-hours` 继续可用，但采用相同锁和冲突检查。
3. **停用或者改变已有客人预约项目的工位类型**。即使 V9 保护了设备/技师，仍可以直接停用服务本身。V11 对 PUT/DELETE `/admin/services/:id` 加入相同锁及预约引用检查，阻止有未结束有效预约的菜单被停用或更换设备类型；改名称、价格、时长继续允许，因为已预约订单持有服务快照。成功修改及软停用记录门店内审计。

## 本轮实际代码

| 文件 | 改动 |
| --- | --- |
| `apps/api/src/services/store-hours-guards.ts` | 独立单测可测的周营业时间有效性、收缩条件和服务窗口边界规则 |
| `apps/api/src/services/master-data-guards.ts` | 新增已预约服务停用/设备类型变更判定函数 |
| `apps/api/src/routes/admin.ts` | 事务门店锁、Tokyo 星期/时间 PostgreSQL 已预约过滤、七个唯一星期与开闭顺序校验、组合门店设置原子保存、服务菜单防破坏、审计 |
| `apps/admin-web/src/pages/Settings.tsx` | 同一请求保存设置与营业时间；业务冲突提示不再伪装成功 |
| `apps/admin-web/src/pages/Services.tsx` | 服务停用/工位变更 HTTP 409 中日文提醒 |
| `packages/i18n/src/{zh-CN,ja}.ts` | 2 组新增中日双语错误提示 |
| `tests/store-hours-guards-unit.test.mjs` | 4 组新纯 Node 单测；七天唯一、不允许逆时段、限制条件、顾客服务结束边界 |
| `tests/master-data-guards-unit.test.mjs` | 新增 1 组菜单变更回归单测 |
| `apps/api/src/api.test.ts` | 新增 3 组实际 PostgreSQL 接口场景，但尚未运行：角色/日期规则、409 原子回滚与取消后成功、服务菜单停用冲突与恢复 |
| `README.md`, `docs/COMPETITOR_RESEARCH.md`, `docs/BUILD_REPORT_V11.json` | 升级说明、来源与许可边界、真实验收状态 |

## 验收标准与局限

- 前后端必须使用同一数据库；`storeLock` 是约定式 PostgreSQL transaction advisory lock，**绕过 API 直接修改表的其他客户端不受保护**。
- 周营业时间不支持跨午夜班次；对关店日可保留未使用的开/关时间，但恢复营业前必须成为合法日内窗口。
- 判定顾客的 `appointments.end_at` 而非 `blocked_end_at`：清洁缓冲可以在关店时间以后结束，与现有排班引擎一致。跨日服务目前设计不支持。
- 已预订服务的价格/时长/名称变更只影响**未来新预约**，不覆盖已有预约快照；但未来可用时间和现有预约可能存在特殊边界，需要数据库集成与浏览器端进一步验证。
- **无需新增迁移**，但生产升级仍要求已按序安装 V7 `0005` 与 V10 `0006` 等全部前置迁移。不能把本地静态检查当商用验收。
- PostgreSQL 集成测试、真实并发、浏览器端到端、npm 完整 typecheck **未执行/未通过**；需要在可安装依赖且有独立测试 PostgreSQL 的环境中运行。先备份再升级，不能直接操作顾客真实数据。
