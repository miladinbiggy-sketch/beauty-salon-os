import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /** 配置后 channel=line 的任务走真实 LINE Messaging API；未配置时按失败处理并记录原因（不假装发送成功） */
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  WORKER_POLL_MS: z.coerce.number().int().min(1000).default(15_000),
  /** db = 只轮询数据库（无 Redis 环境）；bullmq = 同时消费 Redis 队列做即时唤醒 */
  QUEUE_DRIVER: z.enum(["bullmq", "db"]).default("bullmq"),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadWorkerConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  return envSchema.parse(env);
}
