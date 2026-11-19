# Beauty Salon OS 架构决定（V14，2026-11-19 核验）

结论：**采用 B＋C 混合路线——保留 Beauty Salon OS 自有业务核心（Hono＋Drizzle＋PostgreSQL），只在组件层整合许可证干净的成熟开源件；不更换底座、不迁移框架。**

完整调研证据见 `docs/OSS_EVALUATION_V14.md`（逐项核验仓库、LICENSE 文件与提交记录，下表为摘要）。

## 候选底座评估

| 项目 | 许可证 | 技术栈 | 维护状态（2026-11-19 核验） | 决定 |
|---|---|---|---|---|
| OpenSalon（clawnify/OpenSalon） | MIT | TypeScript、Preact + Hono、SQLite/Cloudflare D1、自研框架 @clawnify/app 0.4.9 | 约 70 star、2026-04 创建、无 Release；有预约/员工/客户/库存，无收银、无多门店、无通知 | **不采用为底座，可借鉴组件与设计**：MIT 是三者中唯一可合法搬代码的，但其 SQLite/D1＋未成熟自研框架撑不起现有 PostgreSQL 排斥约束防双占体系，且无收银 |
| Easy!Appointments（alextselegidis/easyappointments） | GPL-3.0 | PHP / CodeIgniter 4 / MySQL | 长期维护（v1.6.1，2026-10；4,497 star）；预约与日历同步成熟 | **不采用代码，仅借鉴产品流程**：GPL-3.0 传染性与未来商业分发冲突；PHP 栈不兼容。注：GPL-3.0 非 AGPL，单纯 SaaS 使用不触发开源义务，但衍生分发会 |
| Lumina（effuselabs/lumina） | **AGPL-3.0** | Next.js 14 / Prisma / PostgreSQL | 1 star、pre-release，README 自述不适合真实顾客 | **拒绝**：AGPL §13 网络条款与多门店 SaaS 商业模式直接冲突，且无商业授权选项；成熟度也不足 |
| FullCalendar | 核心 MIT；**Resource Timeline 等资源视图为付费 Premium** | JS 组件 | 活跃维护 | **不引入**：现有自研排单日历已满足需求且避开 Premium 授权费；未来若需时间轴视图再评估付费或替代件 |

## 为什么保留现有核心

1. **功能覆盖已领先候选底座**：预约排班（含数据库排斥约束防双占）、收银/退款幂等、日结锁账、护理记录、会话吊销、中日双语、平台接入收件箱均已上线并有 107 项真实 PostgreSQL 测试覆盖；换底座等于丢弃这些已验证资产。
2. **许可证干净**：现有依赖（Hono、Drizzle、BullMQ、React 等）均为 MIT/Apache 系，无 copyleft 风险。
3. **迁移风险不对称**：换 PHP 底座需重写全部业务规则与迁移链，回滚成本极高，而收益（对方有、我们没有的功能）接近于零。
4. **组件层按需整合**：报表、表格等通用组件未来优先选 MIT 组件（如 TanStack Table）嵌入现有前端，而不是整体换框架。

## 后续路线的约束

- 新功能继续以"业务模块＋迁移＋回归测试"的方式增量交付（本轮 V14 等候名单即按此模式）。
- 引入任何新开源依赖前，必须核验：许可证、最近提交、是否有 Release、是否单人维护。
- 禁止复制 GPL/AGPL 代码进本仓库；禁止使用无许可证的仓库代码。
