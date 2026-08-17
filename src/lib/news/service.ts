import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { marketNewsItems, riskAlerts, suppliers } from "@/db/schema";
import { getNewsProvider } from "./providers";
import { buildDigest, classifyArticle, isAlertable } from "./classifier";
import { sendRiskAlertEmail } from "@/lib/alerts";
import type { ClassifiedArticle } from "./types";

export type RefreshResult = {
  supplierId: string;
  companyName: string;
  provider: string;
  fetched: number;
  stored: number;
  alertsCreated: number;
  digest: string;
  items: ClassifiedArticle[];
};

/**
 * Pull market news for one supplier, classify it, persist articles, refresh the
 * on-screen digest, and raise alerts for M&A / bankruptcy / dispute events.
 */
export async function refreshSupplierNews(supplierId: string): Promise<RefreshResult> {
  const supplier = await db.query.suppliers.findFirst({ where: eq(suppliers.id, supplierId) });
  if (!supplier) throw new Error(`Supplier ${supplierId} not found`);

  const provider = getNewsProvider();
  const raw = await provider.fetchNews({
    companyName: supplier.legalName,
    ticker: supplier.tickerSymbol,
    keywords: supplier.newsKeywords,
    cadence: supplier.newsCadence,
  });

  const classified = raw
    .map(classifyArticle)
    .sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime());

  // --- persist articles (idempotent on supplierId + url) ---
  let stored = 0;
  for (const item of classified) {
    if (!item.url) continue;
    await db
      .insert(marketNewsItems)
      .values({
        supplierId,
        headline: item.headline,
        summary: item.summary,
        url: item.url,
        source: item.source,
        publishedAt: item.publishedAt,
        eventType: item.eventType,
        severity: item.severity,
        score: item.score,
      })
      .onConflictDoUpdate({
        target: [marketNewsItems.supplierId, marketNewsItems.url],
        set: {
          fetchedAt: new Date(),
          eventType: item.eventType,
          severity: item.severity,
          score: item.score,
        },
      });
    stored++;
  }

  // --- digest into the visible text field ---
  const digest = buildDigest(supplier.legalName, classified, supplier.newsCadence);
  await db
    .update(suppliers)
    .set({ marketNews: digest, marketNewsUpdated: new Date() })
    .where(eq(suppliers.id, supplierId));

  // --- alerts ---
  let alertsCreated = 0;
  if (supplier.alertsEnabled) {
    for (const item of classified.filter(isAlertable)) {
      const existing = await db.query.riskAlerts.findFirst({
        where: and(
          eq(riskAlerts.supplierId, supplierId),
          eq(riskAlerts.eventType, item.eventType),
          item.url ? eq(riskAlerts.sourceUrl, item.url) : undefined
        ),
      });
      if (existing) continue;

      const [alert] = await db
        .insert(riskAlerts)
        .values({
          supplierId,
          eventType: item.eventType,
          severity: item.severity,
          title: item.headline,
          detail: item.summary,
          sourceUrl: item.url,
        })
        .returning();
      alertsCreated++;

      const to = supplier.procurementManagerEmail || process.env.DEFAULT_PROCUREMENT_MANAGER_EMAIL;
      if (to) {
        const sent = await sendRiskAlertEmail({
          to,
          supplierName: supplier.legalName,
          supplierCode: supplier.supplierCode,
          eventType: item.eventType,
          severity: item.severity,
          headline: item.headline,
          summary: item.summary,
          url: item.url,
        });
        if (sent) {
          await db
            .update(riskAlerts)
            .set({ status: "NOTIFIED", notifiedTo: to, notifiedAt: new Date() })
            .where(eq(riskAlerts.id, alert.id));
        }
      }
    }
  }

  return {
    supplierId,
    companyName: supplier.legalName,
    provider: provider.name,
    fetched: raw.length,
    stored,
    alertsCreated,
    digest,
    items: classified,
  };
}

/** Batch entry point for the scheduled refresh (EventBridge -> /api/news/refresh). */
export async function refreshDueSuppliers(cadence: "WEEKLY" | "MONTHLY") {
  const due = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.newsCadence, cadence), ne(suppliers.status, "BLOCKED")));

  const results: RefreshResult[] = [];
  for (const s of due) {
    try {
      results.push(await refreshSupplierNews(s.id));
    } catch (e) {
      console.error(`news refresh failed for ${s.id}`, e);
    }
  }
  return results;
}
