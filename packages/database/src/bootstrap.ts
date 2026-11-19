import { eq } from "drizzle-orm";
import { createDb, databaseUrlFromEnv } from "./index.js";
import { hashPassword } from "./password.js";
import * as schema from "./schema.js";

/** First live store & owner, without enabling the publicly known demo credentials. */
const name = process.env.STORE_NAME?.trim();
const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.OWNER_PASSWORD ?? "";
if (!name || name.length > 100 || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 12) {
  throw new Error("Set STORE_NAME, valid OWNER_EMAIL and OWNER_PASSWORD (at least 12 characters) before bootstrap");
}
if (password === "demo1234" || password === "password123456") throw new Error("Weak bootstrap password is not allowed");
const handle = createDb(databaseUrlFromEnv());
try {
  const storeId = await handle.db.transaction(async (tx) => {
    const exists = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
    if (exists.length) throw new Error("Owner email is already in use; refusing to overwrite");
    const [store] = await tx.insert(schema.stores).values({ name, nameJa: name, timezone: "Asia/Tokyo" }).returning({ id: schema.stores.id });
    if (!store) throw new Error("Store creation failed");
    for (let day = 1; day <= 7; day++) {
      await tx.insert(schema.businessHours).values({
        storeId: store.id, weekday: day, openTime: "10:00", closeTime: "19:00", isClosed: day === 7,
      });
    }
    await tx.insert(schema.users).values({
      storeId: store.id, email, passwordHash: hashPassword(password), role: "owner", name: "Owner",
    });
    return store.id;
  });
  console.log(`Store created: ${storeId}. Set STORE_ID=${storeId} in .env and rebuild the web image.`);
} finally {
  await handle.close();
}
