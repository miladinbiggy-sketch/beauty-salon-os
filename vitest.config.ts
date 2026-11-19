import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // 集成测试共用一个本地 PostgreSQL 实例，串行跑文件避免建库竞争
    fileParallelism: false,
  },
});
