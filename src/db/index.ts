import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

/**
 * One pooled client per process. RDS requires TLS — postgres.js picks that up
 * from `?sslmode=require` in the URL.
 */
const client =
  globalForDb.sql ??
  postgres(connectionString, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = client;

export const db = drizzle(client, { schema });
export { schema };
