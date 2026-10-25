import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { RangeFilter } from "@/components/analytics/range-filter";
import { FunnelChart, PlatformTrendChart } from "@/components/analytics/charts";
import { PrintButton } from "@/components/analytics/print-button";
import { loadForUser } from "@/server/page";
import { loadContentDataset, loadOutreachDataset, weeklySeries } from "@/server/queries/analytics";
import { campaignStats, pipeline } from "@/server/queries/outreach";
import { compareContent, groupPerformance } from "@/lib/metrics/content";
import { filterEvents, summarizeOutreach } from "@/lib/metrics/outreach";
import { MIN_SAMPLE, parseRange, periodFromRange } from "@/lib/metrics/period";
import { fmtDate, fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import { CHANNEL_LABEL, SOURCE_CHANNEL_LABEL } from "@/lib/labels";
import type { SourceChannel } from "@/db/schema";

export const metadata = { title: "Reports" };

const DEFINITIONS: [string, string][] = [
  ["Engagements", "Reactions/likes + replies/comments + reposts/shares + bookmarks, from each post's latest metrics snapshot. Missing values are excluded, never treated as zero."],
  ["Engagement rate", "Σ engagements ÷ Σ impressions (or followers at publication, if chosen in Settings) across posts that have both values."],
  ["Reply rate", "Unique prospects who replied after their first contact ÷ unique prospects successfully contacted in the period. Multiple replies from one person count once; failed or bounced sends are excluded."],
  ["Positive-reply rate", "Prospects with at least one reply you classified as positive ÷ prospects successfully contacted. Unclassified replies don't count as positive."],
  ["Meeting-booking rate", "Contacted prospects with a ‘call booked’ entry in the period ÷ prospects contacted."],
  ["Qualified-opportunity rate", "Contacted prospects with any opportunity ÷ prospects contacted."],
  ["Won-project rate", "Contacted prospects with a won opportunity ÷ prospects contacted."],
  ["Follow-up completion rate", "Follow-ups marked done ÷ follow-ups that came due in the period (cancelled ones excluded)."],
  ["Lead-to-client", "Won ÷ contacted, shown only with 20+ contacted prospects."],
  ["Previous period", "The same number of days immediately before the selected range. Comparisons are hidden when the previous period has no data."],
  ["Sample size", `Rates with fewer than ${MIN_SAMPLE} observations are flagged as low confidence. Patterns need ${MIN_SAMPLE}+ posts in each group and a 25%+ difference.`],
  ["Attribution", "Opportunities are credited to every touchpoint you recorded. Attribution shows association, not proof that a post or campaign caused a deal."],
];

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const sp = await searchParams;
  const range = parseRange(sp.range ?? "90d");
  const period = periodFromRange(range, new Date(), { from: sp.from as string, to: sp.to as string });

  const d = await loadForUser(async (tx, user) => ({
    content: await loadContentDataset(tx, user.id, period),
    outreach: await loadOutreachDataset(tx, period),
    campaigns: await campaignStats(tx),
    pipe: await pipeline(tx),
  }));
  const c = compareContent(d.content.perf, period, d.content.audience, d.content.denominator).current;
  const o = summarizeOutreach({ events: d.outreach.events, opportunities: d.outreach.opportunities, followUps: d.outreach.followUps, period });
  const inRange = d.content.perf.filter((r) => r.post.publishedAt && r.post.publishedAt >= period.start && r.post.publishedAt <= period.end);
  const pillars = groupPerformance(inRange, (r) => r.post.pillarName);
  const byChannel = (["email", "linkedin", "x"] as const).map((ch) => ({ ch, s: summarizeOutreach({ events: filterEvents(d.outreach.events, { channel: ch }), opportunities: [], followUps: [], period }) }));

  const stageKind = new Map(d.pipe.stages.map((s) => [s.key, s.kind]));
  const attribution = new Map<SourceChannel, { opps: Set<string>; won: Set<string>; wonValue: number }>();
  for (const { t } of d.pipe.touchpoints) {
    const opp = d.pipe.rows.find((r) => r.o.id === t.opportunityId)?.o;
    if (!opp) continue;
    const a = attribution.get(t.kind) ?? { opps: new Set(), won: new Set(), wonValue: 0 };
    a.opps.add(opp.id);
    if (stageKind.get(opp.stage) === "won" && !a.won.has(opp.id)) {
      a.won.add(opp.id);
      if (opp.currency === "USD") a.wonValue += opp.valueCents ?? 0;
    }
    attribution.set(t.kind, a);
  }
  const weeks = weeklySeries(d.content.perf, period);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`${fmtDate(period.start)} – ${fmtDate(period.end)} · every figure is computed from recorded data`}
        actions={
          <>
            <RangeFilter />
            <PrintButton />
          </>
        }
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Content</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Posts published" value={fmtNumber(c.postsPublished)} footnote={`${c.postsWithMetrics} with metrics`} />
          <StatCard label="Impressions" value={fmtNumber(c.impressions.value, { compact: true })} />
          <StatCard label="Engagement rate" value={fmtPercent(c.engagementRate.value)} footnote={c.engagementRate.sufficient ? `${c.engagementRate.withData} posts` : "Low confidence"} />
          <StatCard label="Profile visits" value={fmtNumber(c.profileVisits.value)} />
          <StatCard label="Followers gained" value={c.followersGained.value === null ? "—" : `+${fmtNumber(c.followersGained.value)}`} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Weekly impressions</CardTitle>
              <CardDescription>By publication week and platform.</CardDescription>
            </CardHeader>
            <CardContent>
              <PlatformTrendChart data={weeks} xKey="week" />
            </CardContent>
          </Card>
          <Card className="gap-2">
            <CardHeader>
              <CardTitle>Pillars</CardTitle>
              <CardDescription>Posting frequency and median engagement rate.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Pillar</TableHead>
                    <TableHead className="text-right">Posts</TableHead>
                    <TableHead className="text-right">Median ER</TableHead>
                    <TableHead className="pr-4 text-right">Profile visits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pillars.map((g) => (
                    <TableRow key={g.key}>
                      <TableCell className="pl-4">{g.key}</TableCell>
                      <TableCell className="num text-right">{g.posts}</TableCell>
                      <TableCell className="num text-right">{fmtPercent(g.medianRate)}{!g.sufficient && <span className="ml-1 text-xs text-muted-foreground">(n={g.postsWithRate})</span>}</TableCell>
                      <TableCell className="num pr-4 text-right">{fmtNumber(g.profileVisits)}</TableCell>
                    </TableRow>
                  ))}
                  {pillars.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No posts with pillars in this range.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Outreach</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Funnel</CardTitle>
              <CardDescription>Unique prospects at each step, for prospects contacted in this range.</CardDescription>
            </CardHeader>
            <CardContent>
              <FunnelChart
                data={[
                  { stage: "Contacted", value: o.contacted },
                  { stage: "Replied", value: o.replied },
                  { stage: "Positive reply", value: o.positive },
                  { stage: "Call booked", value: o.meetingRate.numerator },
                  { stage: "Opportunity", value: o.qualifiedOpportunityRate.numerator },
                  { stage: "Won", value: o.wonRate.numerator },
                ]}
              />
            </CardContent>
          </Card>
          <Card className="gap-2">
            <CardHeader>
              <CardTitle>By channel</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Channel</TableHead>
                    <TableHead className="text-right">Contacted</TableHead>
                    <TableHead className="text-right">Reply rate</TableHead>
                    <TableHead className="pr-4 text-right">Positive</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byChannel.map(({ ch, s }) => (
                    <TableRow key={ch}>
                      <TableCell className="pl-4">{CHANNEL_LABEL[ch]}</TableCell>
                      <TableCell className="num text-right">{s.contacted}</TableCell>
                      <TableCell className="num text-right">{s.contacted ? fmtPercent(s.replyRate.value) : "—"}</TableCell>
                      <TableCell className="num pr-4 text-right">{s.contacted ? fmtPercent(s.positiveReplyRate.value) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="px-4 pt-3 text-xs text-muted-foreground">Rates with fewer than {MIN_SAMPLE} contacted prospects are anecdotal.</p>
            </CardContent>
          </Card>
        </div>
        <Card className="gap-2">
          <CardHeader>
            <CardTitle>Campaigns (all time)</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Campaign</TableHead>
                  <TableHead className="text-right">Contacted</TableHead>
                  <TableHead className="text-right">Reply rate</TableHead>
                  <TableHead className="text-right">Positive</TableHead>
                  <TableHead className="text-right">Meetings</TableHead>
                  <TableHead className="pr-4 text-right">Won</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.campaigns.map(({ c: camp, s }) => (
                  <TableRow key={camp.id}>
                    <TableCell className="pl-4">{camp.name}</TableCell>
                    <TableCell className="num text-right">{s.contacted}</TableCell>
                    <TableCell className="num text-right">{s.contacted ? fmtPercent(s.replyRate.value) : "—"}</TableCell>
                    <TableCell className="num text-right">{s.contacted ? fmtPercent(s.positiveReplyRate.value) : "—"}</TableCell>
                    <TableCell className="num text-right">{s.callsBooked}</TableCell>
                    <TableCell className="num pr-4 text-right">{s.won}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">What contributed to opportunities</h2>
        <Card className="gap-2">
          <CardHeader>
            <CardDescription>Each opportunity is credited to every touchpoint you recorded. This shows association, not causation.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Touchpoint</TableHead>
                  <TableHead className="text-right">Opportunities</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                  <TableHead className="pr-4 text-right">Won value (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...attribution.entries()].map(([k, a]) => (
                  <TableRow key={k}>
                    <TableCell className="pl-4">{SOURCE_CHANNEL_LABEL[k]}</TableCell>
                    <TableCell className="num text-right">{a.opps.size}</TableCell>
                    <TableCell className="num text-right">{a.won.size}</TableCell>
                    <TableCell className="num pr-4 text-right">{fmtMoney(a.wonValue)}</TableCell>
                  </TableRow>
                ))}
                {attribution.size === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No touchpoints recorded yet. Add them on an opportunity.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <Card id="definitions">
        <CardHeader>
          <CardTitle>Metric definitions</CardTitle>
          <CardDescription>Used consistently across the dashboard, analytics, campaigns and the assistant.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {DEFINITIONS.map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm font-medium">{k}</dt>
                <dd className="text-sm text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
