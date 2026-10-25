import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  contentCampaigns,
  contentIdeas,
  contentItems,
  contentItemTags,
  contentMetricsSnapshots,
  contentPillars,
  contentPlatformVersions,
  contentTags,
  opportunities,
  opportunityTouchpoints,
  type ContentStatus,
  type Platform,
} from "@/db/schema";
import { engagementRate, engagements, latestSnapshots } from "@/lib/metrics/content";

export type CalendarEntry = {
  id: string;
  contentItemId: string;
  title: string;
  platform: Platform;
  status: ContentStatus;
  date: string; // ISO; planned or published time
  hasBody: boolean;
  pillarId: string | null;
  platformPostUrl: string | null;
  body: string;
};

export async function calendarEntries(tx: Tx, from: Date, to: Date): Promise<CalendarEntry[]> {
  const rows = await tx
    .select({
      id: contentPlatformVersions.id,
      contentItemId: contentPlatformVersions.contentItemId,
      title: contentItems.title,
      platform: contentPlatformVersions.platform,
      status: contentPlatformVersions.status,
      plannedAt: contentPlatformVersions.plannedAt,
      publishedAt: contentPlatformVersions.publishedAt,
      body: contentPlatformVersions.body,
      pillarId: contentItems.pillarId,
      platformPostUrl: contentPlatformVersions.platformPostUrl,
    })
    .from(contentPlatformVersions)
    .innerJoin(contentItems, eq(contentItems.id, contentPlatformVersions.contentItemId))
    .where(
      and(
        isNull(contentItems.archivedAt),
        sql`${contentPlatformVersions.status} <> 'archived'`,
        or(
          and(gte(contentPlatformVersions.publishedAt, from), lte(contentPlatformVersions.publishedAt, to)),
          and(isNull(contentPlatformVersions.publishedAt), gte(contentPlatformVersions.plannedAt, from), lte(contentPlatformVersions.plannedAt, to)),
        ),
      ),
    )
    .orderBy(asc(sql`coalesce(${contentPlatformVersions.publishedAt}, ${contentPlatformVersions.plannedAt})`));
  return rows.map((r) => ({
    id: r.id,
    contentItemId: r.contentItemId,
    title: r.title,
    platform: r.platform,
    status: r.status,
    date: (r.publishedAt ?? r.plannedAt)!.toISOString(),
    hasBody: r.body.trim().length > 0,
    pillarId: r.pillarId,
    platformPostUrl: r.platformPostUrl,
    body: r.body,
  }));
}

/** Unscheduled drafts and ideas, shown beside the calendar so they can be dragged in. */
export async function unscheduled(tx: Tx) {
  return tx
    .select({
      id: contentPlatformVersions.id,
      contentItemId: contentPlatformVersions.contentItemId,
      title: contentItems.title,
      platform: contentPlatformVersions.platform,
      status: contentPlatformVersions.status,
    })
    .from(contentPlatformVersions)
    .innerJoin(contentItems, eq(contentItems.id, contentPlatformVersions.contentItemId))
    .where(and(isNull(contentItems.archivedAt), isNull(contentPlatformVersions.plannedAt), inArray(contentPlatformVersions.status, ["idea", "draft", "ready"])))
    .orderBy(desc(contentPlatformVersions.updatedAt))
    .limit(30);
}

export type LibraryRow = {
  itemId: string;
  title: string;
  pillarId: string | null;
  pillarName: string | null;
  topic: string | null;
  keywords: string[];
  tags: string[];
  archived: boolean;
  createdAt: Date;
  versions: {
    id: string;
    platform: Platform;
    format: string;
    status: ContentStatus;
    plannedAt: Date | null;
    publishedAt: Date | null;
    platformPostUrl: string | null;
    excerpt: string;
    impressions: number | null;
    engagements: number | null;
    engagementRate: number | null;
    linkClicks: number | null;
    profileVisits: number | null;
    replies: number | null;
    source: string | null;
  }[];
};

export async function libraryRows(tx: Tx, opts: { includeArchived?: boolean } = {}): Promise<LibraryRow[]> {
  const items = await tx
    .select({
      id: contentItems.id,
      title: contentItems.title,
      pillarId: contentItems.pillarId,
      pillarName: contentPillars.name,
      topic: contentItems.topic,
      keywords: contentItems.keywords,
      archivedAt: contentItems.archivedAt,
      createdAt: contentItems.createdAt,
    })
    .from(contentItems)
    .leftJoin(contentPillars, eq(contentPillars.id, contentItems.pillarId))
    .where(opts.includeArchived ? undefined : isNull(contentItems.archivedAt))
    .orderBy(desc(contentItems.createdAt));
  const versions = await tx.select().from(contentPlatformVersions);
  const snaps = latestSnapshots(await tx.select().from(contentMetricsSnapshots));
  const tagRows = await tx
    .select({ itemId: contentItemTags.contentItemId, name: contentTags.name })
    .from(contentItemTags)
    .innerJoin(contentTags, eq(contentTags.id, contentItemTags.tagId));
  const tagsByItem = new Map<string, string[]>();
  for (const t of tagRows) tagsByItem.set(t.itemId, [...(tagsByItem.get(t.itemId) ?? []), t.name]);
  const byItem = new Map<string, typeof versions>();
  for (const v of versions) byItem.set(v.contentItemId, [...(byItem.get(v.contentItemId) ?? []), v]);
  // The library always shows per-post engagement ÷ impressions; follower-based rates are an analytics setting.
  const denominator = "impressions" as const;

  return items.map((i) => ({
    itemId: i.id,
    title: i.title,
    pillarId: i.pillarId,
    pillarName: i.pillarName,
    topic: i.topic,
    keywords: i.keywords,
    tags: tagsByItem.get(i.id) ?? [],
    archived: !!i.archivedAt,
    createdAt: i.createdAt,
    versions: (byItem.get(i.id) ?? []).map((v) => {
      const s = snaps.get(v.id);
      return {
        id: v.id,
        platform: v.platform,
        format: v.format,
        status: v.status,
        plannedAt: v.plannedAt,
        publishedAt: v.publishedAt,
        platformPostUrl: v.platformPostUrl,
        excerpt: v.body.slice(0, 220),
        impressions: s?.impressions ?? null,
        engagements: s ? engagements(s) : null,
        engagementRate: s ? engagementRate(s, { denominator }) : null,
        linkClicks: s?.linkClicks ?? null,
        profileVisits: s?.profileVisits ?? null,
        replies: s?.replies ?? null,
        source: s?.source ?? null,
      };
    }),
  }));
}

export async function contentDetail(tx: Tx, id: string) {
  const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, id));
  if (!item) return null;
  const versions = await tx
    .select()
    .from(contentPlatformVersions)
    .where(eq(contentPlatformVersions.contentItemId, id))
    .orderBy(asc(contentPlatformVersions.createdAt));
  const snapshots = versions.length
    ? await tx
        .select()
        .from(contentMetricsSnapshots)
        .where(inArray(contentMetricsSnapshots.versionId, versions.map((v) => v.id)))
        .orderBy(desc(contentMetricsSnapshots.capturedAt))
    : [];
  const tags = await tx
    .select({ name: contentTags.name })
    .from(contentItemTags)
    .innerJoin(contentTags, eq(contentTags.id, contentItemTags.tagId))
    .where(eq(contentItemTags.contentItemId, id));
  const pillars = await tx.select({ id: contentPillars.id, name: contentPillars.name }).from(contentPillars).where(isNull(contentPillars.archivedAt)).orderBy(asc(contentPillars.sortOrder));
  const campaigns = await tx.select({ id: contentCampaigns.id, name: contentCampaigns.name }).from(contentCampaigns);
  const linkedOpps = await tx
    .selectDistinct({ id: opportunities.id, name: opportunities.name, stage: opportunities.stage })
    .from(opportunities)
    .leftJoin(opportunityTouchpoints, eq(opportunityTouchpoints.opportunityId, opportunities.id))
    .where(or(eq(opportunities.contentItemId, id), eq(opportunityTouchpoints.contentItemId, id)));
  return { item, versions, snapshots, tags: tags.map((t) => t.name), pillars, campaigns, linkedOpps };
}

export async function openIdeas(tx: Tx) {
  return tx
    .select({ id: contentIdeas.id, title: contentIdeas.title, notes: contentIdeas.notes, source: contentIdeas.source, pillarId: contentIdeas.pillarId, pillarName: contentPillars.name, createdAt: contentIdeas.createdAt })
    .from(contentIdeas)
    .leftJoin(contentPillars, eq(contentPillars.id, contentIdeas.pillarId))
    .where(eq(contentIdeas.status, "open"))
    .orderBy(desc(contentIdeas.createdAt));
}
