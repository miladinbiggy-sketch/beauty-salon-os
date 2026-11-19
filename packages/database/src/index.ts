import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export * as schema from "./schema.js";
export * from "./password.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string): DbHandle {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export function databaseUrlFromEnv(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}
