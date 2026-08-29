"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";

type Alert = { id: string; eventType: string; severity: string; title: string };

export type SupplierRow = {
  id: string;
  supplierCode: string;
  legalName: string;
  dbaName: string | null;
  companyType: "PUBLIC" | "PRIVATE";
  tickerSymbol: string | null;
  /** Pre-masked on the server — the raw tax ID never reaches the browser. */
  taxIdMasked: string;
  category: string | null;
  status: string;
  city: string | null;
  state: string | null;
  newsCadence: string;
  marketNews: string | null;
  marketNewsUpdated: string | null;
  createdAt: string;
  riskAlerts: Alert[];
};

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800",
  HIGH: "bg-orange-100 text-orange-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-slate-100 text-slate-700",
};

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  DRAFT: "bg-slate-100 text-slate-700",
  ON_HOLD: "bg-amber-100 text-amber-800",
  BLOCKED: "bg-red-100 text-red-800",
};

export default function SupplierTable({ suppliers }: { suppliers: SupplierRow[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function refreshNews(id: string) {
    setBusy(id);
    try {
      await fetch("/api/news/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId: id }),
      });
      router.refresh();
      setExpanded(id);
    } finally {
      setBusy(null);
    }
  }

  if (suppliers.length === 0) {
    return (
      <div className="card p-10 text-center text-sm text-slate-500">
        No suppliers yet. Add one above, or run <code className="rounded bg-slate-100 px-1">npm run db:seed</code>.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Code</th>
              <th className="px-4 py-3 font-semibold">Supplier</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Tax ID</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Location</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Risk</th>
              <th className="px-4 py-3 font-semibold">News</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {suppliers.map((s) => (
              <Fragment key={s.id}>
                <tr
                  className={`hover:bg-slate-50/70 ${
                    s.riskAlerts.length > 0 ? "bg-red-50/70" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{s.supplierCode}</td>
                  <td className="px-4 py-3">
                    <button
                      className="text-left font-semibold text-saint-700 hover:underline"
                      onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                    >
                      {s.legalName}
                    </button>
                    {s.dbaName && <div className="text-xs text-slate-500">dba {s.dbaName}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`chip ${
                        s.companyType === "PUBLIC"
                          ? "bg-saint-100 text-saint-700"
                          : "bg-violet-100 text-violet-700"
                      }`}
                    >
                      {s.companyType}
                    </span>
                    {s.tickerSymbol && (
                      <span className="ml-1 font-mono text-xs text-slate-500">{s.tickerSymbol}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.taxIdMasked}</td>
                  <td className="px-4 py-3 text-slate-600">{s.category ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {[s.city, s.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`chip ${STATUS_STYLE[s.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {s.riskAlerts.length === 0 ? (
                      <span className="text-xs text-slate-400">clear</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {s.riskAlerts.slice(0, 2).map((a) => (
                          <span
                            key={a.id}
                            title={a.title}
                            className={`chip ${SEVERITY_STYLE[a.severity] ?? "bg-slate-100"}`}
                          >
                            {a.eventType}
                          </span>
                        ))}
                        {s.riskAlerts.length > 2 && (
                          <span className="chip bg-slate-100 text-slate-600">
                            +{s.riskAlerts.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="btn-ghost !px-2 !py-1 !text-xs"
                      onClick={() => refreshNews(s.id)}
                      disabled={busy === s.id}
                    >
                      {busy === s.id ? "…" : "Refresh"}
                    </button>
                  </td>
                </tr>

                {expanded === s.id && (
                  <tr className="bg-slate-50/60">
                    <td colSpan={9} className="px-4 py-4">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="md:col-span-2">
                          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                            Market News ({s.newsCadence.toLowerCase()})
                            {s.marketNewsUpdated && (
                              <span className="ml-2 font-normal normal-case text-slate-400">
                                updated {new Date(s.marketNewsUpdated).toLocaleString()}
                              </span>
                            )}
                          </div>
                          <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-700">
                            {s.marketNews || "No news pulled yet — click Refresh."}
                          </pre>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                            Open Risk Alerts
                          </div>
                          {s.riskAlerts.length === 0 ? (
                            <p className="text-sm text-slate-500">None.</p>
                          ) : (
                            <ul className="space-y-2">
                              {s.riskAlerts.map((a) => (
                                <li key={a.id} className="rounded-md border border-slate-200 bg-white p-2">
                                  <span className={`chip ${SEVERITY_STYLE[a.severity]}`}>
                                    {a.eventType} · {a.severity}
                                  </span>
                                  <p className="mt-1 text-xs text-slate-700">{a.title}</p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
