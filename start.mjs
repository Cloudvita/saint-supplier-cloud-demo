/**
 * Container entrypoint.
 *
 * Applies pending SQL migrations, then hands off to the Next.js standalone server.
 * This means a private RDS instance never has to be reachable from a laptop or a
 * CI runner — the app migrates itself on boot, inside the VPC.
 *
 * Set SKIP_DB_MIGRATE=true to disable (e.g. if you run migrations from a pipeline).
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const shouldMigrate = process.env.SKIP_DB_MIGRATE !== "true";

if (shouldMigrate) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[boot] DATABASE_URL is not set — cannot migrate. Exiting.");
    process.exit(1);
  }

  // A short-lived, single-connection client just for the migration.
  const client = postgres(url, { max: 1, connect_timeout: 15 });
  try {
    console.log("[boot] applying database migrations…");
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("[boot] migrations up to date");
  } catch (err) {
    console.error("[boot] migration failed:", err);
    process.exit(1);
  } finally {
    await client.end({ timeout: 5 });
  }
} else {
  console.log("[boot] SKIP_DB_MIGRATE=true — skipping migrations");
}

console.log("[boot] starting Next.js server…");
await import("./server.js");
