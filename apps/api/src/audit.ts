import { schema, type Database } from "@salon/database";

/** 敏感字段脱敏：写审计日志前移除密码/令牌/完整联系方式等。 */
const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "phone",
  "email",
  "lineUserId",
  "providerRef",
]);

export function redact(input: unknown, depth = 0): unknown {
  if (depth > 4 || input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export interface AuditEntry {
  storeId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  details?: unknown;
}

/** 审计写入失败不阻断主流程，但会打到 stderr 以便运维发现。 */
export async function writeAudit(db: Database, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(schema.auditLogs).values({
      storeId: entry.storeId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ip: entry.ip ?? null,
      details: (redact(entry.details ?? {}) ?? {}) as Record<string, unknown>,
    });
  } catch (e) {
    console.error("audit write failed", e);
  }
}
