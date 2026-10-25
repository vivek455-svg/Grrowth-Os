import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  audienceSnapshots,
  contentItems,
  contentMetricsSnapshots,
  contentPillars,
  contentPlatformVersions,
  conversationEvents,
  followUps,
  opportunities,
  pipelineStages,
  profiles,
  prospects,
  type Platform,
} from "@/db/schema";
import { postPerformance, type PostPerformance } from "@/lib/metrics/content";
import { previousPeriod, type Period } from "@/lib/metrics/period";
import type { EventLike, OpportunityLike, FollowUpLike } from "@/lib/metrics/outreach";

export type PostRow = {
  id: string;
  contentItemId: string;
  platform: Platform;
  publishedAt: Date | null;
  title: string;
  body: string;
  format: string;
  hookStyle: string | null;
  ctaType: string | null;
  pillarId: string | null;
  pillarName: string | null;
  topic: string | null;
  platformPostUrl: string | null;
};

export type ContentDataset = {
  denominator: "impressions" | "followers";
  posts: PostRow[];
  perf: (PostPerformance & { post: PostRow })[];
  audience: { platform: Platform; capturedAt: Date; followers: number }[];
};

/**
 * Loads published posts (with metrics) from the start of the previous equivalent period
 * so current vs. previous comparisons use the same dataset.
 */
export async function loadContentDataset(tx: Tx, userId: string, period: Period | null): Promise<ContentDataset> {
  const [profile] = await tx.select({ d: profiles.engagementRateDenominator }).from(profiles).where(eq(profiles.id, userId));
  const from = period ? previousPeriod(period).start : null;
  const posts = await tx
    .select({
      id: contentPlatformVersions.id,
      contentItemId: contentPlatformVersions.contentItemId,
      platform: contentPlatformVersions.platform,
      publishedAt: contentPlatformVersions.publishedAt,
      title: contentItems.title,
      body: contentPlatformVersions.body,
      format: contentPlatformVersions.format,
      hookStyle: contentPlatformVersions.hookStyle,
      ctaType: contentPlatformVersions.ctaType,
      pillarId: contentItems.pillarId,
      pillarName: contentPillars.name,
      topic: contentItems.topic,
      platformPostUrl: contentPlatformVersions.platformPostUrl,
    })
    .from(contentPlatformVersions)
    .innerJoin(contentItems, eq(contentItems.id, contentPlatformVersions.contentItemId))
    .leftJoin(contentPillars, eq(contentPillars.id, contentItems.pillarId))
    .where(
      and(
        eq(contentPlatformVersions.status, "published"),
        isNotNull(contentPlatformVersions.publishedAt),
        from ? gte(contentPlatformVersions.publishedAt, from) : undefined,
      ),
    )
    .orderBy(desc(contentPlatformVersions.publishedAt));

  const ids = posts.map((p) => p.id);
  const snapshots = ids.length
    ? await tx.select().from(contentMetricsSnapshots).where(inArray(contentMetricsSnapshots.versionId, ids))
    : [];
  const audience = await tx
    .select({ platform: audienceSnapshots.platform, capturedAt: audienceSnapshots.capturedAt, followers: audienceSnapshots.followers })
    .from(audienceSnapshots)
    .orderBy(asc(audienceSnapshots.capturedAt));
  const denominator = profile?.d ?? "impressions";
  const perf = postPerformance(posts, snapshots, audience, denominator) as (PostPerformance & { post: PostRow })[];
  return { denominator, posts, perf, audience };
}

export type OutreachDataset = {
  events: (EventLike & { id: string })[];
  opportunities: (OpportunityLike & { id: string; sourceChannel: string | null; contentItemId: string | null; outreachCampaignId: string | null })[];
  followUps: FollowUpLike[];
  prospectSegments: Map<string, { companyType: string | null; persona: string | null; createdAt: Date }>;
  totalProspects: number;
};

export async function loadOutreachDataset(tx: Tx, period: Period | null): Promise<OutreachDataset> {
  const from = period ? previousPeriod(period).start : null;
  const events = await tx
    .select({
      id: conversationEvents.id,
      prospectId: conversationEvents.prospectId,
      type: conversationEvents.type,
      direction: conversationEvents.direction,
      occurredAt: conversationEvents.occurredAt,
      deliveryStatus: conversationEvents.deliveryStatus,
      sentiment: conversationEvents.sentiment,
      campaignId: conversationEvents.campaignId,
      channel: conversationEvents.channel,
    })
    .from(conversationEvents)
    .where(and(sql`${conversationEvents.type} not in ('status_changed','follow_up_scheduled','note')`, from ? gte(conversationEvents.occurredAt, from) : undefined));
  const opps = await tx
    .select({
      id: opportunities.id,
      prospectId: opportunities.prospectId,
      createdAt: opportunities.createdAt,
      closedAt: opportunities.closedAt,
      stageKind: pipelineStages.kind,
      valueCents: opportunities.valueCents,
      sourceChannel: opportunities.sourceChannel,
      contentItemId: opportunities.contentItemId,
      outreachCampaignId: opportunities.outreachCampaignId,
    })
    .from(opportunities)
    .innerJoin(pipelineStages, and(eq(pipelineStages.key, opportunities.stage), eq(pipelineStages.userId, opportunities.userId)));
  const fus = await tx
    .select({ dueAt: followUps.dueAt, status: followUps.status })
    .from(followUps)
    .where(from ? gte(followUps.dueAt, from) : undefined);
  const ps = await tx.select({ id: prospects.id, companyType: prospects.companyType, persona: prospects.persona, createdAt: prospects.createdAt }).from(prospects);
  return {
    events,
    opportunities: opps,
    followUps: fus,
    prospectSegments: new Map(ps.map((p) => [p.id, p])),
    totalProspects: ps.length,
  };
}

export async function upcomingContent(tx: Tx, days = 14) {
  const now = new Date();
  return tx
    .select({
      id: contentPlatformVersions.id,
      contentItemId: contentPlatformVersions.contentItemId,
      title: contentItems.title,
      platform: contentPlatformVersions.platform,
      status: contentPlatformVersions.status,
      plannedAt: contentPlatformVersions.plannedAt,
      body: contentPlatformVersions.body,
    })
    .from(contentPlatformVersions)
    .innerJoin(contentItems, eq(contentItems.id, contentPlatformVersions.contentItemId))
    .where(
      and(
        sql`${contentPlatformVersions.status} not in ('published','archived')`,
        gte(contentPlatformVersions.plannedAt, new Date(now.getTime() - 86400000)),
        lte(contentPlatformVersions.plannedAt, new Date(now.getTime() + days * 86400000)),
      ),
    )
    .orderBy(asc(contentPlatformVersions.plannedAt));
}

/** Daily series for trend charts: impressions & engagements by platform, keyed by publication day. */
export function dailySeries(perf: ContentDataset["perf"], period: Period) {
  const days: { date: string; x: number | null; linkedin: number | null; xEng: number | null; linkedinEng: number | null }[] = [];
  const index = new Map<string, (typeof days)[number]>();
  for (let t = period.start.getTime(); t <= period.end.getTime(); t += 86400000) {
    const key = new Date(t).toISOString().slice(0, 10);
    const row = { date: key, x: null, linkedin: null, xEng: null, linkedinEng: null };
    days.push(row);
    index.set(key, row);
  }
  for (const r of perf) {
    if (!r.post.publishedAt || !r.snapshot) continue;
    const row = index.get(r.post.publishedAt.toISOString().slice(0, 10));
    if (!row) continue;
    const impr = r.snapshot.impressions;
    if (impr !== null) {
      if (r.post.platform === "x") row.x = (row.x ?? 0) + impr;
      else row.linkedin = (row.linkedin ?? 0) + impr;
    }
    if (r.engagements !== null) {
      if (r.post.platform === "x") row.xEng = (row.xEng ?? 0) + r.engagements;
      else row.linkedinEng = (row.linkedinEng ?? 0) + r.engagements;
    }
  }
  return days;
}

/** Weekly buckets (better for sparse posting schedules than daily points). */
export function weeklySeries(perf: ContentDataset["perf"], period: Period) {
  const daily = dailySeries(perf, period);
  const weeks: { week: string; x: number | null; linkedin: number | null; posts: number }[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    const sum = (k: "x" | "linkedin") => {
      const vals = chunk.map((d) => d[k]).filter((v): v is number => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    const start = chunk[0]!.date;
    const end = chunk[chunk.length - 1]!.date;
    const posts = perf.filter((r) => {
      const d = r.post.publishedAt?.toISOString().slice(0, 10);
      return d && d >= start && d <= end;
    }).length;
    weeks.push({ week: start, x: sum("x"), linkedin: sum("linkedin"), posts });
  }
  return weeks;
}
