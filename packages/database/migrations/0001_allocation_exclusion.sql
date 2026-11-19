-- 并发防重复预约的数据库级最后防线：
-- 同一技师 / 同一工位在 active 状态下的占用时间段绝不允许重叠。
-- 应用层在事务内用排单引擎校验 + advisory lock 串行化，
-- 即使将来出现绕过应用层的写入，这两条排斥约束也会直接拒绝。
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "resource_allocations"
  ADD COLUMN "during" tstzrange GENERATED ALWAYS AS (tstzrange("start_at", "end_at")) STORED;
--> statement-breakpoint
ALTER TABLE "resource_allocations"
  ADD CONSTRAINT "excl_staff_allocation_overlap"
  EXCLUDE USING gist ("staff_id" WITH =, "during" WITH &&)
  WHERE ("staff_id" IS NOT NULL AND "active");
--> statement-breakpoint
ALTER TABLE "resource_allocations"
  ADD CONSTRAINT "excl_resource_allocation_overlap"
  EXCLUDE USING gist ("resource_id" WITH =, "during" WITH &&)
  WHERE ("resource_id" IS NOT NULL AND "active");
