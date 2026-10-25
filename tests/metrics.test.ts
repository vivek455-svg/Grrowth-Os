import { describe, expect, it } from "vitest";
import {
  bestPost,
  engagementRate,
  engagements,
  followerGrowth,
  groupPerformance,
  postPerformance,
  summarizeContent,
  compareContent,
  type SnapshotLike,
} from "@/lib/metrics/content";
import { previousPeriod, periodFromRange, safeRate } from "@/lib/metrics/period";
import { summarizeOutreach, type EventLike } from "@/lib/metrics/outreach";

const d = (s: string) => new Date(s);
const snap = (versionId: string, capturedAt: string, m: Partial<SnapshotLike> = {}): SnapshotLike => ({
  versionId,
  capturedAt: d(capturedAt),
  impressions: null,
  likes: null,
  replies: null,
  reposts: null,
  bookmarks: null,
  linkClicks: null,
  profileVisits: null,
  followersGained: null,
  meaningfulReplies: null,
  source: "manual",
  ...m,
});
const period = { start: d("2026-10-01T00:00:00Z"), end: d("2026-10-31T23:59:59Z") };

describe("content metrics", () => {
  it("engagements returns null when nothing is available, never 0", () => {
    expect(engagements({ likes: null, replies: null, reposts: null, bookmarks: null })).toBeNull();
    expect(engagements({ likes: 3, replies: null, reposts: 1, bookmarks: null })).toBe(4);
  });

  it("engagement rate uses the configured denominator and refuses zero/missing denominators", () => {
    const s = snap("v", "2026-10-02", { impressions: 1000, likes: 40, replies: 10 });
    expect(engagementRate(s, { denominator: "impressions" })).toBeCloseTo(0.05);
    expect(engagementRate(s, { denominator: "followers", followers: 500 })).toBeCloseTo(0.1);
    expect(engagementRate(s, { denominator: "followers", followers: null })).toBeNull();
    expect(engagementRate({ ...s, impressions: 0 }, { denominator: "impressions" })).toBeNull();
    expect(safeRate(1, 0)).toBeNull();
  });

  it("uses only the latest snapshot per post and aggregates the rate as Σe/Σimpressions", () => {
    const posts = [
      { id: "a", contentItemId: "i1", platform: "x" as const, publishedAt: d("2026-10-03") },
      { id: "b", contentItemId: "i2", platform: "linkedin" as const, publishedAt: d("2026-10-05") },
      { id: "c", contentItemId: "i3", platform: "x" as const, publishedAt: d("2026-09-15") }, // outside period
    ];
    const snaps = [
      snap("a", "2026-10-04", { impressions: 100, likes: 1 }),
      snap("a", "2026-10-10", { impressions: 1000, likes: 50 }), // latest
      snap("b", "2026-10-06", { impressions: 3000, likes: 60, replies: 30 }),
      snap("c", "2026-09-16", { impressions: 999999, likes: 9 }),
    ];
    const perf = postPerformance(posts, snaps, [], "impressions");
    const s = summarizeContent(perf, period, [], "impressions");
    expect(s.postsPublished).toBe(2);
    expect(s.impressions.value).toBe(4000);
    expect(s.engagements.value).toBe(140);
    expect(s.engagementRate.value).toBeCloseTo(140 / 4000);
    expect(s.engagementRate.sufficient).toBe(false); // only 2 posts
    expect(s.profileVisits.value).toBeNull(); // unavailable, not zero
  });

  it("follower growth requires a baseline before the period and a snapshot inside it", () => {
    const audience = [
      { platform: "x" as const, capturedAt: d("2026-09-30"), followers: 1000 },
      { platform: "x" as const, capturedAt: d("2026-10-20"), followers: 1120 },
      { platform: "linkedin" as const, capturedAt: d("2026-10-20"), followers: 800 },
    ];
    expect(followerGrowth(audience, "x", period)).toBe(120);
    expect(followerGrowth(audience, "linkedin", period)).toBeNull();
  });

  it("best post ignores tiny posts with inflated rates", () => {
    const posts = ["a", "b", "c"].map((id, i) => ({
      id,
      contentItemId: id,
      platform: "x" as const,
      publishedAt: d(`2026-10-0${i + 1}`),
    }));
    const perf = postPerformance(
      posts,
      [
        snap("a", "2026-10-10", { impressions: 20, likes: 10 }), // 50% but tiny
        snap("b", "2026-10-10", { impressions: 5000, likes: 200 }), // 4%
        snap("c", "2026-10-10", { impressions: 4000, likes: 100 }), // 2.5%
      ],
      [],
      "impressions",
    );
    expect(bestPost(perf)?.post.id).toBe("b");
  });

  it("does not compare with a previous period that has no data", () => {
    const posts = [{ id: "a", contentItemId: "i", platform: "x" as const, publishedAt: d("2026-10-03") }];
    const perf = postPerformance(posts, [snap("a", "2026-10-04", { impressions: 10, likes: 1 })], [], "impressions");
    const c = compareContent(perf, period, [], "impressions");
    expect(c.previous).toBeNull();
    expect(c.deltas.impressions.change).toBeNull();
  });

  it("groups report sample sizes and flag insufficient groups", () => {
    const posts = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      contentItemId: `i${i}`,
      platform: "linkedin" as const,
      publishedAt: d("2026-10-02"),
    }));
    const perf = postPerformance(
      posts,
      posts.map((p, i) => snap(p.id, "2026-10-03", { impressions: 1000, likes: 10 * (i + 1) })),
      [],
      "impressions",
    );
    const groups = groupPerformance(perf, (r) => (r.post.id < "p5" ? "teardown" : "tips"));
    expect(groups[0]).toMatchObject({ key: "teardown", posts: 5, sufficient: true });
    expect(groups[1]).toMatchObject({ key: "tips", posts: 1, sufficient: false });
  });

  it("previous period has the same length and ends right before the current one", () => {
    const p = periodFromRange("7d", d("2026-10-25T12:00:00Z"));
    const prev = previousPeriod(p);
    expect(prev.end.getTime()).toBe(p.start.getTime() - 1);
    expect(p.end.getTime() - p.start.getTime()).toBe(prev.end.getTime() - prev.start.getTime());
  });
});

describe("outreach metrics", () => {
  const ev = (prospectId: string, type: EventLike["type"], at: string, extra: Partial<EventLike> = {}): EventLike => ({
    prospectId,
    type,
    direction: type.endsWith("received") ? "inbound" : type === "call_booked" ? "internal" : "outbound",
    occurredAt: d(at),
    deliveryStatus: null,
    sentiment: null,
    campaignId: null,
    channel: type.startsWith("email") ? "email" : type.startsWith("linkedin") ? "linkedin" : "x",
    ...extra,
  });

  it("counts unique prospects, ignores failed sends and duplicate replies", () => {
    const events = [
      ev("p1", "email_sent", "2026-10-02"),
      ev("p1", "email_sent", "2026-10-09"), // follow-up: still one prospect
      ev("p1", "email_received", "2026-10-10", { sentiment: "positive" }),
      ev("p1", "email_received", "2026-10-11", { sentiment: "positive" }), // second reply, same prospect
      ev("p2", "linkedin_sent", "2026-10-03"),
      ev("p3", "email_sent", "2026-10-04", { deliveryStatus: "bounced" }),
      ev("p4", "email_received", "2026-10-05"), // inbound without outreach: not in cohort
      ev("p5", "x_dm_sent", "2026-10-06"),
      ev("p5", "x_reply_received", "2026-10-01"), // reply before contact: ignored
      ev("p2", "call_booked", "2026-10-12"),
    ];
    const s = summarizeOutreach({ events, opportunities: [], followUps: [], period, now: d("2026-10-31") });
    expect(s.messagesSent).toBe(4);
    expect(s.failedOrBounced).toBe(1);
    expect(s.contacted).toBe(3);
    expect(s.replied).toBe(1);
    expect(s.positive).toBe(1);
    expect(s.replyRate.value).toBeCloseTo(1 / 3);
    expect(s.replyRate.sufficient).toBe(false);
    expect(s.callsBooked).toBe(1);
    expect(s.meetingRate.numerator).toBe(1);
  });

  it("computes won rate and follow-up completion from recorded data only", () => {
    const events = Array.from({ length: 5 }, (_, i) => ev(`p${i}`, "email_sent", "2026-10-02"));
    const s = summarizeOutreach({
      events,
      opportunities: [
        { prospectId: "p0", createdAt: d("2026-10-05"), closedAt: d("2026-10-20"), stageKind: "won", valueCents: 400000 },
        { prospectId: "p1", createdAt: d("2026-10-05"), closedAt: null, stageKind: "open", valueCents: null },
      ],
      followUps: [
        { dueAt: d("2026-10-10"), status: "done" },
        { dueAt: d("2026-10-11"), status: "pending" },
        { dueAt: d("2026-10-12"), status: "cancelled" },
        { dueAt: d("2026-11-30"), status: "pending" }, // not due yet
      ],
      period,
      now: d("2026-10-31"),
    });
    expect(s.won).toBe(1);
    expect(s.wonValueCents).toBe(400000);
    expect(s.wonRate.value).toBeCloseTo(0.2);
    expect(s.qualifiedOpportunityRate.value).toBeCloseTo(0.4);
    expect(s.followUpCompletion).toMatchObject({ numerator: 1, denominator: 2 });
    expect(s.leadToClient.sufficient).toBe(false);
  });
});
