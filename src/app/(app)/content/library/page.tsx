import Link from "next/link";
import { asc, isNull } from "drizzle-orm";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/app/page-header";
import { NewPostButton } from "@/components/content/new-post-button";
import { SaveIdeaButton } from "@/components/content/save-idea-button";
import { IdeasList, LibraryView, type LibraryPost } from "@/components/content/library-view";
import { loadForUser } from "@/server/page";
import { libraryRows, openIdeas } from "@/server/queries/content";
import { contentPillars, type Platform } from "@/db/schema";
import { daysAgoMs } from "@/lib/metrics/period";

export const metadata = { title: "Content Library" };

function quartiles(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return { q1: s[Math.floor((s.length - 1) * 0.25)], q3: s[Math.ceil((s.length - 1) * 0.75)] };
}

export default async function LibraryPage({ searchParams }: PageProps<"/content/library">) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const tab = str("tab") === "ideas" ? "ideas" : "posts";
  const { rows, ideas, pillars } = await loadForUser(async (tx) => ({
    rows: await libraryRows(tx, { includeArchived: str("status") === "archived" }),
    ideas: await openIdeas(tx),
    pillars: await tx.select({ id: contentPillars.id, name: contentPillars.name }).from(contentPillars).where(isNull(contentPillars.archivedAt)).orderBy(asc(contentPillars.sortOrder)),
  }));

  let posts: LibraryPost[] = rows.flatMap((r) =>
    r.versions.map((v) => ({
      versionId: v.id,
      itemId: r.itemId,
      title: r.title,
      platform: v.platform,
      format: v.format,
      status: r.archived ? "archived" : v.status,
      pillarName: r.pillarName,
      pillarId: r.pillarId,
      date: (v.publishedAt ?? v.plannedAt)?.toISOString() ?? null,
      excerpt: v.excerpt,
      impressions: v.impressions,
      engagementRate: v.engagementRate,
      linkClicks: v.linkClicks,
      profileVisits: v.profileVisits,
      source: v.source,
      url: v.platformPostUrl,
      tier: null,
      archived: r.archived,
      otherPlatforms: r.versions.filter((o) => o.id !== v.id).map((o) => o.platform) as Platform[],
      tags: r.tags,
      search: `${r.title} ${r.topic ?? ""} ${r.keywords.join(" ")} ${r.tags.join(" ")} ${v.excerpt}`.toLowerCase(),
    })),
  ) as (LibraryPost & { pillarId: string | null; search: string })[];

  // Performance tiers among published posts with an engagement rate (needs ≥ 8 posts to be meaningful).
  const rated = posts.filter((p) => p.status === "published" && p.engagementRate !== null);
  if (rated.length >= 8) {
    const { q1, q3 } = quartiles(rated.map((p) => p.engagementRate!));
    for (const p of rated) p.tier = p.engagementRate! >= q3! ? "top" : p.engagementRate! <= q1! ? "under" : null;
  }

  const q = str("q")?.toLowerCase();
  const period = Number(str("period") ?? 0);
  const since = period ? daysAgoMs(period) : 0;
  const all = posts as (LibraryPost & { pillarId: string | null; search: string })[];
  posts = all.filter(
    (p) =>
      (!q || p.search.includes(q)) &&
      (!str("platform") || p.platform === str("platform")) &&
      (!str("pillar") || p.pillarId === str("pillar")) &&
      (!str("status") || p.status === str("status")) &&
      (str("status") === "archived" || !p.archived) &&
      (!since || (p.date && new Date(p.date).getTime() >= since)) &&
      (!str("perf") ||
        (str("perf") === "no_metrics" ? p.status === "published" && p.impressions === null && p.engagementRate === null : p.tier === str("perf"))),
  );

  const sort = str("sort") ?? "date";
  const key: Record<string, (p: LibraryPost) => number> = {
    date: (p) => (p.date ? new Date(p.date).getTime() : 0),
    impressions: (p) => p.impressions ?? -1,
    rate: (p) => p.engagementRate ?? -1,
    clicks: (p) => p.linkClicks ?? -1,
    visits: (p) => p.profileVisits ?? -1,
  };
  posts.sort((a, b) => (key[sort] ?? key.date!)(b) - (key[sort] ?? key.date!)(a));

  const view = str("view") === "cards" ? "cards" : "table";
  const rateNote =
    rated.length >= 8
      ? "Engagement rate = engagements ÷ impressions of the latest snapshot. Top/bottom 25% compares published posts."
      : `Performance tiers appear once 8+ published posts have metrics (${rated.length} so far).`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Content Library"
        description="Every idea, draft and published post — searchable, sortable, and linked to its performance."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/content/import">
                <Upload /> Import
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="/api/export/content" download>
                <Download /> Export
              </a>
            </Button>
            <SaveIdeaButton pillars={pillars} />
            <NewPostButton />
          </>
        }
      />
      <Tabs value={tab}>
        <TabsList>
          <TabsTrigger value="posts" asChild>
            <Link href="/content/library">Posts</Link>
          </TabsTrigger>
          <TabsTrigger value="ideas" asChild>
            <Link href="/content/library?tab=ideas">Saved ideas ({ideas.length})</Link>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="posts" className="mt-3">
          <LibraryView posts={posts} pillars={pillars} view={view} rateNote={rateNote} />
        </TabsContent>
        <TabsContent value="ideas" className="mt-3">
          <IdeasList ideas={ideas} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
