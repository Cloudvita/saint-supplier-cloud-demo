import { desc, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { riskAlerts, severityRank, suppliers } from "@/db/schema";
import SupplierTabs from "@/components/SupplierTabs";
import { type SupplierRow } from "@/components/SupplierTable";
import { maskTaxId } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [rows, [{ count }], openAlerts] = await Promise.all([
    // the 10 most recent records shown on screen
    db.query.suppliers.findMany({
      orderBy: [desc(suppliers.createdAt)],
      limit: 10,
      with: {
        riskAlerts: {
          where: inArray(riskAlerts.status, ["NEW", "NOTIFIED"]),
          orderBy: [desc(riskAlerts.createdAt)],
        },
      },
    }),
    db.select({ count: sql<number>`count(*)::int` }).from(suppliers),
    db.query.riskAlerts.findMany({
      where: inArray(riskAlerts.status, ["NEW", "NOTIFIED"]),
      orderBy: [desc(severityRank), desc(riskAlerts.createdAt)],
      limit: 5,
      with: { supplier: { columns: { legalName: true, supplierCode: true } } },
    }),
  ]);

  // Never ship raw tax IDs to the browser — mask on the server, send only the mask.
  const supplierRows: SupplierRow[] = rows.map(({ taxId, taxIdType, ...s }) => ({
    ...JSON.parse(JSON.stringify(s)),
    taxIdMasked: maskTaxId(taxId, taxIdType),
  }));

  return <SupplierTabs alerts={openAlerts} supplierRows={supplierRows} totalCount={count} />;
}
