# V2 增量改写日志

改写采用原项目完整代码，未替换原有预约事务与日历组件。

## 已改写

1. `packages/scheduler/src/recommend.ts`：新增可解释的排单策略（最早可约、减少碎片、均衡技师负载）。输出评分、理由和指标，硬约束仍复用 `validatePlacement`。
2. `packages/scheduler/src/recommend.test.ts`：新增碎片时长、硬冲突、负载公平、结果数量测试。
3. `apps/api/src/routes/admin.ts`：新增 `POST /admin/schedule/recommendations`，从授权门店构建实际排单快照，计算候选；加入 `/customers/:id/care-records` GET/POST，按门店、员工授权；修复跨门店附加项目与技师技能引用问题。
4. `apps/admin-web/src/pages/SmartRecommendations.tsx` + `Calendar.tsx`：新增日历内的智能推荐面板；推荐时间可以打开现有预约弹窗并预选项目/员工。
5. `packages/database/src/schema.ts`、`migrations/0002_care_records.sql`、`migrations/meta`：追加式分类美容护理档案表；记录作者、门店、客户、关联预约与时刻。历史记录没有覆盖接口。
6. `apps/admin-web/src/pages/CareRecords.tsx` + `Customers.tsx`：客户详情页增加中日双语护理记录录入与时间线。
7. `apps/api/src/config.ts`、`infra/docker-compose*.yml`、`.env.example`：生产强密钥、明确跨域来源、默认不写演示数据。
8. `apps/admin-web/src/pages/Login.tsx`、`packages/database/src/seed.ts`：移除前端演示账号自动填充；生产禁止演示种子。
9. `packages/database/src/bootstrap.ts`：添加首次正式门店和店主账号初始化；额外脚本 `npm run db:bootstrap`。
10. `apps/api/src/api.test.ts`：添加推荐器权限、分类护理记录、跨门店附加项修改回归测试。

## 尚未开发或尚未验证

- 顾客端候补队列、限时 offer / booking hold、支付定金、LINE 真实发送、电子签名、图片对象存储、多店切换、真正多技师/非串行分段服务。
- 真实 PostgreSQL 迁移、完整 Vitest、HTTP E2E、前端 production build 与 Docker 镜像尚未在当前执行环境跑通。
- 安全隐患包括 localStorage JWT、进程内限流、信任代理头、敏感护理备注未做字段级加密；不能在未做生产安全加固前存医疗级敏感资料。
