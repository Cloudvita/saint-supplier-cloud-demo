import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/placeholder";

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

/**
 * One pooled client per process. RDS/Neon requires TLS — postgres.js picks that up
 * from `?sslmode=require` in the URL.
 */
const client =
  globalForDb.sql ??
  postgres(connectionString, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    ssl:
      process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
        ? "require"
        : undefined,
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = client;

export const db = drizzle(client, { schema });
export { schema };
