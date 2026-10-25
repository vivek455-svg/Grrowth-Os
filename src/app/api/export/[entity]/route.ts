import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getSessionUser } from "@/server/auth";
import { withUser } from "@/db/client";
import {
  activityLogs,
  campaignProspects,
  contentItems,
  contentPillars,
  contentPlatformVersions,
  conversationEvents,
  followUps,
  opportunities,
  outreachCampaigns,
  outreachMessages,
  profiles,
  prospectResearch,
  prospects,
  contentMetricsSnapshots,
} from "@/db/schema";
import { csvSafe } from "@/lib/domain/csv-import";
import { latestSnapshots } from "@/lib/metrics/content";

function csv(rows: Record<string, unknown>[], name: string) {
  const body = Papa.unparse(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, csvSafe(v)]))));
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}

/** CSV/JSON exports. Every query runs under RLS as the signed-in user. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/export/[entity]">) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { entity } = await ctx.params;

  return withUser(user.id, async (tx) => {
    if (entity === "prospects") {
      const ids = request.nextUrl.searchParams.get("ids")?.split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      const rows = await tx.select().from(prospects).where(ids?.length ? inArray(prospects.id, ids) : undefined).orderBy(asc(prospects.fullName));
      return csv(
        rows.map(({ userId: _u, domainKey: _d, linkedinKey: _l, ...r }) => r),
        "prospects",
      );
    }
    if (entity === "content") {
      const versions = await tx
        .select({
          title: contentItems.title,
          pillar: contentPillars.name,
          platform: contentPlatformVersions.platform,
          format: contentPlatformVersions.format,
          status: contentPlatformVersions.status,
          plannedAt: contentPlatformVersions.plannedAt,
          publishedAt: contentPlatformVersions.publishedAt,
          publishSource: contentPlatformVersions.publishSource,
          url: contentPlatformVersions.platformPostUrl,
          text: contentPlatformVersions.body,
          id: contentPlatformVersions.id,
        })
        .from(contentPlatformVersions)
        .innerJoin(contentItems, eq(contentItems.id, contentPlatformVersions.contentItemId))
        .leftJoin(contentPillars, eq(contentPillars.id, contentItems.pillarId))
        .orderBy(desc(contentPlatformVersions.publishedAt));
      const snaps = latestSnapshots(await tx.select().from(contentMetricsSnapshots));
      return csv(
        versions.map(({ id, ...v }) => {
          const s = snaps.get(id);
          return { ...v, impressions: s?.impressions, likes: s?.likes, replies: s?.replies, reposts: s?.reposts, bookmarks: s?.bookmarks, linkClicks: s?.linkClicks, profileVisits: s?.profileVisits, metricsSource: s?.source, metricsCapturedAt: s?.capturedAt };
        }),
        "content",
      );
    }
    if (entity === "campaigns") {
      const rows = await tx
        .select({ campaign: outreachCampaigns.name, channel: outreachCampaigns.channel, campaignStatus: outreachCampaigns.status, prospect: prospects.fullName, company: prospects.company, state: campaignProspects.state, addedAt: campaignProspects.addedAt, leadStatus: prospects.status })
        .from(campaignProspects)
        .innerJoin(outreachCampaigns, eq(outreachCampaigns.id, campaignProspects.campaignId))
        .innerJoin(prospects, eq(prospects.id, campaignProspects.prospectId))
        .orderBy(asc(outreachCampaigns.name));
      return csv(rows, "campaigns");
    }
    if (entity === "opportunities") {
      const rows = await tx.select().from(opportunities).orderBy(desc(opportunities.createdAt));
      return csv(rows.map(({ userId: _u, ...r }) => ({ ...r, value: r.valueCents != null ? r.valueCents / 100 : null })), "opportunities");
    }
    if (entity === "all") {
      // Full data export (JSON) for portability and account deletion requests.
      const data = {
        exportedAt: new Date().toISOString(),
        profile: await tx.select().from(profiles),
        contentItems: await tx.select().from(contentItems),
        contentVersions: await tx.select().from(contentPlatformVersions),
        metrics: await tx.select().from(contentMetricsSnapshots),
        prospects: await tx.select().from(prospects),
        research: await tx.select().from(prospectResearch),
        campaigns: await tx.select().from(outreachCampaigns),
        messages: await tx.select().from(outreachMessages),
        events: await tx.select().from(conversationEvents),
        followUps: await tx.select().from(followUps),
        opportunities: await tx.select().from(opportunities),
        auditLog: await tx.select().from(activityLogs),
      };
      return new NextResponse(JSON.stringify(data, null, 2), {
        headers: { "content-type": "application/json", "content-disposition": `attachment; filename="growth-os-export-${data.exportedAt.slice(0, 10)}.json"`, "cache-control": "no-store" },
      });
    }
    return NextResponse.json({ error: "unknown export" }, { status: 404 });
  });
}
