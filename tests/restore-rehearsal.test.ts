import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, type DbHandle } from "@salon/database";

/**
 * 备份恢复演练（本地版）：在一台全新空库上完整重放迁移，
 * 验证 schema、关键表与防重复预约的排斥约束都能从零重建——
 * 这是 restore.sh 恢复流程的前半段（对象重建）。
 * pg_dump/pg_restore 的整库搬运在部署阶段用 Docker 环境实测（见 docs/FEATURES.md）。
 */
const ADMIN_URL =
  process.env.TEST_ADMIN_URL ?? "postgres://salon@127.0.0.1:55432/postgres";
const RESTORE_DB = "salon_restore_check";
const RESTORE_URL = `postgres://salon@127.0.0.1:55432/${RESTORE_DB}`;

let handle: DbHandle | null = null;

afterAll(async () => {
  await handle?.close();
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_DB}`);
  await admin.end();
});

describe("从零恢复演练", () => {
  it("空库重放迁移后，关键表与排斥约束齐全", async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_DB}`);
    await admin.query(`CREATE DATABASE ${RESTORE_DB}`);
    await admin.end();

    handle = createDb(RESTORE_URL);
    const migrationsFolder = new URL("../packages/database/migrations", import.meta.url).pathname;
    await migrate(handle.db, { migrationsFolder });

    const check = new Client({ connectionString: RESTORE_URL });
    await check.connect();
    const tables = await check.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = tables.rows.map((r) => r.table_name as string);
    for (const required of [
      "stores", "users", "roles", "customers", "staff", "staff_skills", "services",
      "service_addons", "resources", "shifts", "blocked_times", "appointments",
      "appointment_services", "resource_allocations", "payments", "notification_jobs", "audit_logs",
    ]) {
      expect(names, `missing table ${required}`).toContain(required);
    }
    const constraints = await check.query(
      `SELECT conname FROM pg_constraint WHERE conname LIKE 'excl_%'`,
    );
    expect(constraints.rows.map((r) => r.conname).sort()).toEqual([
      "excl_resource_allocation_overlap",
      "excl_staff_allocation_overlap",
    ]);
    await check.end();
  });
});
