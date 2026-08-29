import { desc, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { riskAlerts, severityRank, suppliers } from "@/db/schema";
import SupplierForm from "@/components/SupplierForm";
import SupplierTable, { type SupplierRow } from "@/components/SupplierTable";
import AlertBanner from "@/components/AlertBanner";
import AiGenieBar from "@/components/AiGenieBar";
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

  return (
    <div className="space-y-8">
      <AlertBanner alerts={openAlerts} />

      <section>
        <h1 className="text-xl font-bold">Supplier Onboarding</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter supplier details manually, or upload a W-9 and let Amazon Textract pre-fill the form.
        </p>
        <div className="mt-4">
          <SupplierForm />
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-bold">Recent Suppliers</h2>
            <AiGenieBar />
          </div>
          <span className="text-sm text-slate-500">
            Showing {supplierRows.length} of {count} record{count === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-4">
          <SupplierTable suppliers={supplierRows} />
        </div>
      </section>
    </div>
  );
}
