import { describe, expect, it } from "vitest";
import { contentInsights, recommendations, confidenceFor } from "@/lib/insights/engine";
import type { PostPerformance } from "@/lib/metrics/content";

type Perf = Parameters<typeof contentInsights>[0][number];

function post(i: number, pillarId: string, rate: number, extra: Partial<Perf["post"]> = {}, impressions = 1000): Perf {
  return {
    post: {
      id: `v${i}`,
      contentItemId: `c${i}`,
      platform: "linkedin",
      publishedAt: new Date(Date.UTC(2026, 9, 1 + (i % 25), 9)),
      title: `Post ${i}`,
      body: "x".repeat(400),
      format: "text",
      hookStyle: "observation",
      pillarId,
      pillarName: pillarId === "p1" ? "Teardowns" : "Tips",
      ...extra,
    },
    snapshot: {
      versionId: `v${i}`,
      capturedAt: new Date(),
      impressions,
      likes: Math.round(rate * impressions),
      replies: 0,
      reposts: 0,
      bookmarks: null,
      linkClicks: null,
      profileVisits: pillarId === "p1" ? 50 : 10,
      followersGained: null,
      meaningfulReplies: null,
      source: "manual",
    },
    engagements: Math.round(rate * impressions),
    engagementRate: rate,
  } as Perf;
}

describe("content insights", () => {
  it("refuses to report patterns with too little data", () => {
    const { insights, notes } = contentInsights([post(1, "p1", 0.05), post(2, "p2", 0.01)]);
    expect(insights).toHaveLength(0);
    expect(notes[0]).toMatch(/Only 2 published posts/);
  });

  it("reports a pillar difference only when both sides have enough posts and the lift is meaningful", () => {
    const rows = [...Array.from({ length: 6 }, (_, i) => post(i, "p1", 0.05)), ...Array.from({ length: 6 }, (_, i) => post(10 + i, "p2", 0.02))];
    const { insights } = contentInsights(rows);
    const pillar = insights.find((i) => i.kind === "pillar_performance");
    expect(pillar?.title).toMatch(/Teardowns posts have had a higher engagement rate/);
    expect(pillar?.body).toMatch(/not proof/);
    expect(pillar?.sampleSize).toBe(12);
    expect(pillar?.confidence).toBe("low");
  });

  it("stays silent when the difference is small", () => {
    const rows = [...Array.from({ length: 6 }, (_, i) => post(i, "p1", 0.031)), ...Array.from({ length: 6 }, (_, i) => post(10 + i, "p2", 0.03))];
    expect(contentInsights(rows).insights.find((i) => i.kind === "pillar_performance")).toBeUndefined();
  });

  it("maps sample size to confidence", () => {
    expect([confidenceFor(5), confidenceFor(12), confidenceFor(25)]).toEqual(["low", "medium", "high"]);
  });
});

describe("recommendations", () => {
  const base = {
    perf: [] as Perf[],
    itemPlatforms: new Map(),
    followUpsDue: 0,
    followUpsOverdue: 0,
    highFitUncontacted: [],
    interestedNoNextStep: [],
    campaigns: [],
    scheduledNext7Days: 1,
    postsLast30Days: 0,
    formatCounts90d: new Map<string, number>(),
    staleOpportunities: [],
  };

  it("produces nothing when there is nothing to act on", () => {
    expect(recommendations(base)).toEqual([]);
  });

  it("flags a campaign only when its reply rate is far below others with enough volume", () => {
    const recs = recommendations({
      ...base,
      campaigns: [
        { id: "a", name: "A", contacted: 20, replied: 1 },
        { id: "b", name: "B", contacted: 20, replied: 8 },
      ],
    });
    expect(recs.map((r) => r.fingerprint)).toEqual(["low_reply_campaign:a"]);
    const tooSmall = recommendations({ ...base, campaigns: [{ id: "a", name: "A", contacted: 5, replied: 0 }, { id: "b", name: "B", contacted: 5, replied: 4 }] });
    expect(tooSmall).toEqual([]);
  });

  it("suggests repurposing a strong post that only exists on one platform", () => {
    const perf = Array.from({ length: 12 }, (_, i) => post(i, "p1", 0.01 + i * 0.005, {}, 1000 + i * 100));
    const itemPlatforms = new Map(perf.map((p) => [p.post.contentItemId, new Set(["linkedin" as const])]));
    const recs = recommendations({ ...base, perf, itemPlatforms });
    const r = recs.find((x) => x.kind === "repurpose");
    expect(r?.actionHref).toContain("repurpose=x");
    expect(r?.evidence.comparedPosts).toBe(12);
  });

  it("includes due follow-ups and high-fit prospects with their evidence", () => {
    const recs = recommendations({ ...base, followUpsDue: 3, followUpsOverdue: 1, highFitUncontacted: [{ id: "p", name: "Ada", fitScore: 90 }] });
    expect(recs.map((r) => r.kind)).toEqual(["followups_due", "high_fit_uncontacted"]);
    expect(recs[0]!.reasoning).toMatch(/1 overdue/);
  });
});

export type { PostPerformance };
