import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { clientIp, RateLimiter } from "./ratelimit.js";

describe("production guardrails", () => {
  const base = {
    NODE_ENV: "production", DATABASE_URL: "postgres://example", JWT_SECRET: "e".repeat(64),
    CORS_ORIGINS: "https://salon.example.jp", RATE_LIMIT_DRIVER: "redis", SESSION_COOKIE_PATH: "/api",
  };
  it("requires shared rate limiting in production", () => {
    expect(() => loadConfig({ ...base, RATE_LIMIT_DRIVER: "memory" })).toThrow(/RATE_LIMIT_DRIVER/);
  });
  it("scopes session cookies to the app API path in production", () => {
    expect(() => loadConfig({ ...base, SESSION_COOKIE_PATH: "/" })).toThrow(/SESSION_COOKIE_PATH/);
  });
  it("rejects wildcard CORS and weak production signing keys", () => {
    expect(() => loadConfig({ ...base, CORS_ORIGINS: "*" })).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ ...base, JWT_SECRET: "short-secret-1234" })).toThrow(/JWT_SECRET/);
  });
  it("never trusts spoofed forwarded headers by default", () => {
    const headers = new Headers({ "x-forwarded-for": "8.8.8.8", "x-real-ip": "1.2.3.4" });
    expect(clientIp(headers)).toBe("unknown");
    expect(clientIp(headers, true)).toBe("8.8.8.8");
  });
  it("memory limiter refuses the next attempt after the threshold", async () => {
    const limiter = new RateLimiter(2, 60_000);
    await limiter.check("same");
    await limiter.check("same");
    await expect(limiter.check("same")).rejects.toMatchObject({ status: 429 });
  });
});
