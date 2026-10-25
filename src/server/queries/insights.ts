import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  aiInsights,
  aiRecommendations,
  contentItems,
  contentPlatformVersions,
  followUps,
  leadStatuses,
  opportunities,
  opportunityTouchpoints,
  pipelineStages,
  prospects,
  outreachCampaigns,
  type Platform,
} from "@/db/schema";
import { contentInsights, recommendations } from "@/lib/insights/engine";
import { loadContentDataset, loadOutreachDataset } from "./analytics";
import { periodFromRange } from "@/lib/metrics/period";
import { summarizeOutreach, filterEvents } from "@/lib/metrics/outreach";
import { endOfDay, startOfDay } from "date-fns";

const DAY = 86400000;

/**
 * Recomputes insights and recommendations from stored data and upserts them by fingerprint,
 * preserving the user's status (useful / dismissed). Items that no longer hold are removed
 * unless the user acted on them.
 */
export async function refreshInsights(tx: Tx, userId: string) {
  const period90 = periodFromRange("90d");
  const content = await loadContentDataset(tx, userId, period90);
  const perf = content.perf.filter((r) => r.post.publishedAt && r.post.publishedAt >= period90.start);

  const oppPillars = new Map<string, number>();
  const touch = await tx
    .select({ pillarId: contentItems.pillarId, opportunityId: opportunityTouchpoints.opportunityId })
    .from(opportunityTouchpoints)
    .innerJoin(contentItems, eq(contentItems.id, opportunityTouchpoints.contentItemId))
    .where(isNotNull(contentItems.pillarId));
  const seen = new Set<string>();
  for (const t of touch) {
    const k = `${t.pillarId}:${t.opportunityId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    oppPillars.set(t.pillarId!, (oppPillars.get(t.pillarId!) ?? 0) + 1);
  }
  const { insights, notes } = contentInsights(perf as never, { opportunityPillars: oppPillars });

  // Recommendation inputs.
  const versions = await tx
    .select({ itemId: contentPlatformVersions.contentItemId, platform: contentPlatformVersions.platform, format: contentPlatformVersions.format, status: contentPlatformVersions.status, plannedAt: contentPlatformVersions.plannedAt, publishedAt: contentPlatformVersions.publishedAt })
    .from(contentPlatformVersions);
  const itemPlatforms = new Map<string, Set<Platform>>();
  for (const v of versions) itemPlatforms.set(v.itemId, (itemPlatforms.get(v.itemId) ?? new Set()).add(v.platform));
  const now = new Date();
  const formatCounts90d = new Map<string, number>();
  for (const v of versions)
    if (v.status === "published" && v.publishedAt && v.publishedAt >= period90.start)
      formatCounts90d.set(v.format, (formatCounts90d.get(v.format) ?? 0) + 1);
  const scheduledNext7Days = versions.filter((v) => v.status !== "published" && v.status !== "archived" && v.plannedAt && v.plannedAt >= now && v.plannedAt.getTime() <= now.getTime() + 7 * DAY).length;
  const postsLast30Days = versions.filter((v) => v.status === "published" && v.publishedAt && v.publishedAt.getTime() >= now.getTime() - 30 * DAY).length;

  const due = await tx.select({ dueAt: followUps.dueAt }).from(followUps).where(and(eq(followUps.status, "pending"), lte(followUps.dueAt, endOfDay(now))));
  const followUpsOverdue = due.filter((f) => f.dueAt < startOfDay(now)).length;

  const excluded = (await tx.select({ key: leadStatuses.key }).from(leadStatuses).where(inArray(leadStatuses.category, ["excluded", "won", "lost"]))).map((s) => s.key);
  const highFit = await tx
    .select({ id: prospects.id, name: prospects.fullName, fitScore: prospects.fitScore })
    .from(prospects)
    .where(and(gte(prospects.fitScore, 75), isNull(prospects.lastContactedAt), excluded.length ? notInArray(prospects.status, excluded) : undefined))
    .orderBy(desc(prospects.fitScore));

  const interested = await tx
    .select({ id: prospects.id, name: prospects.fullName })
    .from(prospects)
    .where(
      and(
        eq(prospects.status, "interested"),
        sql`not exists (select 1 from follow_ups f where f.prospect_id = ${prospects.id} and f.status = 'pending')`,
        sql`not exists (select 1 from opportunities o join pipeline_stages s on s.key = o.stage and s.user_id = o.user_id where o.prospect_id = ${prospects.id} and s.kind = 'open')`,
      ),
    );

  const outreach = await loadOutreachDataset(tx, null);
  const campaignRows = await tx.select({ id: outreachCampaigns.id, name: outreachCampaigns.name }).from(outreachCampaigns);
  const allTime = { start: new Date(0), end: now };
  const campaigns = campaignRows.map((c) => {
    const scoped = filterEvents(outreach.events, { campaignId: c.id });
    const cohort = new Set(scoped.map((e) => e.prospectId));
    const s = summarizeOutreach({
      events: [...scoped, ...outreach.events.filter((e) => e.direction === "inbound" && cohort.has(e.prospectId))],
      opportunities: [],
      followUps: [],
      period: allTime,
    });
    return { id: c.id, name: c.name, contacted: s.contacted, replied: s.replied };
  });

  const stale = await tx
    .select({ id: opportunities.id, name: opportunities.name, last: opportunities.lastActivityAt, created: opportunities.createdAt })
    .from(opportunities)
    .innerJoin(pipelineStages, and(eq(pipelineStages.key, opportunities.stage), eq(pipelineStages.userId, opportunities.userId)))
    .where(and(eq(pipelineStages.kind, "open"), sql`coalesce(${opportunities.lastActivityAt}, ${opportunities.createdAt}) <= ${new Date(now.getTime() - 14 * DAY).toISOString()}::timestamptz`));

  const recs = recommendations({
    perf: perf as never,
    itemPlatforms,
    followUpsDue: due.length,
    followUpsOverdue,
    highFitUncontacted: highFit.map((p) => ({ ...p, fitScore: p.fitScore ?? 0 })),
    interestedNoNextStep: interested,
    campaigns,
    scheduledNext7Days,
    postsLast30Days,
    formatCounts90d,
    staleOpportunities: stale.map((o) => ({ id: o.id, name: o.name, days: Math.floor((now.getTime() - (o.last ?? o.created).getTime()) / DAY) })),
  });

  // Upsert, keeping user-set status.
  for (const i of insights)
    await tx
      .insert(aiInsights)
      .values({ ...i, periodStart: period90.start, periodEnd: period90.end })
      .onConflictDoUpdate({
        target: [aiInsights.userId, aiInsights.fingerprint],
        set: { title: i.title, body: i.body, evidence: i.evidence, sampleSize: i.sampleSize, confidence: i.confidence, periodStart: period90.start, periodEnd: period90.end, updatedAt: now },
      });
  const keepI = insights.map((i) => i.fingerprint);
  await tx.delete(aiInsights).where(and(eq(aiInsights.status, "active"), keepI.length ? notInArray(aiInsights.fingerprint, keepI) : undefined));

  for (const r of recs)
    await tx
      .insert(aiRecommendations)
      .values(r)
      .onConflictDoUpdate({
        target: [aiRecommendations.userId, aiRecommendations.fingerprint],
        set: {
          title: r.title,
          reasoning: r.reasoning,
          evidence: r.evidence,
          actionLabel: r.actionLabel,
          actionHref: r.actionHref,
          // A recommendation marked done reopens if it still applies a day later; dismissed stays dismissed.
          status: sql`case when ${aiRecommendations.status} = 'done' and ${aiRecommendations.statusChangedAt} < now() - interval '1 day' then 'open' else ${aiRecommendations.status} end`,
        },
      });
  const keepR = recs.map((r) => r.fingerprint);
  // Open recommendations that no longer apply are removed.
  await tx.delete(aiRecommendations).where(and(eq(aiRecommendations.status, "open"), keepR.length ? notInArray(aiRecommendations.fingerprint, keepR) : undefined));

  return { notes };
}

export async function getInsights(tx: Tx, userId: string) {
  const { notes } = await refreshInsights(tx, userId);
  const insights = await tx.select().from(aiInsights).where(inArray(aiInsights.status, ["active", "useful"])).orderBy(desc(aiInsights.sampleSize));
  const recs = await tx.select().from(aiRecommendations).where(eq(aiRecommendations.status, "open")).orderBy(desc(aiRecommendations.updatedAt));
  return { insights, recommendations: recs, notes };
}
