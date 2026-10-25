# Metric definitions

All metrics are computed in one place — `src/lib/metrics/` — from stored records. They are pure
functions with unit tests (`tests/metrics.test.ts`). The UI, reports and the AI assistant all call
the same functions, so a number means the same thing everywhere.

## General rules

- **Missing ≠ zero.** A metric the platform didn't report (or you didn't record) is `null`, shown as “—”,
  and excluded from that metric's totals and rates.
- **Latest snapshot.** Each post is represented by its most recent metrics snapshot. Older snapshots are
  kept for history and never overwritten.
- **Sources are labelled.** Every snapshot has a source: `api`, `manual`, `csv` or `estimated`.
- **Sample sizes.** Rates with fewer than **5** observations (`MIN_SAMPLE`) are flagged as low confidence.
- **Periods.** Presets are 7/30/90 days ending today, or a custom range. The *previous period* is the same
  number of days immediately before. Comparisons are hidden when the previous period has no data.

## Content

| Metric | Formula |
|---|---|
| Engagements | likes/reactions + replies/comments + reposts/shares (+ quotes on X) + bookmarks |
| Engagement rate (post) | engagements ÷ impressions, or ÷ followers at publication (Settings → Metrics) |
| Engagement rate (period) | Σ engagements ÷ Σ denominator, over posts that have both values |
| Followers gained | latest follower count in the period − latest count at/before the period start (needs both) |
| Best post | highest engagement rate among posts with at least median impressions |
| Group performance | median engagement rate per group (pillar, format, hook, CTA, length) with sample size |

Link clicks and profile visits are reported separately; they're intent signals, not engagement.
X and LinkedIn define impressions differently, so cross-platform totals are labelled as mixed.

## Outreach

The **cohort** is the set of unique prospects with at least one successful outbound touch
(email, LinkedIn message, connection request, X DM or public reply) in the period. Failed or bounced
sends are excluded.

| Metric | Formula |
|---|---|
| Reply rate | cohort prospects with an inbound reply after their first in-period touch ÷ cohort size |
| Positive-reply rate | cohort prospects with at least one reply classified *positive* ÷ cohort size |
| Meeting-booking rate | cohort prospects with a *call booked* entry in the period ÷ cohort size |
| Qualified-opportunity rate | cohort prospects with any opportunity ÷ cohort size |
| Won-project rate | cohort prospects with a won opportunity ÷ cohort size |
| Follow-up completion | follow-ups marked done ÷ follow-ups due in the period (cancelled excluded) |
| Lead-to-client | won ÷ contacted, shown only with ≥ 20 contacted prospects |

Multiple replies from one person count once. Reply classification is done by you; unclassified replies
never count as positive.

## Insights and recommendations

`src/lib/insights/engine.ts` (tested in `tests/insights.test.ts`):

- A group difference is reported only when **both** sides have ≥ 5 posts with rates **and** the lift is ≥ 25%.
- Confidence: low (< 10), medium (10–19), high (≥ 20) by the smaller side's sample.
- Posting-time analysis needs ≥ 30 posts with metrics and ≥ 8 per time slot; otherwise the app says so.
- Wording describes associations, never causes. Every item stores its evidence (values, sample sizes, ids).

## Pipeline

- Open pipeline value: Σ recorded estimated values of open opportunities, **USD only, unweighted**.
- Win rate: won ÷ (won + lost), shown with ≥ 5 closed opportunities.
- Attribution: an opportunity is credited to every touchpoint you recorded — association, not causation.
