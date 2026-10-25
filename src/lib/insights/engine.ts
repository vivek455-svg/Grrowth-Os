/**
 * Grounded insight & recommendation engine.
 *
 * Every candidate is computed from stored records and carries its evidence (values, sample
 * sizes, record ids). Thresholds prevent claims from tiny samples, and wording avoids causal
 * language: we report associations ("posts in X have had…"), never "X causes…".
 * Pure functions: tested in tests/insights.test.ts.
 */
import type { Confidence } from "@/db/schema";
import { groupPerformance, lengthBucket, median, type PostPerformance } from "@/lib/metrics/content";
import { MIN_SAMPLE, safeRate } from "@/lib/metrics/period";
import { FORMAT_LABEL, HOOK_LABEL, PLATFORM_LABEL } from "@/lib/labels";
import { fmtPercent } from "@/lib/format";
import type { ContentFormat, HookStyle, Platform } from "@/db/schema";

export type InsightCandidate = {
  fingerprint: string;
  kind: string;
  title: string;
  body: string;
  evidence: Record<string, unknown>;
  sampleSize: number;
  confidence: Confidence;
};

export type RecommendationCandidate = {
  fingerprint: string;
  kind: string;
  title: string;
  reasoning: string;
  evidence: Record<string, unknown>;
  actionLabel: string | null;
  actionHref: string | null;
};

type Perf = PostPerformance & {
  post: PostPerformance["post"] & {
    title: string;
    body: string;
    format: string;
    hookStyle: string | null;
    pillarId: string | null;
    pillarName: string | null;
  };
};

/** Relative lift needed before a group difference is reported. */
const MIN_LIFT = 1.25;

export function confidenceFor(n: number): Confidence {
  if (n >= 20) return "high";
  if (n >= 10) return "medium";
  return "low";
}

function compareGroups(
  rows: Perf[],
  keyOf: (r: Perf) => string | null,
  labelOf: (key: string) => string,
  kind: string,
  noun: string,
): InsightCandidate | null {
  const groups = groupPerformance(rows, keyOf as (r: PostPerformance) => string | null).filter((g) => g.sufficient && g.medianRate !== null);
  if (groups.length < 2) return null;
  const [top, ...rest] = groups;
  const restRates = rest.flatMap((g) =>
    rows.filter((r) => keyOf(r) === g.key && r.engagementRate !== null).map((r) => r.engagementRate!),
  );
  const restMedian = median(restRates);
  if (!top || top.medianRate === null || restMedian === null || restMedian <= 0) return null;
  const lift = top.medianRate / restMedian;
  if (lift < MIN_LIFT) return null;
  const n = Math.min(top.postsWithRate, restRates.length);
  return {
    fingerprint: `${kind}:${top.key}`,
    kind,
    title: `${labelOf(top.key)} posts have had a higher engagement rate than other ${noun}`,
    body: `Across ${top.postsWithRate} ${labelOf(top.key)} posts, the median engagement rate was ${fmtPercent(top.medianRate)} compared with ${fmtPercent(restMedian)} for ${restRates.length} posts in other ${noun}. This is an association in your data, not proof the ${noun.replace(/s$/, "")} caused it — topic, timing and platform also vary.`,
    evidence: {
      group: top.key,
      groupMedianRate: top.medianRate,
      groupPosts: top.postsWithRate,
      comparisonMedianRate: restMedian,
      comparisonPosts: restRates.length,
      lift,
      groups: groups.map((g) => ({ key: g.key, posts: g.postsWithRate, medianRate: g.medianRate })),
    },
    sampleSize: top.postsWithRate + restRates.length,
    confidence: confidenceFor(n),
  };
}

export function contentInsights(rows: Perf[], opts: { opportunityPillars?: Map<string, number>; pillarNames?: Map<string, string> } = {}): {
  insights: InsightCandidate[];
  notes: string[];
} {
  const insights: InsightCandidate[] = [];
  const notes: string[] = [];
  const withRate = rows.filter((r) => r.engagementRate !== null);
  if (withRate.length < MIN_SAMPLE * 2) {
    notes.push(
      `Only ${withRate.length} published posts have engagement data. Pattern analysis starts at ${MIN_SAMPLE * 2} posts with metrics.`,
    );
    return { insights, notes };
  }
  const pillarNames = new Map(rows.filter((r) => r.post.pillarId).map((r) => [r.post.pillarId!, r.post.pillarName ?? "Unnamed pillar"]));
  const pillar = compareGroups(rows, (r) => r.post.pillarId, (k) => pillarNames.get(k) ?? k, "pillar_performance", "pillars");
  if (pillar) insights.push(pillar);
  const format = compareGroups(rows, (r) => r.post.format, (k) => FORMAT_LABEL[k as ContentFormat] ?? k, "format_performance", "formats");
  if (format) insights.push(format);
  const hook = compareGroups(rows, (r) => r.post.hookStyle, (k) => `${HOOK_LABEL[k as HookStyle] ?? k}-hook`, "hook_performance", "hook styles");
  if (hook) insights.push(hook);
  const length = compareGroups(rows, (r) => lengthBucket(r.post.body), (k) => `${k[0]!.toUpperCase()}${k.slice(1)}`, "length_performance", "lengths");
  if (length) insights.push(length);

  // Intent signals: profile visits per post by pillar (only where reported).
  const visitGroups = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.post.pillarId || r.snapshot?.profileVisits == null) continue;
    visitGroups.set(r.post.pillarId, [...(visitGroups.get(r.post.pillarId) ?? []), r.snapshot.profileVisits]);
  }
  const visitStats = [...visitGroups.entries()]
    .filter(([, v]) => v.length >= MIN_SAMPLE)
    .map(([k, v]) => ({ key: k, posts: v.length, median: median(v)! }))
    .sort((a, b) => b.median - a.median);
  if (visitStats.length >= 2 && visitStats[0]!.median >= MIN_LIFT * visitStats[1]!.median && visitStats[0]!.median > 0) {
    const top = visitStats[0]!;
    insights.push({
      fingerprint: `profile_visits:${top.key}`,
      kind: "profile_visits",
      title: `${pillarNames.get(top.key)} posts have driven the most profile visits`,
      body: `Median ${top.median} profile visits per post across ${top.posts} posts, versus ${visitStats[1]!.median} for the next pillar (${pillarNames.get(visitStats[1]!.key)}). Profile visits are a stronger buying signal than likes.`,
      evidence: { stats: visitStats.map((s) => ({ ...s, name: pillarNames.get(s.key) })) },
      sampleSize: visitStats.reduce((a, s) => a + s.posts, 0),
      confidence: confidenceFor(top.posts),
    });
  }

  // Opportunities attributed to content, by pillar.
  if (opts.opportunityPillars?.size) {
    const sorted = [...opts.opportunityPillars.entries()].sort((a, b) => b[1] - a[1]);
    const [key, count] = sorted[0]!;
    const name = opts.pillarNames?.get(key) ?? pillarNames.get(key) ?? "One pillar";
    insights.push({
      fingerprint: `content_opportunities:${key}`,
      kind: "content_opportunities",
      title: `${name} content is linked to ${count} opportunit${count === 1 ? "y" : "ies"}`,
      body: `${count} recorded opportunit${count === 1 ? "y lists" : "ies list"} a ${name} post as a touchpoint. Attribution is based on what you recorded and doesn't prove the post caused the deal.`,
      evidence: { byPillar: sorted.map(([k, c]) => ({ pillarId: k, name: opts.pillarNames?.get(k) ?? pillarNames.get(k), opportunities: c })) },
      sampleSize: sorted.reduce((a, [, c]) => a + c, 0),
      confidence: count >= 5 ? "medium" : "low",
    });
  }

  // Posting time: only with enough data in every bucket we compare.
  const byHour = new Map<string, number[]>();
  for (const r of withRate) {
    const h = r.post.publishedAt!.getUTCHours();
    const bucket = h < 11 ? "morning (UTC)" : h < 15 ? "midday (UTC)" : "afternoon/evening (UTC)";
    byHour.set(bucket, [...(byHour.get(bucket) ?? []), r.engagementRate!]);
  }
  const hourOk = [...byHour.values()].filter((v) => v.length >= 8).length >= 2 && withRate.length >= 30;
  if (!hourOk)
    notes.push(`Posting-time analysis needs at least 30 posts with metrics and 8+ posts per time slot. You have ${withRate.length} posts with metrics.`);
  return { insights, notes };
}

export type RecommendationInput = {
  perf: Perf[];
  /** content item id -> platforms that have a version */
  itemPlatforms: Map<string, Set<Platform>>;
  followUpsDue: number;
  followUpsOverdue: number;
  highFitUncontacted: { id: string; name: string; fitScore: number }[];
  interestedNoNextStep: { id: string; name: string }[];
  campaigns: { id: string; name: string; contacted: number; replied: number }[];
  scheduledNext7Days: number;
  postsLast30Days: number;
  formatCounts90d: Map<string, number>;
  staleOpportunities: { id: string; name: string; days: number }[];
};

export function recommendations(input: RecommendationInput): RecommendationCandidate[] {
  const out: RecommendationCandidate[] = [];

  if (input.followUpsDue > 0) {
    out.push({
      fingerprint: "followups_due",
      kind: "followups_due",
      title: `${input.followUpsDue} follow-up${input.followUpsDue === 1 ? " is" : "s are"} due`,
      reasoning: `${input.followUpsOverdue} overdue and ${input.followUpsDue - input.followUpsOverdue} due today. Follow-ups to prospects who replied or opted out are excluded automatically.`,
      evidence: { due: input.followUpsDue, overdue: input.followUpsOverdue },
      actionLabel: "Open follow-ups",
      actionHref: "/follow-ups",
    });
  }

  if (input.interestedNoNextStep.length) {
    out.push({
      fingerprint: "interested_no_next_step",
      kind: "interested_no_next_step",
      title: `${input.interestedNoNextStep.length} interested prospect${input.interestedNoNextStep.length === 1 ? " has" : "s have"} no next step`,
      reasoning: "These prospects replied positively but have no pending follow-up or open opportunity.",
      evidence: { prospects: input.interestedNoNextStep.slice(0, 10) },
      actionLabel: "Review prospects",
      actionHref: "/follow-ups#no-next-step",
    });
  }

  if (input.highFitUncontacted.length) {
    const top = input.highFitUncontacted.slice(0, 5);
    out.push({
      fingerprint: "high_fit_uncontacted",
      kind: "high_fit_uncontacted",
      title: `${input.highFitUncontacted.length} high-fit prospect${input.highFitUncontacted.length === 1 ? "" : "s"} not contacted yet`,
      reasoning: `Fit score 75+ and no outreach logged. Highest: ${top.map((p) => `${p.name} (${p.fitScore})`).join(", ")}.`,
      evidence: { prospects: top, total: input.highFitUncontacted.length },
      actionLabel: "View prospects",
      actionHref: "/prospects?view=high-fit-uncontacted",
    });
  }

  // Campaigns with unusually low reply rates (needs enough contacted prospects on both sides).
  const eligible = input.campaigns.filter((c) => c.contacted >= 10);
  const totalContacted = eligible.reduce((a, c) => a + c.contacted, 0);
  const overall = safeRate(eligible.reduce((a, c) => a + c.replied, 0), totalContacted);
  if (overall !== null && totalContacted >= 20) {
    for (const c of eligible) {
      const r = safeRate(c.replied, c.contacted)!;
      if (r < overall * 0.5)
        out.push({
          fingerprint: `low_reply_campaign:${c.id}`,
          kind: "low_reply_campaign",
          title: `“${c.name}” has a low reply rate`,
          reasoning: `${fmtPercent(r)} reply rate (${c.replied}/${c.contacted} prospects) vs ${fmtPercent(overall)} across your other campaigns. Review the message strategy and prospect criteria before contacting more people.`,
          evidence: { campaignReplyRate: r, overallReplyRate: overall, contacted: c.contacted, replied: c.replied },
          actionLabel: "Open campaign",
          actionHref: `/campaigns/${c.id}`,
        });
    }
  }

  // Repurpose: strong posts (top quartile engagement rate, at least median impressions) not on the other platform.
  const rated = input.perf.filter((r) => r.engagementRate !== null && r.snapshot?.impressions != null);
  if (rated.length >= MIN_SAMPLE * 2) {
    const rates = rated.map((r) => r.engagementRate!).sort((a, b) => a - b);
    const q3 = rates[Math.floor(rates.length * 0.75)]!;
    const imprMedian = median(rated.map((r) => r.snapshot!.impressions!))!;
    const candidates = rated
      .filter((r) => r.engagementRate! >= q3 && r.snapshot!.impressions! >= imprMedian)
      .filter((r) => (input.itemPlatforms.get(r.post.contentItemId)?.size ?? 0) < 2)
      .sort((a, b) => b.engagementRate! - a.engagementRate!);
    const best = candidates[0];
    if (best) {
      const target: Platform = best.post.platform === "x" ? "linkedin" : "x";
      out.push({
        fingerprint: `repurpose:${best.post.contentItemId}`,
        kind: "repurpose",
        title: `Adapt “${best.post.title}” for ${PLATFORM_LABEL[target]}`,
        reasoning: `It's in your top quarter by engagement rate on ${PLATFORM_LABEL[best.post.platform]} (${fmtPercent(best.engagementRate)} on ${best.snapshot!.impressions!.toLocaleString()} impressions) and has no ${PLATFORM_LABEL[target]} version yet.`,
        evidence: { versionId: best.post.id, engagementRate: best.engagementRate, impressions: best.snapshot!.impressions, comparedPosts: rated.length },
        actionLabel: `Repurpose for ${PLATFORM_LABEL[target]}`,
        actionHref: `/content/${best.post.contentItemId}?repurpose=${target}&from=${best.post.id}`,
      });
    }
  }

  if (input.postsLast30Days >= 4 && input.scheduledNext7Days === 0) {
    out.push({
      fingerprint: "publishing_gap",
      kind: "publishing_gap",
      title: "Nothing is planned for the next 7 days",
      reasoning: `You published ${input.postsLast30Days} posts in the last 30 days but have no scheduled or planned posts this week.`,
      evidence: { postsLast30Days: input.postsLast30Days },
      actionLabel: "Open calendar",
      actionHref: "/content/calendar",
    });
  }

  // Format worth testing: formats with too little data to judge.
  const formats = ["carousel", "thread", "image", "video"] as const;
  const thin = formats.filter((f) => (input.formatCounts90d.get(f) ?? 0) < 3);
  const tested = [...input.formatCounts90d.values()].reduce((a, b) => a + b, 0);
  if (thin.length && tested >= 10) {
    const f = thin[0]!;
    out.push({
      fingerprint: `format_test:${f}`,
      kind: "format_test",
      title: `Test more ${FORMAT_LABEL[f].toLowerCase()} posts`,
      reasoning: `You've published ${input.formatCounts90d.get(f) ?? 0} ${FORMAT_LABEL[f].toLowerCase()} posts in 90 days — not enough to know how the format performs for you. Two or three more would make it comparable.`,
      evidence: { counts: Object.fromEntries(input.formatCounts90d) },
      actionLabel: "Open AI Content Lab",
      actionHref: `/content/lab?format=${f}`,
    });
  }

  for (const o of input.staleOpportunities.slice(0, 3))
    out.push({
      fingerprint: `stale_opportunity:${o.id}`,
      kind: "stale_opportunity",
      title: `No activity on “${o.name}” for ${o.days} days`,
      reasoning: "Open opportunities without recent activity tend to stall. Add a next action or close it out.",
      evidence: { opportunityId: o.id, daysSinceActivity: o.days },
      actionLabel: "Open pipeline",
      actionHref: `/opportunities?open=${o.id}`,
    });

  return out;
}
