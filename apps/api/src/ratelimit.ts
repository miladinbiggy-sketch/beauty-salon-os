import { createHash } from "node:crypto";
import Redis from "ioredis";
import { err } from "@salon/shared";

export interface RateLimitOptions {
  driver?: "memory" | "redis";
  redisUrl?: string;
  namespace?: string;
}

/** Atomic fixed-window limiter. Redis is shared across replicas; production fails closed
 * if Redis is unavailable rather than silently accepting unlimited login/lookup attempts.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; expiresAt: number }>();
  private redis: Redis | null = null;
  private readonly driver: "memory" | "redis";
  private readonly namespace: string;

  constructor(private readonly limit: number, private readonly windowMs: number, options: RateLimitOptions = {}) {
    this.driver = options.driver ?? "memory";
    this.namespace = options.namespace ?? "general";
    if (this.driver === "redis") {
      this.redis = new Redis(options.redisUrl ?? "redis://localhost:6379", {
        lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
      this.redis.on("error", () => undefined);
    }
  }

  async check(key: string): Promise<void> {
    if (this.driver === "redis") {
      const redis = this.redis!;
      const digest = createHash("sha256").update(key).digest("hex");
      const redisKey = `salon:rate:${this.namespace}:${digest}`;
      try {
        if (redis.status === "wait") await redis.connect();
        // Atomic increment and first-hit expiry. Never publish raw emails/IPs as Redis keys.
        const count = Number(await redis.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return n",
          1, redisKey, String(this.windowMs),
        ));
        if (count > this.limit) throw err.rateLimited();
        return;
      } catch (error) {
        // Preserve the intentional 429; infrastructure errors fail closed.
        if (error instanceof Error && "status" in error) throw error;
        throw new Error("Rate limit backend unavailable; request rejected");
      }
    }
    const now = Date.now();
    const entry = this.hits.get(key);
    const current = !entry || entry.expiresAt <= now ? { count: 0, expiresAt: now + this.windowMs } : entry;
    current.count += 1;
    this.hits.set(key, current);
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.expiresAt <= now) this.hits.delete(k);
    }
    if (current.count > this.limit) throw err.rateLimited();
  }
}

/** Forwarded headers are untrusted unless the API is private to a sanitising reverse proxy. */
export function clientIp(headers: Headers, trustProxy = false, fallback = "unknown"): string {
  if (!trustProxy) return fallback;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headers.get("x-real-ip")?.trim();
  const ip = forwarded || realIp || "";
  return ip.length > 0 && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : fallback;
}
