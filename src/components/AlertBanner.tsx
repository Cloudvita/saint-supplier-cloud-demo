"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Alert = {
  id: string;
  eventType: string;
  severity: string;
  title: string;
  sourceUrl: string | null;
  status: string;
  supplier: { legalName: string; supplierCode: string };
};

const STYLE: Record<string, string> = {
  CRITICAL: "bg-red-50 ring-red-200 text-red-900",
  HIGH: "bg-orange-50 ring-orange-200 text-orange-900",
  MEDIUM: "bg-amber-50 ring-amber-200 text-amber-900",
  LOW: "bg-slate-50 ring-slate-200 text-slate-800",
};

export default function AlertBanner({ alerts }: { alerts: Alert[] }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [dismissingAll, setDismissingAll] = useState(false);

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  async function dismiss(id: string) {
    setDismissing(id);
    setDismissed((prev) => new Set(prev).add(id));
    try {
      await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "DISMISSED" }),
      });
      router.refresh();
    } finally {
      setDismissing(null);
    }
  }

  async function dismissAll() {
    setDismissingAll(true);
    const ids = visible.map((a) => a.id);
    setDismissed((prev) => new Set([...prev, ...ids]));
    try {
      await Promise.all(
        ids.map((id) =>
          fetch("/api/alerts", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, status: "DISMISSED" }),
          })
        )
      );
      router.refresh();
    } finally {
      setDismissingAll(false);
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Supplier Risk Alerts ({visible.length})
        </h2>
        <button
          type="button"
          onClick={dismissAll}
          disabled={dismissingAll}
          className="text-xs font-semibold text-slate-500 underline hover:text-slate-800 disabled:opacity-40"
        >
          {dismissingAll ? "Closing…" : "Close all"}
        </button>
      </div>
      {visible.map((a) => (
        <div key={a.id} className={`relative rounded-lg px-4 py-3 pr-10 text-sm ring-1 ${STYLE[a.severity] ?? STYLE.LOW}`}>
          <button
            type="button"
            onClick={() => dismiss(a.id)}
            disabled={dismissing === a.id}
            aria-label="Dismiss alert"
            className="absolute right-2 top-2 rounded-full p-1 text-current opacity-60 hover:opacity-100 disabled:opacity-30"
          >
            ✕
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip bg-white/70 font-bold">{a.eventType}</span>
            <span className="text-xs font-semibold uppercase">{a.severity}</span>
            <span className="font-semibold">
              {a.supplier.legalName} ({a.supplier.supplierCode})
            </span>
            <span className="ml-auto mr-4 text-xs opacity-70">
              {a.status === "NOTIFIED" ? "manager notified" : "pending notification"}
            </span>
          </div>
          <p className="mt-1">{a.title}</p>
          {a.sourceUrl && (
            <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="text-xs underline opacity-80">
              source
            </a>
          )}
        </div>
      ))}
    </section>
  );
}
