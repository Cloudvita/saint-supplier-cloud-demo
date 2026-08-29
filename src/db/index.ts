import dns from "node:dns";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Serverless hosts (Vercel/AWS Lambda) typically have no outbound IPv6 route.
 * On a dual-stack DB host (Neon, Supabase, RDS), Node's default resolver can
 * still hand back an AAAA record first, and the resulting connect attempt
 * hangs until the platform's own function timeout — not our connect_timeout,
 * which only bounds the handshake once a socket attempt starts. Forcing
 * IPv4-first resolution avoids that hang entirely.
 */
dns.setDefaultResultOrder("ipv4first");

const connectionString =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/placeholder";

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

const isRemote = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("localhost");

/**
 * One pooled client per process. RDS/Neon/Supabase require TLS — postgres.js picks
 * that up from `?sslmode=require` in the URL. `prepare: false` is required when the
 * connection goes through a PgBouncer transaction-mode pooler (e.g. Supabase's
 * :6543 pooler), which doesn't support prepared statements; harmless otherwise.
 */
const client =
  globalForDb.sql ??
  postgres(connectionString, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: isRemote ? "require" : undefined,
    prepare: !isRemote,
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = client;

export const db = drizzle(client, { schema });
export { schema };
