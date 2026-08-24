import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/placeholder";

const pool = new Pool({
  connectionString,
  ssl:
    process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
      ? { rejectUnauthorized: false }
      : false,
});

export const db = drizzle(pool, { schema });
