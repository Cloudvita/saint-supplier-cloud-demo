/** Demo supplier master used by both the CLI seed and the protected seed endpoint. */
export const DEMO_SUPPLIERS = [
  ["Acme Industrial Supply Inc", "Acme Industrial", "PUBLIC", "ACME", "C_CORPORATION", "MRO & Industrial", "Chicago", "IL", "60601"],
  ["Northwind Logistics LLC", null, "PRIVATE", null, "LLC", "Freight & Logistics", "Seattle", "WA", "98104"],
  ["Bluepeak Software Corp", "Bluepeak", "PUBLIC", "BPK", "C_CORPORATION", "IT Software", "Austin", "TX", "78701"],
  ["Cedar Ridge Facilities Services", null, "PRIVATE", null, "S_CORPORATION", "Facilities", "Denver", "CO", "80202"],
  ["Global Precision Components Ltd", "GPC", "PUBLIC", "GPCL", "C_CORPORATION", "Direct Materials", "Detroit", "MI", "48226"],
  ["Harbor Point Consulting Partners", null, "PRIVATE", null, "PARTNERSHIP", "Professional Services", "Boston", "MA", "02110"],
  ["Vertex Chemical Solutions Inc", null, "PUBLIC", "VRTXC", "C_CORPORATION", "Chemicals", "Houston", "TX", "77002"],
  ["Silverline Packaging Co", "Silverline", "PRIVATE", null, "C_CORPORATION", "Packaging", "Atlanta", "GA", "30303"],
  ["Meridian Staffing Group LLC", null, "PRIVATE", null, "LLC", "Contingent Labour", "Phoenix", "AZ", "85004"],
  ["Orchard Data Centers Inc", "Orchard DC", "PUBLIC", "ORCD", "C_CORPORATION", "IT Infrastructure", "Reston", "VA", "20190"],
] as const;

type CompanyType = "PUBLIC" | "PRIVATE";
type TaxClass =
  | "C_CORPORATION"
  | "S_CORPORATION"
  | "PARTNERSHIP"
  | "LLC"
  | "INDIVIDUAL_SOLE_PROPRIETOR"
  | "TRUST_ESTATE"
  | "OTHER"
  | "UNKNOWN";

export function buildDemoRows(managerEmail: string) {
  return DEMO_SUPPLIERS.map(
    ([legalName, dbaName, companyType, ticker, taxClass, category, city, state, zip], i) => ({
      supplierCode: `SUP-${String(i + 1).padStart(6, "0")}`,
      legalName,
      dbaName: dbaName ?? undefined,
      companyType: companyType as CompanyType,
      tickerSymbol: ticker ?? undefined,
      taxClassification: taxClass as TaxClass,
      taxIdType: "EIN",
      taxId: String(100000000 + i * 7654321).slice(0, 9),
      contactName: "A/P Contact",
      contactEmail: `ap@${legalName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`,
      contactPhone: `+1-555-01${String(i).padStart(2, "0")}`,
      addressLine1: `${100 + i} Commerce Way`,
      city,
      state,
      postalCode: zip,
      country: "USA",
      category,
      paymentTerms: i % 3 === 0 ? "NET45" : "NET30",
      status: (i % 5 === 0 ? "DRAFT" : "ACTIVE") as "DRAFT" | "ACTIVE",
      newsCadence: (i % 2 === 0 ? "WEEKLY" : "MONTHLY") as "WEEKLY" | "MONTHLY",
      diverseSupplier: i % 4 === 0,
      alertsEnabled: true,
      procurementManagerEmail: managerEmail,
    })
  );
}
