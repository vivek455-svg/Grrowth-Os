import Link from "next/link";
import { inArray } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { PlatformBadge } from "@/components/app/badges";
import { ParamSelect, RangeFilter } from "@/components/analytics/range-filter";
import { FollowerChart, GroupRateChart, PlatformTrendChart } from "@/components/analytics/charts";
import { InsightList } from "@/components/analytics/insights-panel";
import { RecordFollowersButton } from "@/components/analytics/record-followers";
import { loadForUser } from "@/server/page";
import { dailySeries, loadContentDataset, weeklySeries, type ContentDataset } from "@/server/queries/analytics";
import { getInsights } from "@/server/queries/insights";
import { compareContent, groupPerformance, lengthBucket, median, type GroupStat } from "@/lib/metrics/content";
import { MIN_SAMPLE, parseRange, periodFromRange } from "@/lib/metrics/period";
import { fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
import { CTA_TYPE_LABEL, FORMAT_LABEL, HOOK_LABEL } from "@/lib/labels";
import { contentPillars, opportunities, opportunityTouchpoints, type ContentFormat, type CtaType, type HookStyle } from "@/db/schema";

export const metadata = { title: "Content Analytics" };

type Row = ContentDataset["perf"][number];

function TopTable({ rows, metric, label }: { rows: Row[]; metric: (r: Row) => number | null; label: string }) {
  const list = rows.filter((r) => metric(r) !== null).sort((a, b) => metric(b)! - metric(a)!).slice(0, 5);
  if (!list.length) return <p className="px-4 py-6 text-center text-sm text-muted-foreground">No posts with this metric in range.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Post</TableHead>
          <TableHead className="hidden sm:table-cell">Published</TableHead>
          <TableHead className="pr-4 text-right">{label}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((r) => (
          <TableRow key={r.post.id}>
            <TableCell className="max-w-72 pl-4">
              <div className="flex items-center gap-2">
                <PlatformBadge platform={r.post.platform} />
                <Link href={`/content/${r.post.contentItemId}?v=${r.post.id}`} className="truncate hover:underline">
                  {r.post.title}
                </Link>
                {r.post.platformPostUrl && (
                  <a href={r.post.platformPostUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open post">
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            </TableCell>
            <TableCell className="num hidden text-muted-foreground sm:table-cell">{fmtDate(r.post.publishedAt, "MMM d")}</TableCell>
            <TableCell className="num pr-4 text-right font-medium">{label.includes("rate") ? fmtPercent(metric(r)) : fmtNumber(metric(r))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Breakdown({ title, groups, name }: { title: string; groups: GroupStat[]; name: (k: string) => string }) {
  const data = groups.map((g) => ({ label: name(g.key), rate: g.medianRate, posts: g.postsWithRate, sufficient: g.sufficient }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Median engagement rate. Faded bars have fewer than {MIN_SAMPLE} posts — treat as anecdotal.</CardDescription>
      </CardHeader>
      <CardContent>
        {data.filter((d) => d.rate !== null).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Not enough data yet.</p>
        ) : (
          <Tabs defaultValue="chart">
            <TabsList className="mb-2">
              <TabsTrigger value="chart">Chart</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
            </TabsList>
            <TabsContent value="chart">
              <GroupRateChart data={data} />
            </TabsContent>
            <TabsContent value="table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead className="text-right">Posts</TableHead>
                    <TableHead className="text-right">Median ER</TableHead>
                    <TableHead className="text-right">Impressions</TableHead>
                    <TableHead className="text-right">Visits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <TableRow key={g.key}>
                      <TableCell>{name(g.key)}</TableCell>
                      <TableCell className="num text-right">{g.posts}</TableCell>
                      <TableCell className="num text-right">{fmtPercent(g.medianRate)}</TableCell>
                      <TableCell className="num text-right">{fmtNumber(g.impressions, { compact: true })}</TableCell>
                      <TableCell className="num text-right">{fmtNumber(g.profileVisits)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

export default async function ContentAnalyticsPage({ searchParams }: PageProps<"/content/analytics">) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const period = periodFromRange(range, new Date(), { from: sp.from as string, to: sp.to as string });
  const platform = sp.platform === "x" || sp.platform === "linkedin" ? sp.platform : null;

  const data = await loadForUser(async (tx, user) => {
    const content = await loadContentDataset(tx, user.id, period);
    const insights = await getInsights(tx, user.id);
    const pillars = await tx.select({ id: contentPillars.id, name: contentPillars.name }).from(contentPillars);
    const ids = content.posts.map((p) => p.contentItemId);
    const leadLinks = ids.length
      ? await tx
          .selectDistinct({ contentItemId: opportunityTouchpoints.contentItemId, opportunityId: opportunityTouchpoints.opportunityId })
          .from(opportunityTouchpoints)
          .where(inArray(opportunityTouchpoints.contentItemId, ids))
      : [];
    const directLinks = ids.length
      ? await tx.select({ contentItemId: opportunities.contentItemId, opportunityId: opportunities.id }).from(opportunities).where(inArray(opportunities.contentItemId, ids))
      : [];
    return { content, insights, pillars, leadLinks: [...leadLinks, ...directLinks] };
  });

  const { content } = data;
  const all = platform ? content.perf.filter((r) => r.post.platform === platform) : content.perf;
  const inRange = all.filter((r) => r.post.publishedAt && r.post.publishedAt >= period.start && r.post.publishedAt <= period.end);
  const cmp = compareContent(all, period, content.audience, content.denominator);
  const cur = cmp.current;
  const spanDays = Math.round((period.end.getTime() - period.start.getTime()) / 86400000);
  const pillarName = new Map(data.pillars.map((p) => [p.id, p.name]));
  const leadsByItem = new Map<string, Set<string>>();
  for (const l of data.leadLinks) if (l.contentItemId) leadsByItem.set(l.contentItemId, (leadsByItem.get(l.contentItemId) ?? new Set()).add(l.opportunityId));

  const imprMedian = median(inRange.map((r) => r.snapshot?.impressions).filter((v): v is number => v != null)) ?? 0;
  const missingMetrics = inRange.filter((r) => !r.snapshot).length;

  // Follower series for the chart: one point per snapshot date.
  const followerRows = new Map<string, { date: string; linkedin: number | null; x: number | null }>();
  for (const a of content.audience) {
    if (a.capturedAt < period.start || a.capturedAt > period.end) continue;
    const key = a.capturedAt.toISOString().slice(0, 10);
    const row = followerRows.get(key) ?? { date: key, linkedin: null, x: null };
    row[a.platform] = a.followers;
    followerRows.set(key, row);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content Analytics"
        description="What your posts did, with sample sizes. Correlation is not causation — use these as prompts for experiments."
        actions={
          <>
            <ParamSelect param="platform" placeholder="Both platforms" className="w-36" options={[{ value: "linkedin", label: "LinkedIn" }, { value: "x", label: "X" }]} />
            <RangeFilter />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Posts published" value={fmtNumber(cur.postsPublished)} change={cmp.deltas.postsPublished.change} footnote={`${cur.postsWithMetrics} with metrics`} />
        <StatCard label="Impressions" value={fmtNumber(cur.impressions.value, { compact: true })} change={cmp.deltas.impressions.change} hint="Latest snapshot per post. X and LinkedIn define impressions differently." />
        <StatCard label="Engagements" value={fmtNumber(cur.engagements.value, { compact: true })} change={cmp.deltas.engagements.change} />
        <StatCard
          label="Engagement rate"
          value={fmtPercent(cur.engagementRate.value)}
          change={cmp.deltas.engagementRate.change}
          hint={`Σ engagements ÷ Σ ${content.denominator}. Engagements = reactions + replies + reposts + bookmarks.`}
          footnote={cur.engagementRate.sufficient ? `${cur.engagementRate.withData} posts` : `Low confidence (n=${cur.engagementRate.withData})`}
        />
        <StatCard label="Profile visits" value={fmtNumber(cur.profileVisits.value)} muted={cur.profileVisits.value === null} footnote={cur.profileVisits.value === null ? "Not available" : `${cur.profileVisits.withData} posts reported`} />
        <StatCard label="Link clicks" value={fmtNumber(cur.linkClicks.value)} muted={cur.linkClicks.value === null} footnote={cur.linkClicks.value === null ? "Not available" : `${cur.linkClicks.withData} posts reported`} />
      </div>

      {missingMetrics > 0 && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          {missingMetrics} published post{missingMetrics === 1 ? " has" : "s have"} no metrics in this range and {missingMetrics === 1 ? "is" : "are"} excluded from rates.{" "}
          <Link href="/content/library?perf=no_metrics" className="font-medium text-foreground underline underline-offset-2">Add metrics</Link>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Impressions over time</CardTitle>
            <CardDescription>By publication {spanDays > 45 ? "week" : "day"}.</CardDescription>
          </CardHeader>
          <CardContent>
            <PlatformTrendChart data={spanDays > 45 ? weeklySeries(all, period) : dailySeries(all, period)} xKey={spanDays > 45 ? "week" : "date"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Followers</CardTitle>
            <CardDescription>From recorded follower counts.</CardDescription>
            <CardAction>
              <RecordFollowersButton />
            </CardAction>
          </CardHeader>
          <CardContent>
            {followerRows.size < 2 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Record follower counts over time to see growth.</p>
            ) : (
              <FollowerChart data={[...followerRows.values()]} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-2">
          <CardHeader>
            <CardTitle>Top posts</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Tabs defaultValue="impr">
              <TabsList className="mx-4">
                <TabsTrigger value="impr">Impressions</TabsTrigger>
                <TabsTrigger value="rate">Engagement rate</TabsTrigger>
                <TabsTrigger value="replies">Meaningful replies</TabsTrigger>
              </TabsList>
              <TabsContent value="impr">
                <TopTable rows={inRange} metric={(r) => r.snapshot?.impressions ?? null} label="Impressions" />
              </TabsContent>
              <TabsContent value="rate">
                <TopTable rows={inRange.filter((r) => (r.snapshot?.impressions ?? 0) >= imprMedian)} metric={(r) => r.engagementRate} label="Eng. rate" />
                <p className="px-4 pt-2 text-xs text-muted-foreground">Only posts with at least median reach ({fmtNumber(imprMedian)} impressions), so tiny posts don't dominate.</p>
              </TabsContent>
              <TabsContent value="replies">
                <TopTable rows={inRange} metric={(r) => r.snapshot?.meaningfulReplies ?? null} label="Meaningful replies" />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <Card className="gap-2">
          <CardHeader>
            <CardTitle>Intent signals</CardTitle>
            <CardDescription>Posts that moved people toward you — better client signals than likes.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Tabs defaultValue="visits">
              <TabsList className="mx-4">
                <TabsTrigger value="visits">Profile visits</TabsTrigger>
                <TabsTrigger value="clicks">Link clicks</TabsTrigger>
                <TabsTrigger value="leads">Linked to leads</TabsTrigger>
              </TabsList>
              <TabsContent value="visits">
                <TopTable rows={inRange} metric={(r) => r.snapshot?.profileVisits ?? null} label="Profile visits" />
              </TabsContent>
              <TabsContent value="clicks">
                <TopTable rows={inRange} metric={(r) => r.snapshot?.linkClicks ?? null} label="Link clicks" />
              </TabsContent>
              <TabsContent value="leads">
                <TopTable rows={all} metric={(r) => leadsByItem.get(r.post.contentItemId)?.size ?? null} label="Opportunities" />
                <p className="px-4 pt-2 text-xs text-muted-foreground">Based on opportunities where you recorded the post as a touchpoint. Attribution, not causation.</p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">What tends to work · {fmtDate(period.start)} – {fmtDate(period.end)}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown title="By content pillar" groups={groupPerformance(inRange, (r) => r.post.pillarId)} name={(k) => pillarName.get(k) ?? "Unknown"} />
          <Breakdown title="By format" groups={groupPerformance(inRange, (r) => r.post.format)} name={(k) => FORMAT_LABEL[k as ContentFormat] ?? k} />
          <Breakdown title="By hook style" groups={groupPerformance(inRange, (r) => r.post.hookStyle)} name={(k) => HOOK_LABEL[k as HookStyle] ?? k} />
          <Breakdown title="By CTA type" groups={groupPerformance(inRange, (r) => r.post.ctaType)} name={(k) => CTA_TYPE_LABEL[k as CtaType] ?? k} />
          <Breakdown title="By post length" groups={groupPerformance(inRange, (r) => lengthBucket(r.post.body))} name={(k) => k} />
          <Card>
            <CardHeader>
              <CardTitle>Content insights · last 90 days</CardTitle>
              <CardDescription>Reported only when a difference is at least 25% and both sides have {MIN_SAMPLE}+ posts.</CardDescription>
            </CardHeader>
            <CardContent>
              <InsightList items={data.insights.insights} notes={data.insights.notes} />
            </CardContent>
          </Card>
        </div>
      </section>

      <Card size="sm" id="definitions">
        <CardHeader>
          <CardTitle>How these numbers are calculated</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
          <p><span className="font-medium text-foreground">Engagements</span> = reactions/likes + replies/comments + reposts/shares + bookmarks, from the latest snapshot.</p>
          <p><span className="font-medium text-foreground">Engagement rate</span> = engagements ÷ {content.denominator === "impressions" ? "impressions" : "followers at publication"} (change in Settings).</p>
          <p><span className="font-medium text-foreground">Missing values</span> are never treated as zero. A post without a metric is excluded from that metric.</p>
          <p><span className="font-medium text-foreground">Platform comparison</span>: X and LinkedIn count impressions differently; compare rates within a platform first.</p>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href="/reports">Open reports</Link>
        </Button>
      </div>
    </div>
  );
}
