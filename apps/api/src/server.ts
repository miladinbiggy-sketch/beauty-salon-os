import { serve } from "@hono/node-server";
import { createDb } from "@salon/database";
import { loadConfig } from "./config.js";
import { createNotifier } from "./queue.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const { db } = createDb(config.DATABASE_URL);
const notifier = createNotifier(config);
const app = buildApp({ db, config, notifier });

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`Beauty Salon OS API listening on http://localhost:${info.port}`);
});
