CREATE TYPE "public"."alert_status" AS ENUM('NEW', 'NOTIFIED', 'ACKNOWLEDGED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."company_type" AS ENUM('PUBLIC', 'PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('PENDING', 'EXTRACTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."news_cadence" AS ENUM('WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."risk_event_type" AS ENUM('ACQUISITION', 'MERGER', 'BANKRUPTCY', 'DISPUTE', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."risk_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."supplier_status" AS ENUM('DRAFT', 'ACTIVE', 'ON_HOLD', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."tax_classification" AS ENUM('INDIVIDUAL_SOLE_PROPRIETOR', 'C_CORPORATION', 'S_CORPORATION', 'PARTNERSHIP', 'TRUST_ESTATE', 'LLC', 'OTHER', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "market_news_items" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"headline" text NOT NULL,
	"summary" text,
	"url" text NOT NULL,
	"source" varchar(160),
	"published_at" timestamp with time zone NOT NULL,
	"event_type" "risk_event_type" DEFAULT 'NONE' NOT NULL,
	"severity" "risk_severity" DEFAULT 'LOW' NOT NULL,
	"score" double precision DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"event_type" "risk_event_type" NOT NULL,
	"severity" "risk_severity" NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"source_url" text,
	"status" "alert_status" DEFAULT 'NEW' NOT NULL,
	"notified_to" varchar(200),
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_code" varchar(20) NOT NULL,
	"legal_name" varchar(200) NOT NULL,
	"dba_name" varchar(200),
	"company_type" "company_type" DEFAULT 'PRIVATE' NOT NULL,
	"ticker_symbol" varchar(12),
	"tax_classification" "tax_classification" DEFAULT 'UNKNOWN' NOT NULL,
	"tax_id_type" varchar(4),
	"tax_id" varchar(9),
	"contact_name" varchar(120),
	"contact_email" varchar(200),
	"contact_phone" varchar(40),
	"website" varchar(200),
	"address_line1" varchar(200),
	"address_line2" varchar(200),
	"city" varchar(100),
	"state" varchar(60),
	"postal_code" varchar(20),
	"country" varchar(60) DEFAULT 'USA' NOT NULL,
	"category" varchar(120),
	"payment_terms" varchar(30) DEFAULT 'NET30' NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" "supplier_status" DEFAULT 'DRAFT' NOT NULL,
	"diverse_supplier" boolean DEFAULT false NOT NULL,
	"news_cadence" "news_cadence" DEFAULT 'WEEKLY' NOT NULL,
	"market_news" text,
	"market_news_updated" timestamp with time zone,
	"news_keywords" varchar(300),
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"procurement_manager_email" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(120) DEFAULT 'system',
	CONSTRAINT "suppliers_supplier_code_unique" UNIQUE("supplier_code")
);
--> statement-breakpoint
CREATE TABLE "w9_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text,
	"file_name" varchar(300) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"s3_bucket" varchar(200),
	"s3_key" varchar(500),
	"raw_extraction" jsonb,
	"parsed_fields" jsonb,
	"confidence" double precision,
	"extraction_status" "extraction_status" DEFAULT 'PENDING' NOT NULL,
	"extraction_error" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_news_items" ADD CONSTRAINT "market_news_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_alerts" ADD CONSTRAINT "risk_alerts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "w9_documents" ADD CONSTRAINT "w9_documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "news_supplier_url_uq" ON "market_news_items" USING btree ("supplier_id","url");--> statement-breakpoint
CREATE INDEX "news_supplier_published_idx" ON "market_news_items" USING btree ("supplier_id","published_at");--> statement-breakpoint
CREATE INDEX "alerts_supplier_status_idx" ON "risk_alerts" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE INDEX "suppliers_created_at_idx" ON "suppliers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "suppliers_company_type_idx" ON "suppliers" USING btree ("company_type");--> statement-breakpoint
CREATE INDEX "suppliers_status_idx" ON "suppliers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "w9_supplier_idx" ON "w9_documents" USING btree ("supplier_id");