import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * 密码哈希：Node 内置 scrypt（无原生依赖）。
 * 存储格式：scrypt$N$r$p$<salt b64>$<hash b64>
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
