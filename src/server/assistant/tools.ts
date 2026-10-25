import "server-only";
import { and, asc, eq, gte, ilike, isNull, lte, notInArray, sql } from "drizzle-orm";
import { endOfDay } from "date-fns";
import type { Tx } from "@/db/client";
import { contentPlatformVersions, contentItems, followUps, leadStatuses, prospects } from "@/db/schema";
import type { AIToolDef } from "@/server/ai/types";
import { loadContentDataset, loadOutreachDataset } from "@/server/queries/analytics";
import { campaignStats, pipeline } from "@/server/queries/outreach";
import { getInsights } from "@/server/queries/insights";
import { compareContent, groupPerformance } from "@/lib/metrics/content";
import { filterEvents, summarizeOutreach } from "@/lib/metrics/outreach";
import { periodFromRange, type RangeKey } from "@/lib/metrics/period";

/**
 * Read-only data tools for the Growth Assistant. Every tool returns JSON that includes the
 * period it covers, so answers can cite their data. None of them can change data or send anything.
 */
const range = { type: "string", enum: ["7d", "30d", "90d"], description: "Date range" };
const nullableString = (description: string) => ({ anyOf: [{ type: "string" }, { type: "null" }], description });

export const ASSISTANT_TOOLS: AIToolDef[] = [
  {
    name: "content_summary",
    description: "Content totals for a period (posts, impressions, engagements, engagement rate, profile visits, link clicks, followers gained) with comparison to the previous period and the best post.",
    inputSchema: { type: "object", properties: { range }, required: ["range"], additionalProperties: false },
  },
  {
    name: "top_posts",
    description: "Top published posts in a period by a metric. Returns title, platform, date, metric value, post id and text excerpt.",
    inputSchema: {
      type: "object",
      properties: { range, metric: { type: "string", enum: ["impressions", "engagement_rate", "profile_visits", "link_clicks", "meaningful_replies"] }, limit: { type: "integer", description: "1–10" } },
      required: ["range", "metric", "limit"],
      additionalProperties: false,
    },
  },
  {
    name: "performance_breakdown",
    description: "Median engagement rate and sample size grouped by pillar, format, hook style, or CTA type for a period.",
    inputSchema: { type: "object", properties: { range, by: { type: "string", enum: ["pillar", "format", "hook_style", "cta_type"] } }, required: ["range", "by"], additionalProperties: false },
  },
  {
    name: "get_post",
    description: "Full text and metadata of one post version by id (from top_posts).",
    inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"], additionalProperties: false },
  },
  {
    name: "outreach_summary",
    description: "Outreach funnel for a period: contacted, replies, positive replies, calls, opportunities, won, with rates and sample sizes. Optional channel filter.",
    inputSchema: { type: "object", properties: { range, channel: { anyOf: [{ type: "string", enum: ["email", "linkedin", "x"] }, { type: "null" }], description: "Channel filter or null for all" } }, required: ["range", "channel"], additionalProperties: false },
  },
  {
    name: "campaign_performance",
    description: "All outreach campaigns with contacted count, reply rate, positive-reply rate, meetings, opportunities and wins (all time).",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "list_prospects",
    description: "Find prospects. Use uncontacted=true for people never contacted. Returns up to `limit` rows with id, name, company, status, fit score, last contacted.",
    inputSchema: {
      type: "object",
      properties: {
        status: nullableString("Lead status key, e.g. new, ready, contacted, interested"),
        min_fit: { anyOf: [{ type: "integer" }, { type: "null" }], description: "Minimum fit score 0–100" },
        uncontacted: { type: "boolean" },
        company_type: nullableString("Substring match on company type, e.g. SaaS or agency"),
        limit: { type: "integer", description: "1–25" },
      },
      required: ["status", "min_fit", "uncontacted", "company_type", "limit"],
      additionalProperties: false,
    },
  },
  {
    name: "follow_ups_due",
    description: "Pending follow-ups due today or overdue, with prospect and reason.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "pipeline_summary",
    description: "Opportunities by stage with counts and recorded values, plus stale open opportunities.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "insights",
    description: "Current evidence-based content insights and recommended next actions, each with sample sizes.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

const r2 = (n: number | null) => (n === null ? null : Math.round(n * 10000) / 10000);

export async function executeTool(tx: Tx, userId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
  const rk = (input.range as RangeKey) ?? "30d";
  const period = periodFromRange(rk);
  const periodInfo = { range: rk, from: period.start.toISOString().slice(0, 10), to: period.end.toISOString().slice(0, 10) };

  switch (name) {
    case "content_summary": {
      const ds = await loadContentDataset(tx, userId, period);
      const c = compareContent(ds.perf, period, ds.audience, ds.denominator);
      const best = c.current.best;
      return {
        period: periodInfo,
        engagementRateDefinition: `engagements ÷ ${ds.denominator}`,
        current: {
          postsPublished: c.current.postsPublished,
          postsWithMetrics: c.current.postsWithMetrics,
          impressions: c.current.impressions.value,
          engagements: c.current.engagements.value,
          engagementRate: r2(c.current.engagementRate.value),
          engagementRateSampleSufficient: c.current.engagementRate.sufficient,
          profileVisits: c.current.profileVisits.value,
          linkClicks: c.current.linkClicks.value,
          followersGained: c.current.followersGained.value,
        },
        previousPeriodComparable: c.previous !== null,
        changes: Object.fromEntries(Object.entries(c.deltas).map(([k, d]) => [k, r2(d.change)])),
        bestPost: best ? { id: best.post.id, title: (best.post as { title?: string }).title, platform: best.post.platform, engagementRate: r2(best.engagementRate), impressions: best.snapshot?.impressions } : null,
      };
    }
    case "top_posts": {
      const ds = await loadContentDataset(tx, userId, period);
      const rows = ds.perf.filter((r) => r.post.publishedAt && r.post.publishedAt >= period.start);
      const metric = input.metric as string;
      const val = (r: (typeof rows)[number]) =>
        metric === "impressions" ? r.snapshot?.impressions : metric === "engagement_rate" ? r.engagementRate : metric === "profile_visits" ? r.snapshot?.profileVisits : metric === "link_clicks" ? r.snapshot?.linkClicks : r.snapshot?.meaningfulReplies;
      return {
        period: periodInfo,
        metric,
        posts: rows
          .filter((r) => val(r) != null)
          .sort((a, b) => (val(b) ?? 0) - (val(a) ?? 0))
          .slice(0, Math.min(Math.max(Number(input.limit) || 5, 1), 10))
          .map((r) => ({ id: r.post.id, contentItemId: r.post.contentItemId, title: r.post.title, platform: r.post.platform, publishedAt: r.post.publishedAt?.toISOString().slice(0, 10), value: metric === "engagement_rate" ? r2(val(r) ?? null) : val(r), pillar: r.post.pillarName, excerpt: r.post.body.slice(0, 200) })),
      };
    }
    case "performance_breakdown": {
      const ds = await loadContentDataset(tx, userId, period);
      const rows = ds.perf.filter((r) => r.post.publishedAt && r.post.publishedAt >= period.start);
      const by = input.by as string;
      const key = (r: (typeof rows)[number]) => (by === "pillar" ? r.post.pillarName : by === "format" ? r.post.format : by === "hook_style" ? r.post.hookStyle : r.post.ctaType);
      return { period: periodInfo, by, minimumSampleForReliableComparison: 5, groups: groupPerformance(rows, key).map((g) => ({ group: g.key, posts: g.postsWithRate, medianEngagementRate: r2(g.medianRate), sufficientSample: g.sufficient })) };
    }
    case "get_post": {
      const id = String(input.post_id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "invalid id" };
      const [v] = await tx
        .select({ id: contentPlatformVersions.id, title: contentItems.title, platform: contentPlatformVersions.platform, body: contentPlatformVersions.body, status: contentPlatformVersions.status, publishedAt: contentPlatformVersions.publishedAt, contentItemId: contentItems.id })
        .from(contentPlatformVersions)
        .innerJoin(contentItems, eq(contentItems.id, contentPlatformVersions.contentItemId))
        .where(eq(contentPlatformVersions.id, id));
      return v ?? { error: "not found" };
    }
    case "outreach_summary": {
      const data = await loadOutreachDataset(tx, period);
      const events = filterEvents(data.events, { channel: (input.channel as "email") ?? undefined });
      const s = summarizeOutreach({ events, opportunities: data.opportunities, followUps: data.followUps, period });
      const rate = (x: { value: number | null; numerator: number; denominator: number; sufficient: boolean }) => ({ value: r2(x.value), numerator: x.numerator, denominator: x.denominator, sufficientSample: x.sufficient });
      return {
        period: periodInfo,
        channel: input.channel ?? "all",
        definitions: "Cohort = unique prospects successfully contacted in the period; replies counted once per prospect.",
        messagesSent: s.messagesSent,
        contacted: s.contacted,
        replied: s.replied,
        positive: s.positive,
        callsBooked: s.callsBooked,
        qualifiedOpportunities: s.qualifiedOpportunities,
        won: s.won,
        wonValueCents: s.wonValueCents,
        replyRate: rate(s.replyRate),
        positiveReplyRate: rate(s.positiveReplyRate),
        meetingRate: rate(s.meetingRate),
        wonRate: rate(s.wonRate),
      };
    }
    case "campaign_performance": {
      const rows = await campaignStats(tx);
      return {
        period: "all time",
        campaigns: rows.map(({ c, members, s }) => ({ id: c.id, name: c.name, status: c.status, channel: c.channel, prospects: members, contacted: s.contacted, replyRate: r2(s.replyRate.value), positiveReplyRate: r2(s.positiveReplyRate.value), meetings: s.callsBooked, opportunities: s.qualifiedOpportunities, won: s.won, sufficientSample: s.replyRate.sufficient })),
      };
    }
    case "list_prospects": {
      const excluded = (await tx.select({ key: leadStatuses.key }).from(leadStatuses).where(eq(leadStatuses.category, "excluded"))).map((s) => s.key);
      const rows = await tx
        .select({ id: prospects.id, name: prospects.fullName, company: prospects.company, title: prospects.jobTitle, companyType: prospects.companyType, status: prospects.status, fit: prospects.fitScore, lastContactedAt: prospects.lastContactedAt, nextFollowUpAt: prospects.nextFollowUpAt })
        .from(prospects)
        .where(
          and(
            input.status ? eq(prospects.status, String(input.status)) : undefined,
            input.min_fit != null ? gte(prospects.fitScore, Number(input.min_fit)) : undefined,
            input.uncontacted ? isNull(prospects.lastContactedAt) : undefined,
            input.company_type ? ilike(prospects.companyType, `%${String(input.company_type).replace(/[%_]/g, "")}%`) : undefined,
            excluded.length ? notInArray(prospects.status, excluded) : undefined,
          ),
        )
        .orderBy(sql`${prospects.fitScore} desc nulls last`)
        .limit(Math.min(Math.max(Number(input.limit) || 10, 1), 25));
      return { count: rows.length, prospects: rows.map((r) => ({ ...r, url: `/prospects/${r.id}`, lastContactedAt: r.lastContactedAt?.toISOString().slice(0, 10) ?? null })) };
    }
    case "follow_ups_due": {
      const rows = await tx
        .select({ id: followUps.id, dueAt: followUps.dueAt, reason: followUps.reason, prospectId: prospects.id, name: prospects.fullName, company: prospects.company })
        .from(followUps)
        .innerJoin(prospects, eq(prospects.id, followUps.prospectId))
        .where(and(eq(followUps.status, "pending"), lte(followUps.dueAt, endOfDay(new Date()))))
        .orderBy(asc(followUps.dueAt));
      return { asOf: new Date().toISOString().slice(0, 10), count: rows.length, followUps: rows.map((r) => ({ ...r, dueAt: r.dueAt.toISOString().slice(0, 10), url: `/prospects/${r.prospectId}` })) };
    }
    case "pipeline_summary": {
      const p = await pipeline(tx);
      return {
        stages: p.stages.map((s) => {
          const list = p.rows.filter((r) => r.o.stage === s.key);
          return { stage: s.label, kind: s.kind, count: list.length, recordedValueCentsUSD: list.filter((r) => r.o.currency === "USD").reduce((a, r) => a + (r.o.valueCents ?? 0), 0) };
        }),
        staleOpen: p.rows
          .filter((r) => p.stages.find((s) => s.key === r.o.stage)?.kind === "open" && (r.o.lastActivityAt ?? r.o.createdAt).getTime() < Date.now() - 14 * 86400000)
          .map((r) => ({ name: r.o.name, stage: r.o.stage, lastActivity: (r.o.lastActivityAt ?? r.o.createdAt).toISOString().slice(0, 10) })),
      };
    }
    case "insights": {
      const i = await getInsights(tx, userId);
      return {
        insights: i.insights.map((x) => ({ title: x.title, body: x.body, sampleSize: x.sampleSize, confidence: x.confidence })),
        recommendations: i.recommendations.map((x) => ({ title: x.title, reasoning: x.reasoning, link: x.actionHref })),
        dataNotes: i.notes,
      };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

// Used by the no-AI quick questions.
export const QUICK_QUESTIONS: { label: string; tool: string; input: Record<string, unknown> }[] = [
  { label: "Which posts performed best this month?", tool: "top_posts", input: { range: "30d", metric: "engagement_rate", limit: 5 } },
  { label: "Which posts drove profile visits?", tool: "top_posts", input: { range: "90d", metric: "profile_visits", limit: 5 } },
  { label: "Which pillars perform best?", tool: "performance_breakdown", input: { range: "90d", by: "pillar" } },
  { label: "Which prospects should I contact today?", tool: "follow_ups_due", input: {} },
  { label: "High-fit SaaS founders I haven't contacted", tool: "list_prospects", input: { status: null, min_fit: 75, uncontacted: true, company_type: "saas", limit: 10 } },
  { label: "Which campaign has the best positive-reply rate?", tool: "campaign_performance", input: {} },
  { label: "Summarize my outreach this month", tool: "outreach_summary", input: { range: "30d", channel: null } },
  { label: "How is my pipeline?", tool: "pipeline_summary", input: {} },
];

