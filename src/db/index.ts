import dns from "node:dns";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Serverless hosts (Vercel/AWS Lambda) typically have no outbound IPv6 route.
 * On a dual-stack DB host (Neon, Supabase, RDS), Node's default resolver can
 * still hand back an AAAA record first, and the resulting connect attempt
 * can hang. Forcing IPv4-first resolution avoids that.
 */
dns.setDefaultResultOrder("ipv4first");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env(.local) and fill it in.");
}
const connectionString = process.env.DATABASE_URL;
const isRemote = !connectionString.includes("localhost");

// `??` only falls through on null/undefined, not on "" — an unset-but-present
// env var (or any non-numeric value) would otherwise silently produce
// Number("") === 0, a connection pool that can never serve a query and hangs
// forever. `||` falls through on any falsy/NaN result too.
const poolMax = Number(process.env.DB_POOL_MAX) || 10;

/**
 * One pooled client per process (reused across warm invocations via Node's
 * module cache — no need for a manual globalThis cache here, which risks
 * colliding with an unrelated `globalThis.sql` set by another package).
 * RDS/Neon/Supabase require TLS — postgres.js picks that up from
 * `?sslmode=require` in the URL. `prepare: false` is required when the
 * connection goes through a PgBouncer transaction-mode pooler (e.g.
 * Supabase's :6543 pooler), which doesn't support prepared statements;
 * harmless otherwise.
 */
const client = postgres(connectionString, {
  max: poolMax,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: isRemote ? "require" : undefined,
  prepare: !isRemote,
});

export const db = drizzle(client, { schema });
export { schema };
