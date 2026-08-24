export const dynamic = "force-dynamic";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { buildDemoRows } from "@/db/seed-data";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/seed   Authorization: Bearer $CRON_SECRET
 *
 * Loads the 10 demo suppliers into a freshly deployed environment, so you can
 * populate a private RDS instance without opening network access to it.
 * No-ops if any supplier already exists. Disabled unless CRON_SECRET is set.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Seeding is disabled because CRON_SECRET is not set" },
      { status: 403 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(suppliers);
  if (count > 0) {
    return NextResponse.json({ seeded: 0, message: `Skipped — ${count} supplier(s) already present.` });
  }

  const rows = buildDemoRows(
    process.env.DEFAULT_PROCUREMENT_MANAGER_EMAIL ?? "procurement.manager@example.com"
  );
  await db.insert(suppliers).values(rows);

  return NextResponse.json({ seeded: rows.length });
}
