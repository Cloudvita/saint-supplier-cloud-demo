import type { ClassifiedArticle, RawArticle, RiskEventType, RiskSeverity } from "./types";

type Rule = { type: RiskEventType; severity: RiskSeverity; weight: number; patterns: RegExp[] };

/**
 * Deterministic keyword classifier. Kept separate from the provider so you can
 * later replace it with a Bedrock/Claude call without touching the rest.
 */
const RULES: Rule[] = [
  {
    type: "BANKRUPTCY",
    severity: "CRITICAL",
    weight: 1.0,
    patterns: [
      /\bchapter\s*(7|11|13)\b/i,
      /\bbankrupt(cy|ed)?\b/i,
      /\binsolven(t|cy)\b/i,
      /\breceivership\b/i,
      /\bliquidat(e|ion|ing)\b/i,
      /\badministration\b.*\bcreditors?\b/i,
      /\bwinding[- ]up\b/i,
      /\bdefault(ed)? on (its )?debt\b/i,
    ],
  },
  {
    type: "ACQUISITION",
    severity: "HIGH",
    weight: 0.9,
    patterns: [
      /\bacquir(e|es|ed|ing|ition)\b/i,
      /\bto be (acquired|bought)\b/i,
      /\btakeover\b/i,
      /\bbuyout\b/i,
      /\bmajority stake\b/i,
      /\bagrees? to buy\b/i,
    ],
  },
  {
    type: "MERGER",
    severity: "HIGH",
    weight: 0.9,
    patterns: [
      /\bmerg(e|es|er|ed|ing)\b/i,
      /\bcombin(e|ation) with\b/i,
      /\ball[- ]stock deal\b/i,
      /\bdefinitive (merger )?agreement\b/i,
    ],
  },
  {
    type: "DISPUTE",
    severity: "MEDIUM",
    weight: 0.75,
    patterns: [
      /\blawsuit\b/i,
      /\bsue[sd]?\b/i,
      /\blitigation\b/i,
      /\barbitration\b/i,
      /\bbreach of contract\b/i,
      /\bclass[- ]action\b/i,
      /\bregulatory (probe|investigation)\b/i,
      /\bfined?\b.*\b(regulator|commission|authority)\b/i,
      /\binjunction\b/i,
      /\bcontract (termination|dispute)\b/i,
    ],
  },
];

export function classifyArticle(a: RawArticle): ClassifiedArticle {
  const text = `${a.headline} ${a.summary ?? ""}`;

  let best: { type: RiskEventType; severity: RiskSeverity; score: number } = {
    type: "NONE",
    severity: "LOW",
    score: 0,
  };

  for (const rule of RULES) {
    const hits = rule.patterns.filter((p) => p.test(text)).length;
    if (hits === 0) continue;
    // more distinct pattern hits -> higher confidence, capped at 1
    const score = Math.min(1, rule.weight * (0.6 + 0.2 * hits));
    if (score > best.score) best = { type: rule.type, severity: rule.severity, score };
  }

  // Headline mentions carry more weight than body-only mentions
  if (best.type !== "NONE") {
    const inHeadline = RULES.find((r) => r.type === best.type)!.patterns.some((p) =>
      p.test(a.headline)
    );
    if (!inHeadline) {
      best.score = Math.max(0.3, best.score - 0.25);
      best.severity = downgrade(best.severity);
    }
  }

  return { ...a, eventType: best.type, severity: best.severity, score: Number(best.score.toFixed(2)) };
}

function downgrade(s: RiskSeverity): RiskSeverity {
  const order: RiskSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return order[Math.max(0, order.indexOf(s) - 1)];
}

/** Alert threshold: anything that is a real risk event with decent confidence. */
export function isAlertable(a: ClassifiedArticle): boolean {
  return a.eventType !== "NONE" && a.score >= 0.6;
}

/** Human-readable digest rendered into the supplier's Market News text field. */
export function buildDigest(companyName: string, items: ClassifiedArticle[], cadence: string) {
  if (items.length === 0) {
    return `No material market news found for ${companyName} in the last ${
      cadence === "WEEKLY" ? "7" : "30"
    } days.`;
  }
  const header = `${cadence === "WEEKLY" ? "Weekly" : "Monthly"} market brief — ${companyName} (generated ${new Date().toISOString().slice(0, 10)})`;
  const lines = items.map((i) => {
    const tag = i.eventType === "NONE" ? "INFO" : `${i.eventType}/${i.severity}`;
    const date = i.publishedAt.toISOString().slice(0, 10);
    return `• [${tag}] ${date} — ${i.headline}${i.source ? ` (${i.source})` : ""}`;
  });
  const flagged = items.filter(isAlertable);
  const footer =
    flagged.length > 0
      ? `\n\n⚠ ${flagged.length} risk event(s) detected: ${[...new Set(flagged.map((f) => f.eventType))].join(", ")}.`
      : "";
  return `${header}\n\n${lines.join("\n")}${footer}`;
}
