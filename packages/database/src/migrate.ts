import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, databaseUrlFromEnv } from "./index.js";

const handle = createDb(databaseUrlFromEnv());
try {
  await migrate(handle.db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
  console.log("Migrations applied.");
} finally {
  await handle.close();
}
