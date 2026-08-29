import { NextResponse } from "next/server";
import { refreshAllSuppliers, refreshDueSuppliers, refreshSupplierNews } from "@/lib/news/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/news/refresh
 *   body { supplierId }            -> refresh one supplier (called from the UI)
 *   body { scanAll: true }         -> "AI Genie" scan of every supplier (called from the UI)
 *   body { cadence: "WEEKLY" }     -> refresh every supplier on that cadence
 *
 * The cadence batch mode is protected by CRON_SECRET so EventBridge / GitHub
 * Actions can call it safely:  Authorization: Bearer $CRON_SECRET
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    supplierId?: string;
    scanAll?: boolean;
    cadence?: "DAILY" | "WEEKLY" | "MONTHLY";
  };

  if (body.supplierId) {
    try {
      const result = await refreshSupplierNews(body.supplierId);
      return NextResponse.json(result);
    } catch (e) {
      console.error(e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Refresh failed" },
        { status: 500 }
      );
    }
  }

  if (body.scanAll) {
    try {
      const results = await refreshAllSuppliers();
      const flagged = results.filter((r) => r.alertsCreated > 0);
      return NextResponse.json({
        suppliersScanned: results.length,
        alertsCreated: results.reduce((s, r) => s + r.alertsCreated, 0),
        flaggedSuppliers: flagged.map((r) => ({ supplierId: r.supplierId, companyName: r.companyName })),
      });
    } catch (e) {
      console.error(e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Scan failed" },
        { status: 500 }
      );
    }
  }

  if (body.cadence) {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.headers.get("authorization");
      if (auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    const results = await refreshDueSuppliers(body.cadence);
    return NextResponse.json({
      cadence: body.cadence,
      suppliersProcessed: results.length,
      alertsCreated: results.reduce((s, r) => s + r.alertsCreated, 0),
    });
  }

  return NextResponse.json({ error: "Provide supplierId or cadence" }, { status: 400 });
}
