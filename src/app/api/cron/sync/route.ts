import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runScheduledSyncs } from "@/server/integrations/sync";

/**
 * Scheduled sync (e.g. Vercel Cron: GET with `Authorization: Bearer $CRON_SECRET`).
 * Disabled unless CRON_SECRET is set.
 */
export async function GET(request: NextRequest) {
  const secret = env().CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || header.length !== expected.length || !timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await runScheduledSyncs();
  return NextResponse.json({ synced: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}
