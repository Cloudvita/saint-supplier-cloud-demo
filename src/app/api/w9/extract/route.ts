import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { w9Documents } from "@/db/schema";
import { analyzeW9 } from "@/lib/aws/textract";
import { putW9, w9Key } from "@/lib/aws/s3";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024; // Textract synchronous limit
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/tiff"];

/**
 * POST /api/w9/extract   (multipart/form-data, field name: "file")
 * Archives the W-9 in S3, runs Textract AnalyzeDocument, and returns mapped
 * fields so the UI can pre-fill the supplier form. The buyer reviews before saving.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded (field name must be 'file')" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds the 10 MB Textract sync limit" }, { status: 413 });
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json(
      { error: `Unsupported type ${file.type}. Use PDF, PNG, JPEG or TIFF.` },
      { status: 415 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const [doc] = await db
    .insert(w9Documents)
    .values({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      extractionStatus: "PENDING",
    })
    .returning();

  // 1. archive the original (skipped when S3_W9_BUCKET is unset)
  try {
    const key = w9Key(file.name);
    const stored = await putW9(key, bytes, file.type);
    if (stored) {
      await db
        .update(w9Documents)
        .set({ s3Bucket: stored.bucket, s3Key: stored.key })
        .where(eq(w9Documents.id, doc.id));
    }
  } catch (e) {
    console.error("S3 archive failed (continuing to extraction)", e);
  }

  // 2. extract
  try {
    const result = await analyzeW9(bytes);
    await db
      .update(w9Documents)
      .set({
        rawExtraction: result.pairs,
        parsedFields: result.fields,
        confidence: result.confidence,
        extractionStatus: "EXTRACTED",
      })
      .where(eq(w9Documents.id, doc.id));

    return NextResponse.json({
      documentId: doc.id,
      fields: result.fields,
      confidence: Number(result.confidence.toFixed(1)),
      pairsFound: result.pairs.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Textract failed";
    await db
      .update(w9Documents)
      .set({ extractionStatus: "FAILED", extractionError: message })
      .where(eq(w9Documents.id, doc.id));
    console.error("Textract error", e);
    return NextResponse.json(
      { documentId: doc.id, error: `Extraction failed: ${message}`, fields: {} },
      { status: 502 }
    );
  }
}
