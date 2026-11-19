import { Queue } from "bullmq";
import type { AppConfig } from "./config.js";

/**
 * 通知投递的“唤醒”通道：API 把 notification_jobs 写进数据库（事实来源），
 * 再通过 BullMQ 唤醒 Worker 立即处理。即使 Redis 不可用，Worker 的数据库
 * 轮询兜底也会把任务领走 —— 队列驱动失败绝不影响预约主流程。
 */
export interface Notifier {
  enqueue(jobId: string): Promise<void>;
  close(): Promise<void>;
}

class BullMqNotifier implements Notifier {
  private queue: Queue | null = null;
  constructor(private readonly redisUrl: string) {}

  async enqueue(jobId: string): Promise<void> {
    try {
      this.queue ??= new Queue("notifications", {
        connection: { url: this.redisUrl, maxRetriesPerRequest: 1 },
      });
      await this.queue.add(
        "send",
        { jobId },
        { jobId: `notif-${jobId}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
      );
    } catch (e) {
      console.error("queue enqueue failed (worker db-poller will pick it up)", e);
    }
  }

  async close(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
  }
}

class DbOnlyNotifier implements Notifier {
  async enqueue(): Promise<void> {
    /* 任务已在数据库中，Worker 轮询领取 */
  }
  async close(): Promise<void> {}
}

export function createNotifier(config: AppConfig): Notifier {
  return config.QUEUE_DRIVER === "bullmq" ? new BullMqNotifier(config.REDIS_URL) : new DbOnlyNotifier();
}
