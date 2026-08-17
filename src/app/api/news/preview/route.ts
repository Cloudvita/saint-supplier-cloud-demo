import { NextResponse } from "next/server";
import { getNewsProvider } from "@/lib/news/providers";
import { buildDigest, classifyArticle, isAlertable } from "@/lib/news/classifier";

export const dynamic = "force-dynamic";

/**
 * POST /api/news/preview  { companyName, ticker?, keywords?, cadence }
 * Fetches + classifies news for a company that is not saved yet, so the
 * onboarding form can populate the Market News field before submit.
 * Nothing is persisted and no alert emails are sent.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    companyName?: string;
    ticker?: string;
    keywords?: string;
    cadence?: "WEEKLY" | "MONTHLY";
  };

  if (!body.companyName?.trim()) {
    return NextResponse.json({ error: "companyName is required" }, { status: 400 });
  }
  const cadence = body.cadence === "MONTHLY" ? "MONTHLY" : "WEEKLY";

  try {
    const provider = getNewsProvider();
    const raw = await provider.fetchNews({
      companyName: body.companyName.trim(),
      ticker: body.ticker,
      keywords: body.keywords,
      cadence,
    });
    const items = raw
      .map(classifyArticle)
      .sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime());

    return NextResponse.json({
      provider: provider.name,
      digest: buildDigest(body.companyName.trim(), items, cadence),
      riskEvents: items.filter(isAlertable).map((i) => ({
        eventType: i.eventType,
        severity: i.severity,
        headline: i.headline,
        url: i.url,
      })),
      count: items.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "News fetch failed" },
      { status: 502 }
    );
  }
}
