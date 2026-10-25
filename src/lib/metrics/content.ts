/**
 * Content metrics. Pure functions — no I/O — so every formula is unit-tested.
 * Formulas are documented in docs/METRICS.md and surfaced in the UI via tooltips.
 *
 * Rules
 *  - null means "not available"; it is never coerced to 0 in a rate denominator.
 *  - Each post is represented by its most recent metrics snapshot.
 *  - Platform definitions differ (e.g. what counts as an impression), so cross-platform
 *    totals are labelled as such in the UI.
 */
import type { MetricSource, Platform } from "@/db/schema";
import { MIN_SAMPLE, type Period, inPeriod, previousPeriod, safeRate } from "./period";

export type SnapshotLike = {
  versionId: string;
  capturedAt: Date;
  impressions: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  bookmarks: number | null;
  linkClicks: number | null;
  profileVisits: number | null;
  followersGained: number | null;
  meaningfulReplies: number | null;
  source: MetricSource;
};

export type PublishedPostLike = {
  id: string;
  contentItemId: string;
  platform: Platform;
  publishedAt: Date | null;
};

export type AudienceSnapshotLike = { platform: Platform; capturedAt: Date; followers: number };

export type EngagementDenominator = "impressions" | "followers";

/** Latest snapshot per version id. */
export function latestSnapshots<T extends SnapshotLike>(snapshots: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const s of snapshots) {
    const current = latest.get(s.versionId);
    if (!current || s.capturedAt > current.capturedAt) latest.set(s.versionId, s);
  }
  return latest;
}

/**
 * Engagements = likes/reactions + replies/comments + reposts/shares + bookmarks.
 * Link clicks and profile visits are tracked separately (they are intent signals, not engagement).
 * Returns null when none of the components is available.
 */
export function engagements(s: Pick<SnapshotLike, "likes" | "replies" | "reposts" | "bookmarks">): number | null {
  const parts = [s.likes, s.replies, s.reposts, s.bookmarks];
  if (parts.every((p) => p === null)) return null;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

/** Follower count on the platform at (or most recently before) a given time. */
export function followersAt(audience: AudienceSnapshotLike[], platform: Platform, at: Date): number | null {
  let best: AudienceSnapshotLike | null = null;
  for (const a of audience) {
    if (a.platform !== platform || a.capturedAt > at) continue;
    if (!best || a.capturedAt > best.capturedAt) best = a;
  }
  return best?.followers ?? null;
}

/**
 * Engagement rate for a single post.
 *   impressions mode: engagements / impressions
 *   followers mode:   engagements / followers at publication time
 */
export function engagementRate(
  s: SnapshotLike,
  opts: { denominator: EngagementDenominator; followers?: number | null },
): number | null {
  const e = engagements(s);
  if (e === null) return null;
  const d = opts.denominator === "impressions" ? s.impressions : (opts.followers ?? null);
  return safeRate(e, d);
}

export type PostPerformance = {
  post: PublishedPostLike;
  snapshot: SnapshotLike | null;
  engagements: number | null;
  engagementRate: number | null;
};

export function postPerformance(
  posts: PublishedPostLike[],
  snapshots: SnapshotLike[],
  audience: AudienceSnapshotLike[],
  denominator: EngagementDenominator,
): PostPerformance[] {
  const latest = latestSnapshots(snapshots);
  return posts.map((post) => {
    const snapshot = latest.get(post.id) ?? null;
    const followers =
      denominator === "followers" && post.publishedAt ? followersAt(audience, post.platform, post.publishedAt) : null;
    return {
      post,
      snapshot,
      engagements: snapshot ? engagements(snapshot) : null,
      engagementRate: snapshot ? engagementRate(snapshot, { denominator, followers }) : null,
    };
  });
}

/** Sum a metric over rows, returning null if no row has a value (so "0" is never invented). */
export function sumAvailable<T>(rows: T[], pick: (r: T) => number | null | undefined) {
  let total = 0;
  let count = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v === null || v === undefined) continue;
    total += v;
    count += 1;
  }
  return { value: count === 0 ? null : total, withData: count };
}

export type ContentSummary = {
  postsPublished: number;
  postsWithMetrics: number;
  impressions: { value: number | null; withData: number };
  engagements: { value: number | null; withData: number };
  /** Aggregate rate = Σ engagements / Σ denominator over posts that have both values. */
  engagementRate: { value: number | null; withData: number; sufficient: boolean };
  profileVisits: { value: number | null; withData: number };
  linkClicks: { value: number | null; withData: number };
  followersGained: { value: number | null; byPlatform: Partial<Record<Platform, number | null>> };
  sources: Partial<Record<MetricSource, number>>;
  best: PostPerformance | null;
};

export function summarizeContent(
  perf: PostPerformance[],
  period: Period,
  audience: AudienceSnapshotLike[],
  denominator: EngagementDenominator,
): ContentSummary {
  const rows = perf.filter((p) => p.post.publishedAt && inPeriod(p.post.publishedAt, period));
  const withSnap = rows.filter((r) => r.snapshot);

  let eSum = 0;
  let dSum = 0;
  let rateN = 0;
  for (const r of withSnap) {
    const e = r.engagements;
    const d =
      denominator === "impressions"
        ? r.snapshot!.impressions
        : r.post.publishedAt
          ? followersAt(audience, r.post.platform, r.post.publishedAt)
          : null;
    if (e === null || d === null || d <= 0) continue;
    eSum += e;
    dSum += d;
    rateN += 1;
  }

  const sources: Partial<Record<MetricSource, number>> = {};
  for (const r of withSnap) sources[r.snapshot!.source] = (sources[r.snapshot!.source] ?? 0) + 1;

  const byPlatform: Partial<Record<Platform, number | null>> = {};
  for (const platform of ["x", "linkedin"] as const) byPlatform[platform] = followerGrowth(audience, platform, period);
  const known = Object.values(byPlatform).filter((v): v is number => v !== null);

  return {
    postsPublished: rows.length,
    postsWithMetrics: withSnap.length,
    impressions: sumAvailable(withSnap, (r) => r.snapshot!.impressions),
    engagements: sumAvailable(withSnap, (r) => r.engagements),
    engagementRate: { value: rateN ? eSum / dSum : null, withData: rateN, sufficient: rateN >= MIN_SAMPLE },
    profileVisits: sumAvailable(withSnap, (r) => r.snapshot!.profileVisits),
    linkClicks: sumAvailable(withSnap, (r) => r.snapshot!.linkClicks),
    followersGained: { value: known.length ? known.reduce((a, b) => a + b, 0) : null, byPlatform },
    sources,
    best: bestPost(rows),
  };
}

/**
 * Followers gained = latest snapshot inside the period − latest snapshot at or before period start.
 * Null unless both bounds exist (we never extrapolate).
 */
export function followerGrowth(audience: AudienceSnapshotLike[], platform: Platform, period: Period): number | null {
  const start = followersAt(audience, platform, period.start);
  const end = followersAt(audience, platform, period.end);
  if (start === null || end === null) return null;
  const hasInPeriod = audience.some((a) => a.platform === platform && inPeriod(a.capturedAt, period));
  return hasInPeriod ? end - start : null;
}

/**
 * Best post balances reach and resonance: highest engagement rate among posts whose
 * impressions are at least the median of the set, so one tiny post with a 30% rate
 * does not win. Falls back to most engagements when impressions are unavailable.
 */
export function bestPost(rows: PostPerformance[]): PostPerformance | null {
  const scored = rows.filter((r) => r.snapshot && r.engagements !== null);
  if (!scored.length) return null;
  const withImpr = scored.filter((r) => r.snapshot!.impressions !== null && r.engagementRate !== null);
  if (withImpr.length) {
    const sorted = withImpr.map((r) => r.snapshot!.impressions!).sort((a, b) => a - b);
    const median = sorted[Math.floor((sorted.length - 1) / 2)];
    return withImpr
      .filter((r) => r.snapshot!.impressions! >= median)
      .sort((a, b) => b.engagementRate! - a.engagementRate!)[0];
  }
  return scored.sort((a, b) => b.engagements! - a.engagements!)[0];
}

export type Delta = { current: number | null; previous: number | null; change: number | null };

/** Relative change vs. previous period; null when either side is missing or previous is 0. */
export function delta(current: number | null, previous: number | null): Delta {
  const change = current === null || previous === null || previous === 0 ? null : (current - previous) / previous;
  return { current, previous, change };
}

export function compareContent(
  perf: PostPerformance[],
  period: Period,
  audience: AudienceSnapshotLike[],
  denominator: EngagementDenominator,
) {
  const current = summarizeContent(perf, period, audience, denominator);
  const previous = summarizeContent(perf, previousPeriod(period), audience, denominator);
  // Only compare when the previous period actually has published posts with data.
  const comparable = previous.postsWithMetrics > 0;
  return {
    current,
    previous: comparable ? previous : null,
    deltas: {
      postsPublished: delta(current.postsPublished, comparable ? previous.postsPublished : null),
      impressions: delta(current.impressions.value, comparable ? previous.impressions.value : null),
      engagements: delta(current.engagements.value, comparable ? previous.engagements.value : null),
      engagementRate: delta(current.engagementRate.value, comparable ? previous.engagementRate.value : null),
    },
  };
}

export type GroupStat = {
  key: string;
  posts: number;
  postsWithRate: number;
  medianRate: number | null;
  impressions: number | null;
  profileVisits: number | null;
  linkClicks: number | null;
  sufficient: boolean;
};

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Group posts by an attribute (pillar, format, hook style, length bucket…).
 * Uses the median engagement rate (robust to a single viral post) and reports sample size.
 */
export function groupPerformance<T extends PostPerformance>(rows: T[], keyOf: (r: T) => string | null): GroupStat[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const rates = list.map((r) => r.engagementRate).filter((v): v is number => v !== null);
      return {
        key,
        posts: list.length,
        postsWithRate: rates.length,
        medianRate: median(rates),
        impressions: sumAvailable(list, (r) => r.snapshot?.impressions).value,
        profileVisits: sumAvailable(list, (r) => r.snapshot?.profileVisits).value,
        linkClicks: sumAvailable(list, (r) => r.snapshot?.linkClicks).value,
        sufficient: rates.length >= MIN_SAMPLE,
      };
    })
    // Groups with enough data rank above small groups, so one lucky post can't top the list.
    .sort((a, b) => Number(b.sufficient) - Number(a.sufficient) || (b.medianRate ?? -1) - (a.medianRate ?? -1));
}

export function lengthBucket(body: string): string {
  const n = body.trim().length;
  if (n === 0) return "empty";
  if (n < 280) return "short (<280 chars)";
  if (n < 900) return "medium (280–900)";
  return "long (900+)";
}
