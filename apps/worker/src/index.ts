import { Worker as BullWorker } from "bullmq";
import { createDb } from "@salon/database";
import { loadWorkerConfig } from "./config.js";
import { claimJobById, processClaimedJob, processDueJobs, recoverStuckJobs } from "./processor.js";

/**
 * 通知 Worker：
 * - BullMQ 消费（即时唤醒）：API 入队后立刻尝试领取并发送；
 * - 数据库轮询（兜底）：每 WORKER_POLL_MS 扫一遍到期任务，
 *   覆盖未来时间的提醒、Redis 中断、进程重启等全部情况。
 * 两条路径都用同一套原子领取逻辑，不会重复发送。
 */
async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const handle = createDb(config.DATABASE_URL);
  const db = handle.db;
  const lineToken = config.LINE_CHANNEL_ACCESS_TOKEN;

  await recoverStuckJobs(db);
  console.log(
    `Beauty Salon OS worker started (queue=${config.QUEUE_DRIVER}, line=${lineToken ? "configured" : "not configured"}, poll=${config.WORKER_POLL_MS}ms)`,
  );

  let bull: BullWorker | null = null;
  if (config.QUEUE_DRIVER === "bullmq") {
    bull = new BullWorker(
      "notifications",
      async (job) => {
        const jobId = (job.data as { jobId?: string }).jobId;
        if (!jobId) return;
        const claimed = await claimJobById(db, jobId);
        if (claimed) await processClaimedJob(db, claimed, lineToken);
      },
      { connection: { url: config.REDIS_URL, maxRetriesPerRequest: null } },
    );
    bull.on("failed", (job, e) => console.error("bullmq job failed", job?.id, e.message));
    bull.on("error", (e) => console.error("bullmq worker error", e.message));
  }

  let polling = false;
  const tick = async () => {
    if (polling) return;
    polling = true;
    try {
      await recoverStuckJobs(db);
      const n = await processDueJobs(db, lineToken);
      if (n > 0) console.log(`processed ${n} due notification job(s)`);
    } catch (e) {
      console.error("poll tick failed", e);
    } finally {
      polling = false;
    }
  };
  await tick();
  const timer = setInterval(tick, config.WORKER_POLL_MS);

  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, shutting down`);
    clearInterval(timer);
    await bull?.close().catch(() => undefined);
    await handle.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("worker failed to start", e);
  process.exit(1);
});
