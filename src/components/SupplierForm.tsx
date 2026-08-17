"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Fields = Record<string, string | boolean>;

const TAX_CLASSES = [
  ["UNKNOWN", "— Select —"],
  ["INDIVIDUAL_SOLE_PROPRIETOR", "Individual / Sole proprietor"],
  ["C_CORPORATION", "C Corporation"],
  ["S_CORPORATION", "S Corporation"],
  ["PARTNERSHIP", "Partnership"],
  ["TRUST_ESTATE", "Trust / Estate"],
  ["LLC", "Limited Liability Company"],
  ["OTHER", "Other"],
] as const;

const EMPTY: Fields = {
  legalName: "",
  dbaName: "",
  companyType: "PRIVATE",
  tickerSymbol: "",
  taxClassification: "UNKNOWN",
  taxIdType: "EIN",
  taxId: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  website: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "USA",
  category: "",
  paymentTerms: "NET30",
  currency: "USD",
  status: "ACTIVE",
  diverseSupplier: false,
  newsCadence: "WEEKLY",
  marketNews: "",
  newsKeywords: "",
  alertsEnabled: true,
  procurementManagerEmail: "",
};

export default function SupplierForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [f, setF] = useState<Fields>(EMPTY);
  const [w9DocumentId, setW9DocumentId] = useState<string | null>(null);
  const [w9Info, setW9Info] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [pullingNews, setPullingNews] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [riskPreview, setRiskPreview] = useState<
    Array<{ eventType: string; severity: string; headline: string }>
  >([]);

  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  /* ---------------- W-9 upload + Textract ---------------- */
  async function handleW9(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setW9Info(null);
    setFlash(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/w9/extract", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) {
        setFlash({ kind: "err", msg: data.error ?? "W-9 extraction failed" });
        return;
      }

      setW9DocumentId(data.documentId);
      const fields = (data.fields ?? {}) as Record<string, string>;
      const applied: string[] = [];

      for (const [k, v] of Object.entries(fields)) {
        if (v && k in EMPTY) {
          set(k, v);
          applied.push(k);
        }
      }
      setW9Info(
        applied.length
          ? `Extracted ${applied.length} field(s) — confidence ${data.confidence}%. Review before saving.`
          : `No fields matched. ${data.pairsFound ?? 0} key/value pairs found — enter details manually.`
      );
    } catch {
      setFlash({ kind: "err", msg: "Upload failed — check the network and try again." });
    } finally {
      setExtracting(false);
    }
  }

  /* ---------------- Market news pull ---------------- */
  async function pullNews() {
    const name = String(f.legalName || "").trim();
    if (!name) {
      setFlash({ kind: "err", msg: "Enter the supplier legal name first." });
      return;
    }
    setPullingNews(true);
    setRiskPreview([]);
    try {
      const res = await fetch("/api/news/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: name,
          ticker: f.tickerSymbol,
          keywords: f.newsKeywords,
          cadence: f.newsCadence,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFlash({ kind: "err", msg: data.error ?? "News fetch failed" });
        return;
      }
      set("marketNews", data.digest);
      setRiskPreview(data.riskEvents ?? []);
    } finally {
      setPullingNews(false);
    }
  }

  /* ---------------- Save ---------------- */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFlash(null);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, w9DocumentId }),
      });
      const data = await res.json();

      if (res.status === 422) {
        setErrors(data.details ?? {});
        setFlash({ kind: "err", msg: "Please fix the highlighted fields." });
        return;
      }
      if (!res.ok) {
        setFlash({ kind: "err", msg: data.error ?? "Save failed" });
        return;
      }

      setFlash({ kind: "ok", msg: `Saved ${data.supplier.supplierCode} — ${data.supplier.legalName}` });
      setF(EMPTY);
      setW9DocumentId(null);
      setW9Info(null);
      setRiskPreview([]);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const err = (k: string) =>
    errors[k]?.length ? <p className="mt-1 text-xs text-red-600">{errors[k][0]}</p> : null;

  return (
    <form onSubmit={submit} className="card p-6">
      {flash && (
        <div
          className={`mb-5 rounded-md px-4 py-3 text-sm ${
            flash.kind === "ok"
              ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
              : "bg-red-50 text-red-800 ring-1 ring-red-200"
          }`}
        >
          {flash.msg}
        </div>
      )}

      {/* ---------- W-9 upload ---------- */}
      <fieldset className="mb-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
        <legend className="px-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          W-9 Upload (optional)
        </legend>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
            onChange={handleW9}
            disabled={extracting}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-saint-600 file:px-3 file:py-2
                       file:text-sm file:font-semibold file:text-white hover:file:bg-saint-700"
          />
          {extracting && <span className="text-sm text-slate-500">Extracting with Textract…</span>}
        </div>
        {w9Info && <p className="mt-2 text-sm text-emerald-700">{w9Info}</p>}
      </fieldset>

      {/* ---------- Identity ---------- */}
      <h3 className="mb-3 text-sm font-bold text-slate-700">Company Identity</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="label">Legal Name *</label>
          <input
            className="input"
            value={String(f.legalName)}
            onChange={(e) => set("legalName", e.target.value)}
            placeholder="As shown on the W-9, line 1"
            required
          />
          {err("legalName")}
        </div>

        <div>
          <label className="label">DBA / Business Name</label>
          <input
            className="input"
            value={String(f.dbaName)}
            onChange={(e) => set("dbaName", e.target.value)}
          />
        </div>

        <div>
          <label className="label">Federal Tax Classification</label>
          <select
            className="input"
            value={String(f.taxClassification)}
            onChange={(e) => set("taxClassification", e.target.value)}
          >
            {TAX_CLASSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {/* Public / Private */}
        <div className="md:col-span-2">
          <label className="label">Company Type *</label>
          <div className="flex gap-3">
            {(["PUBLIC", "PRIVATE"] as const).map((t) => (
              <label
                key={t}
                className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border px-4 py-3 text-sm transition ${
                  f.companyType === t
                    ? "border-saint-500 bg-saint-50 font-semibold text-saint-700 ring-2 ring-saint-100"
                    : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="companyType"
                  value={t}
                  checked={f.companyType === t}
                  onChange={(e) => set("companyType", e.target.value)}
                  className="accent-saint-600"
                />
                {t === "PUBLIC" ? "Public company (listed)" : "Private company"}
              </label>
            ))}
          </div>
        </div>

        {f.companyType === "PUBLIC" && (
          <div>
            <label className="label">Ticker Symbol</label>
            <input
              className="input uppercase"
              value={String(f.tickerSymbol)}
              onChange={(e) => set("tickerSymbol", e.target.value.toUpperCase())}
              placeholder="e.g. ACME"
            />
            {err("tickerSymbol")}
          </div>
        )}

        <div>
          <label className="label">Tax ID Type</label>
          <select
            className="input"
            value={String(f.taxIdType)}
            onChange={(e) => set("taxIdType", e.target.value)}
          >
            <option value="EIN">EIN</option>
            <option value="SSN">SSN</option>
          </select>
        </div>

        <div>
          <label className="label">Tax ID (9 digits)</label>
          <input
            className="input"
            value={String(f.taxId)}
            onChange={(e) => set("taxId", e.target.value)}
            placeholder="12-3456789"
          />
          {err("taxId")}
        </div>
      </div>

      {/* ---------- Contact & address ---------- */}
      <h3 className="mb-3 mt-7 text-sm font-bold text-slate-700">Contact &amp; Address</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="label">Contact Name</label>
          <input className="input" value={String(f.contactName)} onChange={(e) => set("contactName", e.target.value)} />
        </div>
        <div>
          <label className="label">Contact Email</label>
          <input className="input" type="email" value={String(f.contactEmail)} onChange={(e) => set("contactEmail", e.target.value)} />
          {err("contactEmail")}
        </div>
        <div>
          <label className="label">Contact Phone</label>
          <input className="input" value={String(f.contactPhone)} onChange={(e) => set("contactPhone", e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="label">Address Line 1</label>
          <input className="input" value={String(f.addressLine1)} onChange={(e) => set("addressLine1", e.target.value)} />
        </div>
        <div>
          <label className="label">Address Line 2</label>
          <input className="input" value={String(f.addressLine2)} onChange={(e) => set("addressLine2", e.target.value)} />
        </div>
        <div>
          <label className="label">City</label>
          <input className="input" value={String(f.city)} onChange={(e) => set("city", e.target.value)} />
        </div>
        <div>
          <label className="label">State</label>
          <input className="input" value={String(f.state)} onChange={(e) => set("state", e.target.value)} />
        </div>
        <div>
          <label className="label">ZIP / Postal Code</label>
          <input className="input" value={String(f.postalCode)} onChange={(e) => set("postalCode", e.target.value)} />
        </div>
      </div>

      {/* ---------- Procurement ---------- */}
      <h3 className="mb-3 mt-7 text-sm font-bold text-slate-700">Procurement Attributes</h3>
      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <label className="label">Category</label>
          <input className="input" value={String(f.category)} onChange={(e) => set("category", e.target.value)} placeholder="IT Hardware" />
        </div>
        <div>
          <label className="label">Payment Terms</label>
          <select className="input" value={String(f.paymentTerms)} onChange={(e) => set("paymentTerms", e.target.value)}>
            {["NET15", "NET30", "NET45", "NET60", "NET90", "DUE_ON_RECEIPT"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Currency</label>
          <select className="input" value={String(f.currency)} onChange={(e) => set("currency", e.target.value)}>
            {["USD", "EUR", "GBP", "INR", "CAD", "AUD"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={String(f.status)} onChange={(e) => set("status", e.target.value)}>
            {["DRAFT", "ACTIVE", "ON_HOLD", "BLOCKED"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ---------- Market intelligence ---------- */}
      <h3 className="mb-3 mt-7 text-sm font-bold text-slate-700">Market Intelligence &amp; Risk Alerts</h3>
      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <label className="label">News Cadence</label>
          <select className="input" value={String(f.newsCadence)} onChange={(e) => set("newsCadence", e.target.value)}>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </div>
        <div className="md:col-span-3">
          <label className="label">Extra Search Keywords</label>
          <input
            className="input"
            value={String(f.newsKeywords)}
            onChange={(e) => set("newsKeywords", e.target.value)}
            placeholder="subsidiary names, brands, former names…"
          />
        </div>

        <div className="md:col-span-4">
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">Market News</label>
            <button type="button" onClick={pullNews} disabled={pullingNews} className="btn-ghost !py-1 !text-xs">
              {pullingNews ? "Pulling…" : `Pull ${String(f.newsCadence).toLowerCase()} news`}
            </button>
          </div>
          <textarea
            className="input h-40 font-mono text-xs leading-relaxed"
            value={String(f.marketNews)}
            onChange={(e) => set("marketNews", e.target.value)}
            placeholder="Click 'Pull news' to populate the latest market brief for this company, or type notes manually."
          />
        </div>

        {riskPreview.length > 0 && (
          <div className="md:col-span-4 rounded-md bg-amber-50 p-3 ring-1 ring-amber-200">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
              {riskPreview.length} risk event(s) detected
            </p>
            <ul className="mt-2 space-y-1">
              {riskPreview.map((r, i) => (
                <li key={i} className="text-sm text-amber-900">
                  <span className="chip bg-amber-200 text-amber-900">{r.eventType}</span>{" "}
                  <span className="font-medium">{r.severity}</span> — {r.headline}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-amber-700">
              These will be raised as alerts to the procurement manager once the supplier is saved and news is refreshed.
            </p>
          </div>
        )}

        <div className="md:col-span-2">
          <label className="label">Procurement Manager Email (alert recipient)</label>
          <input
            className="input"
            type="email"
            value={String(f.procurementManagerEmail)}
            onChange={(e) => set("procurementManagerEmail", e.target.value)}
            placeholder="manager@company.com"
          />
          {err("procurementManagerEmail")}
        </div>
        <div className="flex items-end gap-6 md:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-saint-600"
              checked={Boolean(f.alertsEnabled)}
              onChange={(e) => set("alertsEnabled", e.target.checked)}
            />
            Alert on merger / acquisition / bankruptcy / dispute
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-saint-600"
              checked={Boolean(f.diverseSupplier)}
              onChange={(e) => set("diverseSupplier", e.target.checked)}
            />
            Diverse supplier
          </label>
        </div>
      </div>

      <div className="mt-7 flex items-center gap-3 border-t border-slate-200 pt-5">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save Supplier"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setF(EMPTY);
            setW9DocumentId(null);
            setW9Info(null);
            setRiskPreview([]);
            setErrors({});
            if (fileRef.current) fileRef.current.value = "";
          }}
        >
          Reset
        </button>
        {w9DocumentId && <span className="text-xs text-slate-500">W-9 attached ✓</span>}
      </div>
    </form>
  );
}
