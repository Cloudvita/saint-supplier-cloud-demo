import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";

export const dynamic = "force-dynamic";

const CADENCES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
type Cadence = (typeof CADENCES)[number];

/**
 * GET /api/settings/scan-schedule
 * Reports the AI Genie scan cadence. Reuses the existing per-supplier
 * `newsCadence` column — `cadence` is non-null only when every supplier
 * currently shares the same one.
 */
export async function GET() {
  const rows = await db
    .select({ cadence: suppliers.newsCadence, count: sql<number>`count(*)::int` })
    .from(suppliers)
    .groupBy(suppliers.newsCadence);

  const totalSuppliers = rows.reduce((s, r) => s + r.count, 0);
  const cadence: Cadence | null = rows.length === 1 ? rows[0].cadence : null;

  return NextResponse.json({ cadence, totalSuppliers, breakdown: rows });
}

/**
 * PUT /api/settings/scan-schedule  { cadence: "DAILY" | "WEEKLY" | "MONTHLY" }
 * Sets every supplier's news cadence at once, so the existing scheduled batch
 * job (POST /api/news/refresh {cadence}, wired to EventBridge / a cron —
 * see docs/DEPLOYMENT.md) picks all of them up on the chosen interval.
 */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { cadence?: string };
  if (!CADENCES.includes(body.cadence as Cadence)) {
    return NextResponse.json({ error: "cadence must be DAILY, WEEKLY, or MONTHLY" }, { status: 400 });
  }
  const cadence = body.cadence as Cadence;
  await db.update(suppliers).set({ newsCadence: cadence });
  return NextResponse.json({ cadence });
}
