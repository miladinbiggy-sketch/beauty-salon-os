import { DEFAULT_STORE_SETTINGS, type StoreSettings } from "@salon/shared";
import { z } from "zod";
import { parseIntegrationKeys } from "./services/integration-contract.js";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(16).default("dev-only-secret-change-me-please-32ch"),
  PORT: z.coerce.number().default(8787),
  /** bullmq = 经 Redis 队列即时投递；db = 仅写库由 Worker 轮询（无 Redis 时降级） */
  QUEUE_DRIVER: z.enum(["bullmq", "db"]).default("bullmq"),
  CORS_ORIGINS: z.string().default("http://localhost:5174,http://localhost:8080"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  RATE_LIMIT_DRIVER: z.enum(["redis", "memory"]).default("memory"),
  /** External browser API prefix, e.g. /api or /salon-api, so cookies never leak to other apps. */
  SESSION_COOKIE_PATH: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/).default("/"),
  /** V13: authorized partner-specific HMAC keys; no third-party credentials in database. */
  PARTNER_WEBHOOK_KEYS_JSON: z.string().default("{}").transform((v) => v || "{}"),
});

export type AppConfig = z.infer<typeof envSchema> & { isProd: boolean };

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  parseIntegrationKeys(parsed.PARTNER_WEBHOOK_KEYS_JSON); // fail closed on malformed configuration
  const isProd = env.NODE_ENV === "production";
  if (isProd) {
    if (parsed.RATE_LIMIT_DRIVER !== "redis") throw new Error("Production requires RATE_LIMIT_DRIVER=redis");
    if (parsed.SESSION_COOKIE_PATH === "/") throw new Error("Production SESSION_COOKIE_PATH must scope the cookie to the external API prefix");
    if (parsed.JWT_SECRET.length < 32 || parsed.JWT_SECRET.includes("dev-only-secret")) {
      throw new Error("Production JWT_SECRET must be a random string of at least 32 characters");
    }
    if (parsed.CORS_ORIGINS === "*" || parsed.CORS_ORIGINS.split(",").some((origin) => !/^https:\/\/[^/]+$/.test(origin.trim()) && !/^http:\/\/localhost(?::\d+)?$/.test(origin.trim()))) {
      throw new Error("Production CORS_ORIGINS must list explicit trusted origins; wildcard is forbidden");
    }
  }
  return { ...parsed, isProd };
}

export function storeSettingsOf(raw: unknown): StoreSettings {
  if (raw && typeof raw === "object") {
    return { ...DEFAULT_STORE_SETTINGS, ...(raw as Partial<StoreSettings>) };
  }
  return { ...DEFAULT_STORE_SETTINGS };
}
