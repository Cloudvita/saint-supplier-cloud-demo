"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ScanResult = {
  suppliersScanned: number;
  alertsCreated: number;
  flaggedSuppliers: { supplierId: string; companyName: string }[];
};

type Cadence = "DAILY" | "WEEKLY";

export default function AiGenieBar() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [currentCadence, setCurrentCadence] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<Cadence | null>(null);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/scan-schedule")
      .then((r) => r.json())
      .then((d) => setCurrentCadence(d.cadence))
      .catch(() => {});
  }, []);

  async function scanAll() {
    setScanning(true);
    setScanMessage(null);
    try {
      const res = await fetch("/api/news/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanAll: true }),
      });
      const data: ScanResult = await res.json();
      if (!res.ok) throw new Error((data as unknown as { error?: string }).error ?? "Scan failed");

      setScanMessage(
        data.flaggedSuppliers.length > 0
          ? `Scanned ${data.suppliersScanned} suppliers — risk found for ${data.flaggedSuppliers
              .map((f) => f.companyName)
              .join(", ")}.`
          : `Scanned ${data.suppliersScanned} suppliers — no risk events found.`
      );
      router.refresh();
    } catch (e) {
      setScanMessage(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function setSchedule(cadence: Cadence) {
    setScheduling(cadence);
    setScheduleMessage(null);
    try {
      const res = await fetch("/api/settings/scan-schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadence }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not set schedule");
      setCurrentCadence(cadence);
      setScheduleMessage(`All suppliers now scan ${cadence === "DAILY" ? "daily" : "weekly"}.`);
      router.refresh();
    } catch (e) {
      setScheduleMessage(e instanceof Error ? e.message : "Could not set schedule");
    } finally {
      setScheduling(null);
    }
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={scanAll}
        disabled={scanning}
        className="btn-primary !px-3 !py-1.5 !text-xs"
        title="Scan every supplier for the latest news and risk events"
      >
        <span className="text-base leading-none">🧞</span>
        {scanning ? "Scanning…" : "AI Genie"}
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setScheduleOpen((o) => !o)}
          className="btn-ghost !px-3 !py-1.5 !text-xs"
          title="Set how often the AI Genie automatically scans every supplier"
        >
          <span className="text-base leading-none">⏰</span>
          Schedule AI Genie Check
        </button>

        {scheduleOpen && (
          <div className="absolute right-0 top-full z-10 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Automatic scan cadence
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Current: {currentCadence ? currentCadence.charAt(0) + currentCadence.slice(1).toLowerCase() : "mixed / not set"}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setSchedule("DAILY")}
                disabled={scheduling !== null}
                className="btn-ghost flex-1 !py-1 !text-xs"
              >
                {scheduling === "DAILY" ? "Setting…" : "Daily"}
              </button>
              <button
                type="button"
                onClick={() => setSchedule("WEEKLY")}
                disabled={scheduling !== null}
                className="btn-ghost flex-1 !py-1 !text-xs"
              >
                {scheduling === "WEEKLY" ? "Setting…" : "Weekly"}
              </button>
            </div>
            {scheduleMessage && (
              <p className="mt-2 flex items-start justify-between gap-2 text-xs text-slate-600">
                <span>{scheduleMessage}</span>
                <button
                  type="button"
                  onClick={() => setScheduleMessage(null)}
                  aria-label="Dismiss"
                  className="shrink-0 text-slate-400 hover:text-slate-700"
                >
                  ✕
                </button>
              </p>
            )}
          </div>
        )}
      </div>

      {scanMessage && (
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {scanMessage}
          <button
            type="button"
            onClick={() => setScanMessage(null)}
            aria-label="Dismiss"
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </span>
      )}
    </div>
  );
}
