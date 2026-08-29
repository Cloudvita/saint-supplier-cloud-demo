export type RiskEventType = "ACQUISITION" | "MERGER" | "BANKRUPTCY" | "DISPUTE" | "NONE";
export type RiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RawArticle = {
  headline: string;
  summary?: string;
  url?: string;
  source?: string;
  publishedAt: Date;
};

export type ClassifiedArticle = RawArticle & {
  eventType: RiskEventType;
  severity: RiskSeverity;
  score: number;
};

export type NewsQuery = {
  companyName: string;
  ticker?: string | null;
  keywords?: string | null;
  /** DAILY -> last 1 day, WEEKLY -> last 7 days, MONTHLY -> last 30 days */
  cadence: "DAILY" | "WEEKLY" | "MONTHLY";
};

/**
 * Swap providers by setting NEWS_PROVIDER. Every provider only has to
 * return RawArticle[]; classification and alerting are provider-agnostic.
 */
export interface NewsProvider {
  readonly name: string;
  fetchNews(query: NewsQuery): Promise<RawArticle[]>;
}
