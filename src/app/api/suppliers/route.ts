import { NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { riskAlerts, suppliers, w9Documents } from "@/db/schema";
import { maskTaxId, supplierSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** GET /api/suppliers?limit=10&q=&companyType= — most recent first */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 10) || 10, 100);
  const q = searchParams.get("q")?.trim();
  const companyType = searchParams.get("companyType");

  const filters = [];
  if (q) {
    filters.push(
      or(
        ilike(suppliers.legalName, `%${q}%`),
        ilike(suppliers.dbaName, `%${q}%`),
        ilike(suppliers.supplierCode, `%${q}%`),
        ilike(suppliers.category, `%${q}%`)
      )
    );
  }
  if (companyType === "PUBLIC" || companyType === "PRIVATE") {
    filters.push(eq(suppliers.companyType, companyType));
  }
  const where = filters.length ? and(...filters) : undefined;

  const rows = await db.query.suppliers.findMany({
    where,
    orderBy: [desc(suppliers.createdAt)],
    limit,
    with: {
      riskAlerts: {
        where: inArray(riskAlerts.status, ["NEW", "NOTIFIED"]),
        orderBy: [desc(riskAlerts.createdAt)],
      },
    },
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(suppliers)
    .where(where ?? sql`true`);

  // Raw tax IDs stay server-side; the API exposes only the masked form.
  const masked = rows.map(({ taxId, taxIdType, ...s }) => ({
    ...s,
    taxIdMasked: maskTaxId(taxId, taxIdType),
  }));

  return NextResponse.json({ suppliers: masked, total: count, limit });
}

/** POST /api/suppliers — manual supplier entry */
export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = supplierSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }
  const { w9DocumentId, ...data } = parsed.data;

  // Ticker only means something for listed companies
  if (data.companyType === "PRIVATE") data.tickerSymbol = undefined;

  try {
    const supplier = await db.transaction(async (tx) => {
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(suppliers);
      const supplierCode = `SUP-${String(count + 1).padStart(6, "0")}`;

      const [created] = await tx
        .insert(suppliers)
        .values({ ...data, supplierCode })
        .returning();

      if (w9DocumentId) {
        await tx
          .update(w9Documents)
          .set({ supplierId: created.id })
          .where(and(eq(w9Documents.id, w9DocumentId), sql`${w9Documents.supplierId} is null`));
      }
      return created;
    });

    const { taxId, taxIdType, ...rest } = supplier;
    return NextResponse.json(
      { supplier: { ...rest, taxIdMasked: maskTaxId(taxId, taxIdType) } },
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create supplier";
    if (/duplicate key|unique/i.test(msg)) {
      return NextResponse.json({ error: "Supplier code collision, please retry" }, { status: 409 });
    }
    console.error(e);
    return NextResponse.json({ error: "Failed to create supplier" }, { status: 500 });
  }
}
