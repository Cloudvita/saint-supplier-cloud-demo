import {
  AnalyzeDocumentCommand,
  type Block,
  type AnalyzeDocumentCommandOutput,
} from "@aws-sdk/client-textract";
import { textract } from "./clients";

export type KeyValuePair = { key: string; value: string; confidence: number };

/** Field set we map a W-9 onto. */
export type W9Fields = {
  legalName?: string;
  dbaName?: string;
  taxClassification?: string;
  taxIdType?: "EIN" | "SSN";
  taxId?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

export type W9ExtractResult = {
  fields: W9Fields;
  pairs: KeyValuePair[];
  rawText: string;
  confidence: number;
};

/**
 * Run Textract AnalyzeDocument (FORMS + TABLES) on the raw bytes of a W-9.
 * Synchronous API: works for single-page documents up to 10 MB (PDF/PNG/JPEG/TIFF).
 */
export async function analyzeW9(bytes: Uint8Array): Promise<W9ExtractResult> {
  const out: AnalyzeDocumentCommandOutput = await textract.send(
    new AnalyzeDocumentCommand({
      Document: { Bytes: bytes },
      FeatureTypes: ["FORMS", "TABLES"],
    })
  );

  const blocks = out.Blocks ?? [];
  const pairs = extractKeyValuePairs(blocks);
  const rawText = blocks
    .filter((b) => b.BlockType === "LINE" && b.Text)
    .map((b) => b.Text as string)
    .join("\n");

  const confidence =
    pairs.length > 0
      ? pairs.reduce((s, p) => s + p.confidence, 0) / pairs.length
      : 0;

  return { fields: mapToW9Fields(pairs, rawText), pairs, rawText, confidence };
}

/* ------------------------------------------------------------------ */
/* Textract FORMS -> key/value pairs                                   */
/* ------------------------------------------------------------------ */

function extractKeyValuePairs(blocks: Block[]): KeyValuePair[] {
  const byId = new Map<string, Block>();
  for (const b of blocks) if (b.Id) byId.set(b.Id, b);

  const pairs: KeyValuePair[] = [];
  for (const b of blocks) {
    if (b.BlockType !== "KEY_VALUE_SET") continue;
    if (!b.EntityTypes?.includes("KEY")) continue;

    const key = textOf(b, byId);
    const valueIds =
      b.Relationships?.find((r) => r.Type === "VALUE")?.Ids ?? [];
    const value = valueIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((vb) => textOf(vb as Block, byId))
      .join(" ")
      .trim();

    if (key) pairs.push({ key: key.trim(), value, confidence: b.Confidence ?? 0 });
  }
  return pairs;
}

function textOf(block: Block, byId: Map<string, Block>): string {
  const childIds = block.Relationships?.find((r) => r.Type === "CHILD")?.Ids ?? [];
  const parts: string[] = [];
  for (const id of childIds) {
    const c = byId.get(id);
    if (!c) continue;
    if (c.BlockType === "WORD" && c.Text) parts.push(c.Text);
    if (c.BlockType === "SELECTION_ELEMENT" && c.SelectionStatus === "SELECTED")
      parts.push("[X]");
  }
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/* Key/value pairs -> normalized W-9 fields                            */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function findPair(pairs: KeyValuePair[], needles: string[]): string | undefined {
  for (const needle of needles) {
    const hit = pairs.find((p) => norm(p.key).includes(needle));
    if (hit?.value?.trim()) return hit.value.trim();
  }
  return undefined;
}

export function mapToW9Fields(pairs: KeyValuePair[], rawText: string): W9Fields {
  const fields: W9Fields = {};

  fields.legalName = findPair(pairs, [
    "name as shown on your income tax return",
    "name is required on this line",
    "1 name",
    "name",
  ]);

  fields.dbaName = findPair(pairs, [
    "business name disregarded entity name",
    "business name",
    "disregarded entity",
    "2 business name",
  ]);

  // --- Tax ID: prefer labelled fields, fall back to a regex over raw text ---
  const ein = findPair(pairs, ["employer identification number", "ein"]);
  const ssn = findPair(pairs, ["social security number", "ssn"]);
  const digits = (s?: string) => s?.replace(/[^0-9]/g, "") ?? "";

  if (digits(ein).length === 9) {
    fields.taxIdType = "EIN";
    fields.taxId = digits(ein);
  } else if (digits(ssn).length === 9) {
    fields.taxIdType = "SSN";
    fields.taxId = digits(ssn);
  } else {
    const einMatch = rawText.match(/\b(\d{2})\s*[-–]\s*(\d{7})\b/);
    const ssnMatch = rawText.match(/\b(\d{3})\s*[-–]\s*(\d{2})\s*[-–]\s*(\d{4})\b/);
    if (einMatch) {
      fields.taxIdType = "EIN";
      fields.taxId = einMatch[1] + einMatch[2];
    } else if (ssnMatch) {
      fields.taxIdType = "SSN";
      fields.taxId = ssnMatch[1] + ssnMatch[2] + ssnMatch[3];
    }
  }

  // --- Address ---
  fields.addressLine1 = findPair(pairs, [
    "address number street and apt or suite no",
    "address number street",
    "5 address",
    "address",
  ]);

  const cityStateZip = findPair(pairs, ["city state and zip code", "city state zip", "6 city"]);
  if (cityStateZip) {
    const m = cityStateZip.match(/^(.*?),?\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
    if (m) {
      fields.city = m[1].trim();
      fields.state = m[2].toUpperCase();
      fields.postalCode = m[3];
    } else {
      fields.city = cityStateZip;
    }
  }

  fields.taxClassification = detectTaxClassification(pairs, rawText);

  // strip empty keys
  (Object.keys(fields) as (keyof W9Fields)[]).forEach((k) => {
    if (!fields[k]) delete fields[k];
  });
  return fields;
}

/**
 * W-9 line 3 is a set of checkboxes. Textract emits them as SELECTION_ELEMENTs;
 * we look for the selected one whose key text matches a known classification.
 */
export function detectTaxClassification(pairs: KeyValuePair[], rawText: string): string {
  const selected = pairs.filter((p) => p.value.includes("[X]")).map((p) => norm(p.key));
  const text = norm(rawText);

  const rules: Array<[RegExp, string]> = [
    [/individual sole proprietor|single member llc/, "INDIVIDUAL_SOLE_PROPRIETOR"],
    [/c corporation|^c corp/, "C_CORPORATION"],
    [/s corporation|^s corp/, "S_CORPORATION"],
    [/partnership/, "PARTNERSHIP"],
    [/trust estate|trust\/estate/, "TRUST_ESTATE"],
    [/limited liability company|llc/, "LLC"],
    [/other/, "OTHER"],
  ];

  for (const label of selected) {
    for (const [re, val] of rules) if (re.test(label)) return val;
  }
  // Fallback: infer from the entity suffix in the raw text
  if (/\bllc\b/.test(text)) return "LLC";
  if (/\binc\b|\bcorp\b|\bcorporation\b/.test(text)) return "C_CORPORATION";
  if (/\blp\b|\bllp\b|partnership/.test(text)) return "PARTNERSHIP";
  return "UNKNOWN";
}
