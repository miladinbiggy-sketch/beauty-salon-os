import { Hono } from "hono";
import { cors } from "hono/cors";
import { AppError } from "@salon/shared";
import type { Database } from "@salon/database";
import type { AppConfig } from "./config.js";
import type { Notifier } from "./queue.js";
import { authRoutes } from "./routes/auth.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes, staffRoutes } from "./routes/admin.js";

export interface AppDeps {
  db: Database;
  config: AppConfig;
  notifier: Notifier;
}

export function buildApp({ db, config, notifier }: AppDeps): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: config.CORS_ORIGINS === "*" ? "*" : config.CORS_ORIGINS.split(",").map((s) => s.trim()),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
      maxAge: 600,
      credentials: config.CORS_ORIGINS !== "*",
    }),
  );

  app.get("/health", async (c) => {
    let dbOk = true;
    try {
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`SELECT 1`);
    } catch {
      dbOk = false;
    }
    return c.json({ ok: dbOk, service: "beauty-salon-os-api", time: new Date().toISOString() }, dbOk ? 200 : 503);
  });

  app.route("/auth", authRoutes(db, config));
  app.route("/public", publicRoutes(db, config, notifier));
  app.route("/admin", adminRoutes(db, config, notifier));
  app.route("/staff", staffRoutes(db, config));

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404));

  app.onError((e, c) => {
    if (e instanceof AppError) {
      return c.json(
        { error: { code: e.code, message: e.message, details: e.details ?? undefined } },
        e.status as 400 | 401 | 403 | 404 | 409 | 429 | 500,
      );
    }
    if (e && typeof e === "object" && "issues" in e) {
      // zod 校验错误
      return c.json({ error: { code: "VALIDATION", message: "Validation failed", details: (e as { issues: unknown }).issues } }, 400);
    }
    console.error("unhandled error", e);
    return c.json({ error: { code: "INTERNAL", message: "Internal error" } }, 500);
  });

  return app;
}
