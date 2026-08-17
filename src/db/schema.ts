import {
  pgTable,
  pgEnum,
  text,
  varchar,
  boolean,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createId } from "@/lib/id";

/* ----------------------------- enums ----------------------------- */

export const companyTypeEnum = pgEnum("company_type", ["PUBLIC", "PRIVATE"]);
export const supplierStatusEnum = pgEnum("supplier_status", ["DRAFT", "ACTIVE", "ON_HOLD", "BLOCKED"]);
export const taxClassificationEnum = pgEnum("tax_classification", [
  "INDIVIDUAL_SOLE_PROPRIETOR",
  "C_CORPORATION",
  "S_CORPORATION",
  "PARTNERSHIP",
  "TRUST_ESTATE",
  "LLC",
  "OTHER",
  "UNKNOWN",
]);
export const newsCadenceEnum = pgEnum("news_cadence", ["WEEKLY", "MONTHLY"]);
export const riskEventTypeEnum = pgEnum("risk_event_type", [
  "ACQUISITION",
  "MERGER",
  "BANKRUPTCY",
  "DISPUTE",
  "NONE",
]);
export const riskSeverityEnum = pgEnum("risk_severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const alertStatusEnum = pgEnum("alert_status", ["NEW", "NOTIFIED", "ACKNOWLEDGED", "DISMISSED"]);
export const extractionStatusEnum = pgEnum("extraction_status", ["PENDING", "EXTRACTED", "FAILED"]);

/* --------------------------- suppliers --------------------------- */

export const suppliers = pgTable(
  "suppliers",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    supplierCode: varchar("supplier_code", { length: 20 }).notNull().unique(),

    // identity
    legalName: varchar("legal_name", { length: 200 }).notNull(), // W-9 line 1
    dbaName: varchar("dba_name", { length: 200 }), // W-9 line 2
    companyType: companyTypeEnum("company_type").notNull().default("PRIVATE"),
    tickerSymbol: varchar("ticker_symbol", { length: 12 }),
    taxClassification: taxClassificationEnum("tax_classification").notNull().default("UNKNOWN"),

    // tax ids — encrypted at rest by RDS/KMS, masked in the UI
    taxIdType: varchar("tax_id_type", { length: 4 }),
    taxId: varchar("tax_id", { length: 9 }),

    // contact
    contactName: varchar("contact_name", { length: 120 }),
    contactEmail: varchar("contact_email", { length: 200 }),
    contactPhone: varchar("contact_phone", { length: 40 }),
    website: varchar("website", { length: 200 }),

    // address
    addressLine1: varchar("address_line1", { length: 200 }),
    addressLine2: varchar("address_line2", { length: 200 }),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 60 }),
    postalCode: varchar("postal_code", { length: 20 }),
    country: varchar("country", { length: 60 }).notNull().default("USA"),

    // procurement attributes
    category: varchar("category", { length: 120 }),
    paymentTerms: varchar("payment_terms", { length: 30 }).notNull().default("NET30"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    status: supplierStatusEnum("status").notNull().default("DRAFT"),
    diverseSupplier: boolean("diverse_supplier").notNull().default(false),

    // market news
    newsCadence: newsCadenceEnum("news_cadence").notNull().default("WEEKLY"),
    marketNews: text("market_news"),
    marketNewsUpdated: timestamp("market_news_updated", { withTimezone: true }),
    newsKeywords: varchar("news_keywords", { length: 300 }),

    // alerting
    alertsEnabled: boolean("alerts_enabled").notNull().default(true),
    procurementManagerEmail: varchar("procurement_manager_email", { length: 200 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdBy: varchar("created_by", { length: 120 }).default("system"),
  },
  (t) => [
    index("suppliers_created_at_idx").on(t.createdAt),
    index("suppliers_company_type_idx").on(t.companyType),
    index("suppliers_status_idx").on(t.status),
  ]
);

/* ------------------------- w9 documents -------------------------- */

export const w9Documents = pgTable(
  "w9_documents",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    supplierId: text("supplier_id").references(() => suppliers.id, { onDelete: "cascade" }),

    fileName: varchar("file_name", { length: 300 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    s3Bucket: varchar("s3_bucket", { length: 200 }),
    s3Key: varchar("s3_key", { length: 500 }),

    rawExtraction: jsonb("raw_extraction"),
    parsedFields: jsonb("parsed_fields"),
    confidence: doublePrecision("confidence"),
    extractionStatus: extractionStatusEnum("extraction_status").notNull().default("PENDING"),
    extractionError: text("extraction_error"),

    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("w9_supplier_idx").on(t.supplierId)]
);

/* ------------------------ market news ---------------------------- */

export const marketNewsItems = pgTable(
  "market_news_items",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),

    headline: text("headline").notNull(),
    summary: text("summary"),
    url: text("url").notNull(),
    source: varchar("source", { length: 160 }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    eventType: riskEventTypeEnum("event_type").notNull().default("NONE"),
    severity: riskSeverityEnum("severity").notNull().default("LOW"),
    score: doublePrecision("score").notNull().default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("news_supplier_url_uq").on(t.supplierId, t.url),
    index("news_supplier_published_idx").on(t.supplierId, t.publishedAt),
  ]
);

/* -------------------------- risk alerts -------------------------- */

export const riskAlerts = pgTable(
  "risk_alerts",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),

    eventType: riskEventTypeEnum("event_type").notNull(),
    severity: riskSeverityEnum("severity").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    sourceUrl: text("source_url"),
    status: alertStatusEnum("status").notNull().default("NEW"),
    notifiedTo: varchar("notified_to", { length: 200 }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alerts_supplier_status_idx").on(t.supplierId, t.status)]
);

/* --------------------------- relations --------------------------- */

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  w9Documents: many(w9Documents),
  newsItems: many(marketNewsItems),
  riskAlerts: many(riskAlerts),
}));

export const w9DocumentsRelations = relations(w9Documents, ({ one }) => ({
  supplier: one(suppliers, { fields: [w9Documents.supplierId], references: [suppliers.id] }),
}));

export const marketNewsItemsRelations = relations(marketNewsItems, ({ one }) => ({
  supplier: one(suppliers, { fields: [marketNewsItems.supplierId], references: [suppliers.id] }),
}));

export const riskAlertsRelations = relations(riskAlerts, ({ one }) => ({
  supplier: one(suppliers, { fields: [riskAlerts.supplierId], references: [suppliers.id] }),
}));

/* ---------------------------- types ------------------------------ */

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type W9Document = typeof w9Documents.$inferSelect;
export type MarketNewsItem = typeof marketNewsItems.$inferSelect;
export type RiskAlert = typeof riskAlerts.$inferSelect;

/** Severity ordering helper for `ORDER BY` on the enum. */
export const severityRank = sql`CASE ${riskAlerts.severity}
  WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END`;
