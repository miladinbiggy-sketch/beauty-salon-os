import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema, verifyPassword, type Database } from "@salon/database";
import { err, type UserRole } from "@salon/shared";
import type { AppConfig } from "../config.js";
import { authMiddleware, signAccessToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, type AuthUser } from "../auth.js";
import { RateLimiter, clientIp } from "../ratelimit.js";
import { writeAudit } from "../audit.js";

export function authRoutes(db: Database, config: AppConfig): Hono {
  const app = new Hono();
  const loginLimiter = new RateLimiter(10, 60_000, { driver: config.RATE_LIMIT_DRIVER, redisUrl: config.REDIS_URL, namespace: "login_account" });
  const ipLimiter = new RateLimiter(30, 60_000, { driver: config.RATE_LIMIT_DRIVER, redisUrl: config.REDIS_URL, namespace: "login_ip" });
  const allowedOrigins = new Set(config.CORS_ORIGINS.split(",").map((v) => v.trim()));

  app.post("/login", async (c) => {
    const origin = c.req.header("Origin");
    // Login itself can mutate the victim's browser session (login CSRF).
    // Reject foreign browser origins; allow origin-less programmatic requests.
    if (origin && !allowedOrigins.has(origin)) throw err.forbidden("Invalid login origin");
    const body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).parse(await c.req.json());
    const ip = clientIp(c.req.raw.headers, config.TRUST_PROXY);
    await ipLimiter.check(ip);
    await loginLimiter.check(`${ip}:${body.email.toLowerCase()}`);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, body.email.toLowerCase()));
    if (!user || !user.active || !verifyPassword(body.password, user.passwordHash)) {
      throw err.unauthorized("Invalid email or password");
    }
    const authUser: AuthUser = {
      userId: user.id,
      storeId: user.storeId,
      role: user.role as UserRole,
      staffId: user.staffId,
      name: user.name,
      email: user.email,
    };
    // Persist first: a signed token without a live server session is never accepted.
    const [session] = await db.insert(schema.authSessions).values({
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    }).returning({ id: schema.authSessions.id });
    if (!session) throw err.internal("Could not create session");
    const token = await signAccessToken(config.JWT_SECRET, user.id, session.id);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: "Lax",
      path: config.SESSION_COOKIE_PATH,
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    c.header("Cache-Control", "no-store");
    await writeAudit(db, {
      storeId: user.storeId, actorUserId: user.id, action: "auth.login",
      entityType: "user", entityId: user.id, ip, details: {},
    });
    // Intentionally do NOT include token in JSON: browser JS never receives session secret.
    return c.json({ user: authUser });
  });

  app.get("/me", authMiddleware(db, config.JWT_SECRET, undefined, config.CORS_ORIGINS), (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ user: c.get("authUser") });
  });

  app.post("/logout", authMiddleware(db, config.JWT_SECRET, undefined, config.CORS_ORIGINS), async (c) => {
    await db.update(schema.authSessions).set({ revokedAt: new Date() })
      .where(eq(schema.authSessions.id, c.get("sessionId")));
    deleteCookie(c, SESSION_COOKIE, { path: config.SESSION_COOKIE_PATH, secure: config.isProd, sameSite: "Lax" });
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true });
  });

  return app;
}
