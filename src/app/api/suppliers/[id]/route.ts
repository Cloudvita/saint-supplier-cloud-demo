import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { marketNewsItems, riskAlerts, suppliers, w9Documents } from "@/db/schema";
import { maskTaxId, supplierSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const supplier = await db.query.suppliers.findFirst({
    where: eq(suppliers.id, id),
    with: {
      w9Documents: { orderBy: [desc(w9Documents.uploadedAt)] },
      newsItems: { orderBy: [desc(marketNewsItems.publishedAt)], limit: 25 },
      riskAlerts: { orderBy: [desc(riskAlerts.createdAt)], limit: 25 },
    },
  });
  if (!supplier) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { taxId, taxIdType, ...rest } = supplier;
  return NextResponse.json({
    supplier: { ...rest, taxIdMasked: maskTaxId(taxId, taxIdType) },
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = supplierSchema.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }
  const { w9DocumentId: _ignored, ...data } = parsed.data;

  const [supplier] = await db.update(suppliers).set(data).where(eq(suppliers.id, id)).returning();
  if (!supplier) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ supplier });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await db.delete(suppliers).where(eq(suppliers.id, id));
  return NextResponse.json({ ok: true });
}
