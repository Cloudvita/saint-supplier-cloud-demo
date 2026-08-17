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
  if (!alerts?.length) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
        Supplier Risk Alerts ({alerts.length})
      </h2>
      {alerts.map((a) => (
        <div key={a.id} className={`rounded-lg px-4 py-3 text-sm ring-1 ${STYLE[a.severity] ?? STYLE.LOW}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip bg-white/70 font-bold">{a.eventType}</span>
            <span className="text-xs font-semibold uppercase">{a.severity}</span>
            <span className="font-semibold">
              {a.supplier.legalName} ({a.supplier.supplierCode})
            </span>
            <span className="ml-auto text-xs opacity-70">
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
