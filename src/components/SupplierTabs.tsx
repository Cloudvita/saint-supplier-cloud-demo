"use client";

import { useState } from "react";
import SupplierForm from "@/components/SupplierForm";
import SupplierTable, { type SupplierRow } from "@/components/SupplierTable";
import AlertBanner from "@/components/AlertBanner";
import AiGenieBar from "@/components/AiGenieBar";

type Alert = {
  id: string;
  eventType: string;
  severity: string;
  title: string;
  sourceUrl: string | null;
  status: string;
  supplier: { legalName: string; supplierCode: string };
};

type TabKey = "alerts" | "add" | "suppliers" | "genie";

const TABS: { key: TabKey; label: string }[] = [
  { key: "alerts", label: "Risk Alerts" },
  { key: "add", label: "Add Supplier" },
  { key: "suppliers", label: "Suppliers" },
  { key: "genie", label: "AI Genie" },
];

export default function SupplierTabs({
  alerts,
  supplierRows,
  totalCount,
}: {
  alerts: Alert[];
  supplierRows: SupplierRow[];
  totalCount: number;
}) {
  const [active, setActive] = useState<TabKey>("alerts");

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
              active === t.key
                ? "border-saint-600 text-saint-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
            {t.key === "alerts" && alerts.length > 0 && (
              <span className="chip bg-red-100 text-red-700">{alerts.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="pt-6">
        {active === "alerts" && (
          <section>
            {alerts.length === 0 ? (
              <div className="card p-10 text-center text-sm text-slate-500">
                No open risk alerts. Run the AI Genie to scan for the latest news and risk events.
              </div>
            ) : (
              <AlertBanner alerts={alerts} />
            )}
          </section>
        )}

        {active === "add" && (
          <section>
            <h1 className="text-xl font-bold">Supplier Onboarding</h1>
            <p className="mt-1 text-sm text-slate-500">
              Enter supplier details manually, or upload a W-9 and let Amazon Textract pre-fill the form.
            </p>
            <div className="mt-4">
              <SupplierForm />
            </div>
          </section>
        )}

        {active === "suppliers" && (
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Suppliers by Date Added</h2>
              <span className="text-sm text-slate-500">
                Showing {supplierRows.length} of {totalCount} record{totalCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-4">
              <SupplierTable suppliers={supplierRows} />
            </div>
          </section>
        )}

        {active === "genie" && (
          <section>
            <h1 className="text-xl font-bold">AI Genie</h1>
            <p className="mt-1 text-sm text-slate-500">
              Scan every supplier for the latest news and risk events on demand, or set an automatic
              Daily / Weekly cadence for all suppliers.
            </p>
            <div className="mt-4">
              <AiGenieBar />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
