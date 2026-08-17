import type { NewsProvider, NewsQuery, RawArticle } from "./types";

/* ------------------------------------------------------------------ */
/* 1. Mock provider — default. No API key, deterministic, demo-ready.   */
/* ------------------------------------------------------------------ */

const TEMPLATES: Array<(c: string) => Omit<RawArticle, "publishedAt">> = [
  (c) => ({
    headline: `${c} reports Q results, reaffirms full-year guidance`,
    summary: `${c} posted revenue in line with consensus and left its full-year outlook unchanged. Management pointed to stable order intake.`,
    source: "Market Wire",
    url: `https://example.com/news/${slug(c)}-results`,
  }),
  (c) => ({
    headline: `${c} to be acquired in all-cash deal valued at $2.4B`,
    summary: `A definitive agreement was signed under which ${c} will be acquired. The takeover is expected to close next quarter subject to regulatory approval.`,
    source: "Deal Reporter",
    url: `https://example.com/news/${slug(c)}-acquisition`,
  }),
  (c) => ({
    headline: `Supplier ${c} faces class-action lawsuit over contract terms`,
    summary: `Plaintiffs allege breach of contract and are seeking damages. ${c} said the litigation is without merit.`,
    source: "Legal Daily",
    url: `https://example.com/news/${slug(c)}-lawsuit`,
  }),
  (c) => ({
    headline: `${c} files for Chapter 11 bankruptcy protection`,
    summary: `${c} entered Chapter 11 to restructure debt. Operations are expected to continue during the reorganisation.`,
    source: "Restructuring Today",
    url: `https://example.com/news/${slug(c)}-chapter11`,
  }),
  (c) => ({
    headline: `${c} and a regional rival agree to merge operations`,
    summary: `The all-stock merger would create the third-largest player in the segment. Antitrust review is pending.`,
    source: "Industry Week",
    url: `https://example.com/news/${slug(c)}-merger`,
  }),
  (c) => ({
    headline: `${c} opens new distribution centre, adds 120 jobs`,
    summary: `The facility expands regional capacity and is expected to shorten lead times.`,
    source: "Logistics Post",
    url: `https://example.com/news/${slug(c)}-expansion`,
  }),
];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Stable pseudo-random so the same supplier gets the same demo feed. */
function seeded(name: string) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export class MockNewsProvider implements NewsProvider {
  readonly name = "mock";

  async fetchNews(q: NewsQuery): Promise<RawArticle[]> {
    const rand = seeded(q.companyName);
    const windowDays = q.cadence === "WEEKLY" ? 7 : 30;
    const count = 3 + Math.floor(rand() * 3); // 3-5 articles

    const picked = [...TEMPLATES].sort(() => rand() - 0.5).slice(0, count);
    return picked.map((t, i) => {
      const daysAgo = Math.floor(rand() * windowDays);
      const publishedAt = new Date(Date.now() - daysAgo * 86400000 - i * 3600000);
      return { ...t(q.companyName), publishedAt };
    });
  }
}

/* ------------------------------------------------------------------ */
/* 2. NewsAPI.org provider — drop in a key and set NEWS_PROVIDER=newsapi */
/* ------------------------------------------------------------------ */

export class NewsApiProvider implements NewsProvider {
  readonly name = "newsapi";
  constructor(private apiKey: string) {}

  async fetchNews(q: NewsQuery): Promise<RawArticle[]> {
    const windowDays = q.cadence === "WEEKLY" ? 7 : 30;
    const from = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
    const terms = [`"${q.companyName}"`, q.ticker, q.keywords].filter(Boolean).join(" OR ");

    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", terms);
    url.searchParams.set("from", from);
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("language", "en");
    url.searchParams.set("pageSize", "20");

    const res = await fetch(url, {
      headers: { "X-Api-Key": this.apiKey },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`NewsAPI error ${res.status}: ${await res.text()}`);

    const json = (await res.json()) as {
      articles?: Array<{
        title: string;
        description?: string;
        url?: string;
        source?: { name?: string };
        publishedAt: string;
      }>;
    };

    return (json.articles ?? []).map((a) => ({
      headline: a.title,
      summary: a.description ?? undefined,
      url: a.url,
      source: a.source?.name,
      publishedAt: new Date(a.publishedAt),
    }));
  }
}

/* ------------------------------------------------------------------ */
/* 3. Generic RSS provider — no key required (e.g. Google News RSS)     */
/* ------------------------------------------------------------------ */

export class RssNewsProvider implements NewsProvider {
  readonly name = "rss";
  constructor(private template = process.env.NEWS_RSS_TEMPLATE || "") {}

  async fetchNews(q: NewsQuery): Promise<RawArticle[]> {
    if (!this.template) throw new Error("NEWS_RSS_TEMPLATE is not set");
    const url = this.template.replace("{query}", encodeURIComponent(q.companyName));
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`RSS error ${res.status}`);
    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20);
    return items.map((m) => {
      const block = m[1];
      const pick = (tag: string) =>
        block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
      const clean = (s: string) =>
        s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
      return {
        headline: clean(pick("title")),
        summary: clean(pick("description")) || undefined,
        url: clean(pick("link")) || undefined,
        source: clean(pick("source")) || "RSS",
        publishedAt: new Date(clean(pick("pubDate")) || Date.now()),
      };
    });
  }
}

/* ------------------------------------------------------------------ */

export function getNewsProvider(): NewsProvider {
  const provider = (process.env.NEWS_PROVIDER || "mock").toLowerCase();
  switch (provider) {
    case "newsapi": {
      const key = process.env.NEWS_API_KEY;
      if (!key) throw new Error("NEWS_PROVIDER=newsapi but NEWS_API_KEY is not set");
      return new NewsApiProvider(key);
    }
    case "rss":
      return new RssNewsProvider();
    default:
      return new MockNewsProvider();
  }
}
