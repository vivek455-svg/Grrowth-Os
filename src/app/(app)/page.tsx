import Link from "next/link";
import { and, count, gte, sql } from "drizzle-orm";
import { ArrowRight, CalendarClock, ExternalLink } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { PlatformBadge, ContentStatusBadge, MetricSourceBadge } from "@/components/app/badges";
import { ParamSelect, RangeFilter } from "@/components/analytics/range-filter";
import { PlatformTrendChart } from "@/components/analytics/charts";
import { InsightList, RecommendationList } from "@/components/analytics/insights-panel";
import { loadForUser } from "@/server/page";
import { dailySeries, loadContentDataset, loadOutreachDataset, upcomingContent, weeklySeries } from "@/server/queries/analytics";
import { getInsights } from "@/server/queries/insights";
import { compareContent, groupPerformance, summarizeContent } from "@/lib/metrics/content";
import { filterEvents, summarizeOutreach } from "@/lib/metrics/outreach";
import { MIN_SAMPLE, parseRange, periodFromRange } from "@/lib/metrics/period";
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import { followUps, outreachCampaigns, prospects } from "@/db/schema";
import { startOfWeek } from "date-fns";
import type { Rate } from "@/lib/metrics/outreach";

export const metadata = { title: "Overview" };

function rateValue(r: Rate) {
  if (r.denominator === 0) return "—";
  return fmtPercent(r.value);
}
function rateFootnote(r: Rate, minLabel?: string) {
  if (r.denominator === 0) return "No contacted prospects in range";
  return `${r.numerator} of ${r.denominator}${r.sufficient ? "" : ` · ${minLabel ?? "small sample"}`}`;
}

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const period = periodFromRange(range, new Date(), { from: sp.from as string, to: sp.to as string });
  const channel = typeof sp.channel === "string" ? (sp.channel as "email" | "linkedin" | "x") : undefined;
  const campaignId = typeof sp.campaign === "string" ? sp.campaign : undefined;
  const segment = typeof sp.segment === "string" ? sp.segment : undefined;

  const data = await loadForUser(async (tx, user) => {
    const content = await loadContentDataset(tx, user.id, period);
    const outreach = await loadOutreachDataset(tx, period);
    const upcoming = await upcomingContent(tx, 14);
    const insights = await getInsights(tx, user.id);
    const campaigns = await tx.select({ id: outreachCampaigns.id, name: outreachCampaigns.name }).from(outreachCampaigns);
    const segments = await tx.selectDistinct({ v: prospects.companyType }).from(prospects).where(sql`${prospects.companyType} is not null`);
    const [newThisWeek] = await tx.select({ n: count() }).from(prospects).where(gte(prospects.createdAt, startOfWeek(new Date(), { weekStartsOn: 1 })));
    const [dueNow] = await tx
      .select({ n: count() })
      .from(followUps)
      .where(and(sql`${followUps.status} = 'pending'`, sql`${followUps.dueAt} <= now()::date + interval '1 day'`));
    return { content, outreach, upcoming, insights, campaigns, segments: segments.map((s) => s.v!), newThisWeek: newThisWeek!.n, dueNow: dueNow!.n };
  });

  const { content, outreach } = data;
  const cmp = compareContent(content.perf, period, content.audience, content.denominator);
  const cur = cmp.current;
  const spanDays = Math.round((period.end.getTime() - period.start.getTime()) / 86400000);
  const trend = spanDays > 45 ? weeklySeries(content.perf, period) : dailySeries(content.perf, period);
  const platformRows = (["linkedin", "x"] as const).map((p) => {
    const rows = content.perf.filter((r) => r.post.platform === p);
    const s = summarizeContent(rows, period, content.audience, content.denominator);
    const g = groupPerformance(rows.filter((r) => r.post.publishedAt && r.post.publishedAt >= period.start && r.post.publishedAt <= period.end), () => p)[0];
    return { platform: p, s, median: g?.medianRate ?? null, n: g?.postsWithRate ?? 0 };
  });

  const segmentIds = segment
    ? new Set([...outreach.prospectSegments.entries()].filter(([, v]) => v.companyType === segment).map(([k]) => k))
    : undefined;
  const events = filterEvents(outreach.events, { channel, campaignId, prospectIds: segmentIds });
  const opps = outreach.opportunities.filter(
    (o) => (!segmentIds || (o.prospectId && segmentIds.has(o.prospectId))) && (!campaignId || o.outreachCampaignId === campaignId),
  );
  const o = summarizeOutreach({ events, opportunities: opps, followUps: outreach.followUps, period });

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const publishedThisWeek = content.perf.filter((r) => r.post.publishedAt && r.post.publishedAt >= weekStart);
  const best = cur.best;
  const metricsNote =
    cur.postsPublished === 0
      ? "No posts published in this range."
      : `${cur.postsWithMetrics} of ${cur.postsPublished} posts have metrics · sources: ${Object.entries(cur.sources).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description={`${fmtDate(period.start)} – ${fmtDate(period.end)} · compared with the previous ${spanDays + 1} days where data exists`}
        actions={<RangeFilter />}
      />

      {/* Recommendations first: they are the "what do I do today" layer. */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recommended next actions</CardTitle>
            <CardDescription>Computed from your records. Each one shows its reasoning and data.</CardDescription>
          </CardHeader>
          <CardContent>
            <RecommendationList items={data.insights.recommendations} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Content insights · last 90 days</CardTitle>
            <CardDescription>Associations in your data, with sample sizes.</CardDescription>
          </CardHeader>
          <CardContent>
            <InsightList items={data.insights.insights.slice(0, 3)} notes={data.insights.notes} />
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Content performance</h2>
            <p className="text-xs text-muted-foreground">{metricsNote}</p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/content/analytics">
              Full analytics <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <StatCard label="Posts published" value={fmtNumber(cur.postsPublished)} change={cmp.deltas.postsPublished.change} />
          <StatCard
            label="Impressions"
            value={fmtNumber(cur.impressions.value, { compact: true })}
            change={cmp.deltas.impressions.change}
            hint="Sum of each post's latest snapshot. X and LinkedIn count impressions differently, so this total mixes two definitions."
            footnote={`${cur.impressions.withData} posts with data`}
          />
          <StatCard
            label="Engagements"
            value={fmtNumber(cur.engagements.value, { compact: true })}
            change={cmp.deltas.engagements.change}
            hint="Likes/reactions + replies/comments + reposts/shares + bookmarks. Link clicks and profile visits are tracked separately."
          />
          <StatCard
            label="Engagement rate"
            value={fmtPercent(cur.engagementRate.value)}
            change={cmp.deltas.engagementRate.change}
            hint={`Σ engagements ÷ Σ ${content.denominator} across posts with both values. Change the denominator in Settings.`}
            footnote={cur.engagementRate.withData < MIN_SAMPLE ? `Only ${cur.engagementRate.withData} posts — low confidence` : `${cur.engagementRate.withData} posts`}
          />
          <StatCard
            label="Profile visits"
            value={fmtNumber(cur.profileVisits.value)}
            muted={cur.profileVisits.value === null}
            footnote={cur.profileVisits.value === null ? "Not available" : `${cur.profileVisits.withData} posts reported`}
          />
          <StatCard
            label="Link clicks"
            value={fmtNumber(cur.linkClicks.value)}
            muted={cur.linkClicks.value === null}
            footnote={cur.linkClicks.value === null ? "Not available" : `${cur.linkClicks.withData} posts reported`}
          />
          <StatCard
            label="Followers gained"
            value={cur.followersGained.value === null ? "—" : `+${fmtNumber(cur.followersGained.value)}`}
            muted={cur.followersGained.value === null}
            hint="Latest follower count in range minus the count at the start. Needs a follower snapshot before and during the range."
            footnote={
              cur.followersGained.value === null
                ? "Record follower counts to track this"
                : `LinkedIn ${cur.followersGained.byPlatform.linkedin ?? "—"} · X ${cur.followersGained.byPlatform.x ?? "—"}`
            }
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Impressions by publication {spanDays > 45 ? "week" : "day"}</CardTitle>
              <CardDescription>Latest snapshot of each post, grouped by when it was published.</CardDescription>
            </CardHeader>
            <CardContent>
              {cur.postsWithMetrics === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">No metrics recorded for posts in this range.</p>
              ) : (
                <PlatformTrendChart data={trend} xKey={spanDays > 45 ? "week" : "date"} />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Best-performing post</CardTitle>
              <CardDescription>Highest engagement rate among posts with at least median reach.</CardDescription>
            </CardHeader>
            <CardContent>
              {best ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <PlatformBadge platform={best.post.platform} />
                    <span className="text-xs text-muted-foreground">{fmtDate(best.post.publishedAt)}</span>
                    <MetricSourceBadge source={best.snapshot?.source} />
                  </div>
                  <Link href={`/content/${best.post.contentItemId}`} className="block text-sm font-medium hover:underline">
                    {(best.post as { title?: string }).title}
                  </Link>
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Impressions</dt>
                      <dd className="num text-sm font-medium">{fmtNumber(best.snapshot?.impressions)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Eng. rate</dt>
                      <dd className="num text-sm font-medium">{fmtPercent(best.engagementRate)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Profile visits</dt>
                      <dd className="num text-sm font-medium">{fmtNumber(best.snapshot?.profileVisits)}</dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No post in this range has metrics yet.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>X vs LinkedIn</CardTitle>
              <CardDescription>Platforms define impressions differently — compare rates, not raw totals.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Platform</TableHead>
                    <TableHead className="text-right">Posts</TableHead>
                    <TableHead className="text-right">Median ER</TableHead>
                    <TableHead className="pr-4 text-right">Visits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {platformRows.map((r) => (
                    <TableRow key={r.platform}>
                      <TableCell className="pl-4"><PlatformBadge platform={r.platform} /></TableCell>
                      <TableCell className="num text-right">{r.s.postsPublished}</TableCell>
                      <TableCell className="num text-right">
                        {fmtPercent(r.median)}
                        {r.n > 0 && r.n < MIN_SAMPLE && <span className="ml-1 text-xs text-muted-foreground">(n={r.n})</span>}
                      </TableCell>
                      <TableCell className="num pr-4 text-right">{fmtNumber(r.s.profileVisits.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Published this week</CardTitle>
              <CardAction>
                <Badge variant="secondary" className="num">{publishedThisWeek.length}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              {publishedThisWeek.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing published since Monday.</p>
              ) : (
                <ul className="space-y-2.5">
                  {publishedThisWeek.slice(0, 6).map((r) => (
                    <li key={r.post.id} className="flex items-center gap-2 text-sm">
                      <PlatformBadge platform={r.post.platform} />
                      <Link href={`/content/${r.post.contentItemId}`} className="min-w-0 flex-1 truncate hover:underline">
                        {r.post.title}
                      </Link>
                      {r.post.platformPostUrl && (
                        <a href={r.post.platformPostUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open published post">
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Upcoming · next 14 days</CardTitle>
              <CardAction>
                <Button asChild variant="ghost" size="xs">
                  <Link href="/content/calendar">Calendar</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {data.upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing planned. Add a post to keep your publishing habit.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.upcoming.slice(0, 6).map((u) => (
                    <li key={u.id} className="flex items-center gap-2 text-sm">
                      <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="num w-24 shrink-0 text-xs text-muted-foreground">{fmtDateTime(u.plannedAt).replace(/, \d{4}/, "")}</span>
                      <Link href={`/content/${u.contentItemId}`} className="min-w-0 flex-1 truncate hover:underline">
                        {u.title}
                      </Link>
                      {!u.body.trim() ? <Badge variant="outline" className="border-dashed text-warning">Missing copy</Badge> : <ContentStatusBadge status={u.status} />}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Outreach performance</h2>
            <p className="text-xs text-muted-foreground">
              Cohort: unique prospects successfully contacted in range. Replies are counted once per prospect.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ParamSelect param="channel" placeholder="All channels" className="w-36" options={[{ value: "email", label: "Email" }, { value: "linkedin", label: "LinkedIn" }, { value: "x", label: "X" }]} />
            <ParamSelect param="campaign" placeholder="All campaigns" className="w-44" options={data.campaigns.map((c) => ({ value: c.id, label: c.name }))} />
            <ParamSelect param="segment" placeholder="All segments" className="w-40" options={data.segments.map((s) => ({ value: s, label: s }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <StatCard label="Total prospects" value={fmtNumber(outreach.totalProspects)} footnote={`${data.newThisWeek} new this week`} />
          <StatCard label="Messages sent" value={fmtNumber(o.messagesSent)} footnote={o.failedOrBounced ? `${o.failedOrBounced} failed or bounced (excluded)` : `${o.contacted} prospects contacted`} />
          <StatCard label="Reply rate" value={rateValue(o.replyRate)} footnote={rateFootnote(o.replyRate)} hint="Unique prospects who replied after first contact ÷ unique prospects successfully contacted in range." />
          <StatCard label="Positive-reply rate" value={rateValue(o.positiveReplyRate)} footnote={rateFootnote(o.positiveReplyRate)} hint="Prospects with a reply you classified as positive ÷ prospects contacted. Unclassified replies don't count as positive." />
          <StatCard label="Follow-ups due" value={fmtNumber(data.dueNow)} footnote={<Link href="/follow-ups" className="underline-offset-2 hover:underline">Open follow-ups</Link>} />
          <StatCard label="Calls booked" value={fmtNumber(o.callsBooked)} footnote={rateFootnote(o.meetingRate)} hint="Unique prospects with a 'call booked' entry in range. Footnote: share of the contacted cohort." />
          <StatCard label="Replies" value={fmtNumber(o.replied)} footnote={`${o.positive} positive`} />
          <StatCard label="Qualified opportunities" value={fmtNumber(o.qualifiedOpportunities)} footnote="Created in range, not lost" />
          <StatCard label="Projects won" value={fmtNumber(o.won)} footnote={o.wonValueCents ? fmtMoney(o.wonValueCents) : "Closed won in range"} />
          <StatCard
            label="Lead-to-client"
            value={o.leadToClient.sufficient ? fmtPercent(o.leadToClient.value) : "—"}
            muted={!o.leadToClient.sufficient}
            footnote={o.leadToClient.sufficient ? rateFootnote(o.leadToClient) : `Needs 20+ contacted prospects (have ${o.contacted})`}
            hint="Contacted prospects who became won projects ÷ contacted prospects. Shown only with at least 20 contacted prospects."
          />
          <StatCard label="Follow-up completion" value={rateValue(o.followUpCompletion)} footnote={o.followUpCompletion.denominator ? `${o.followUpCompletion.numerator} of ${o.followUpCompletion.denominator} due` : "None due in range"} />
          <StatCard label="Qualified-opportunity rate" value={rateValue(o.qualifiedOpportunityRate)} footnote={rateFootnote(o.qualifiedOpportunityRate)} />
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Metrics are calculated only from recorded data. “—” means not available; nothing is estimated unless labelled. Formulas: hover the info icons or see{" "}
        <Link href="/reports#definitions" className="underline underline-offset-2">metric definitions</Link>.
      </p>
    </div>
  );
}
