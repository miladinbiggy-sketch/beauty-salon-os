import { SignJWT, jwtVerify } from "jose";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { schema, type Database } from "@salon/database";
import { AppError, err, type UserRole } from "@salon/shared";

export const SESSION_COOKIE = "salon_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const TOKEN_ISSUER = "beauty-salon-os";
const TOKEN_AUDIENCE = "salon-admin";

export interface AuthUser {
  userId: string;
  storeId: string;
  role: UserRole;
  staffId: string | null;
  name: string;
  email: string;
}

const encoder = new TextEncoder();

/** Only opaque IDs are put in JWT; permissions are always reloaded from DB. */
export async function signAccessToken(secret: string, userId: string, sessionId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(sessionId)
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(SESSION_MAX_AGE_SECONDS + "s")
    .sign(encoder.encode(secret));
}

export async function verifyAccessToken(secret: string, token: string): Promise<{ userId: string; sessionId: string }> {
  const { payload } = await jwtVerify(token, encoder.encode(secret), {
    algorithms: ["HS256"], issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE,
  });
  if (!payload.sub || !payload.jti || typeof payload.sub !== "string" || typeof payload.jti !== "string") {
    throw err.unauthorized("Invalid token payload");
  }
  return { userId: payload.sub, sessionId: payload.jti };
}

declare module "hono" {
  interface ContextVariableMap {
    authUser: AuthUser;
    sessionId: string;
  }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Authenticate against both DB session state and current account state.
 * Revocation, role changes, account deactivation and staff reassignment take effect immediately.
 * Origin validation is mandatory for mutations authenticated by HttpOnly Cookie.
 */
export function authMiddleware(
  db: Database,
  secret: string,
  roles?: UserRole[],
  allowedOrigins = "http://localhost:5174,http://localhost:8080",
) {
  const origins = new Set(allowedOrigins.split(",").map((v) => v.trim()).filter(Boolean));
  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization") ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const token = bearer || getCookie(c, SESSION_COOKIE) || "";
    if (!token) throw err.unauthorized("Missing session");
    if (!bearer && UNSAFE.has(c.req.method)) {
      const origin = c.req.header("Origin") ?? "";
      if (!origin || allowedOrigins === "*" || !origins.has(origin)) {
        throw err.forbidden("Invalid request origin");
      }
    }
    let ids: { userId: string; sessionId: string };
    try {
      ids = await verifyAccessToken(secret, token);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw err.unauthorized("Invalid or expired session");
    }
    const [row] = await db
      .select({ user: schema.users, session: schema.authSessions })
      .from(schema.authSessions)
      .innerJoin(schema.users, eq(schema.authSessions.userId, schema.users.id))
      .where(and(
        eq(schema.authSessions.id, ids.sessionId),
        eq(schema.authSessions.userId, ids.userId),
        isNull(schema.authSessions.revokedAt),
        gt(schema.authSessions.expiresAt, new Date()),
      ));
    if (!row || !row.user.active || !["owner", "manager", "staff"].includes(row.user.role)) {
      throw err.unauthorized("Session revoked or account disabled");
    }
    const user: AuthUser = {
      userId: row.user.id,
      storeId: row.user.storeId,
      role: row.user.role as UserRole,
      staffId: row.user.staffId,
      name: row.user.name,
      email: row.user.email,
    };
    if (roles && !roles.includes(user.role)) throw err.forbidden("Role not allowed");
    c.set("sessionId", ids.sessionId);
    c.set("authUser", user);
    await next();
  };
}
