import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/** App Runner health check target. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "up", ts: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { status: "degraded", db: "down", error: e instanceof Error ? e.message : "unknown" },
      { status: 503 }
    );
  }
}
