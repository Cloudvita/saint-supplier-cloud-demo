import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { riskAlerts, severityRank } from "@/db/schema";

export const dynamic = "force-dynamic";

const STATUSES = ["NEW", "NOTIFIED", "ACKNOWLEDGED", "DISMISSED"] as const;
type Status = (typeof STATUSES)[number];

/** GET /api/alerts?status=NEW&limit=20 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = Math.min(Number(searchParams.get("limit") ?? 20) || 20, 100);

  const where =
    status && (STATUSES as readonly string[]).includes(status)
      ? eq(riskAlerts.status, status as Status)
      : inArray(riskAlerts.status, ["NEW", "NOTIFIED"]);

  const alerts = await db.query.riskAlerts.findMany({
    where,
    orderBy: [desc(severityRank), desc(riskAlerts.createdAt)],
    limit,
    with: {
      supplier: { columns: { id: true, legalName: true, supplierCode: true } },
    },
  });

  return NextResponse.json({ alerts });
}

/** PATCH /api/alerts  body { id, status } */
export async function PATCH(req: Request) {
  const { id, status } = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
  if (!id || !status || !(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
  }
  const [alert] = await db
    .update(riskAlerts)
    .set({ status: status as Status })
    .where(eq(riskAlerts.id, id))
    .returning();
  if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ alert });
}
