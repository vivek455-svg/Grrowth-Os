/**
 * Outreach metrics. Cohort-based and de-duplicated by prospect.
 *
 * Cohort: unique prospects with at least one successful outbound touch inside the period
 * (failed/bounced deliveries are excluded). Replies are attributed to the cohort when they
 * arrive after that prospect's first in-period touch. Multiple replies from one prospect count once.
 * See docs/METRICS.md for every formula.
 */
import type { EventType, Sentiment } from "@/db/schema";
import { MIN_SAMPLE, type Period, inPeriod, safeRate } from "./period";

export const OUTBOUND_TYPES: EventType[] = [
  "email_sent",
  "linkedin_sent",
  "x_dm_sent",
  "x_public_reply",
  "connection_request_sent",
];
export const INBOUND_TYPES: EventType[] = ["email_received", "linkedin_received", "x_reply_received"];

export type EventLike = {
  prospectId: string;
  type: EventType;
  direction: "outbound" | "inbound" | "internal";
  occurredAt: Date;
  deliveryStatus: "sent" | "delivered" | "failed" | "bounced" | null;
  sentiment: Sentiment | null;
  campaignId: string | null;
  channel: "email" | "linkedin" | "x" | null;
};

export type OpportunityLike = {
  prospectId: string | null;
  createdAt: Date;
  closedAt: Date | null;
  stageKind: "open" | "won" | "lost";
  valueCents: number | null;
};

export type FollowUpLike = { dueAt: Date; status: "pending" | "done" | "skipped" | "cancelled" };

export type Rate = { value: number | null; numerator: number; denominator: number; sufficient: boolean };

function rate(numerator: number, denominator: number): Rate {
  return { value: safeRate(numerator, denominator), numerator, denominator, sufficient: denominator >= MIN_SAMPLE };
}

export function isSuccessfulOutbound(e: EventLike) {
  return (
    e.direction === "outbound" &&
    OUTBOUND_TYPES.includes(e.type) &&
    e.deliveryStatus !== "failed" &&
    e.deliveryStatus !== "bounced"
  );
}

export function isInboundReply(e: EventLike) {
  return e.direction === "inbound" && INBOUND_TYPES.includes(e.type);
}

export type OutreachFilter = { channel?: "email" | "linkedin" | "x"; campaignId?: string; prospectIds?: Set<string> };

export function filterEvents(events: EventLike[], f: OutreachFilter) {
  return events.filter(
    (e) =>
      (!f.channel || e.channel === f.channel) &&
      (!f.campaignId || e.campaignId === f.campaignId) &&
      (!f.prospectIds || f.prospectIds.has(e.prospectId)),
  );
}

export type OutreachSummary = {
  messagesSent: number;
  failedOrBounced: number;
  contacted: number;
  replied: number;
  positive: number;
  callsBooked: number;
  qualifiedOpportunities: number;
  won: number;
  wonValueCents: number;
  replyRate: Rate;
  positiveReplyRate: Rate;
  meetingRate: Rate;
  qualifiedOpportunityRate: Rate;
  wonRate: Rate;
  followUpCompletion: Rate;
  /** Only meaningful with a large cohort; flagged insufficient below 20 contacted prospects. */
  leadToClient: Rate;
};

export function summarizeOutreach(input: {
  events: EventLike[];
  opportunities: OpportunityLike[];
  followUps: FollowUpLike[];
  period: Period;
  now?: Date;
}): OutreachSummary {
  const { events, opportunities, followUps, period } = input;
  const now = input.now ?? new Date();

  const outboundInPeriod = events.filter((e) => e.direction === "outbound" && inPeriod(e.occurredAt, period));
  const successful = outboundInPeriod.filter(isSuccessfulOutbound);

  const firstTouch = new Map<string, Date>();
  for (const e of successful) {
    const prev = firstTouch.get(e.prospectId);
    if (!prev || e.occurredAt < prev) firstTouch.set(e.prospectId, e.occurredAt);
  }
  const cohort = new Set(firstTouch.keys());

  const replied = new Set<string>();
  const positive = new Set<string>();
  for (const e of events) {
    if (!isInboundReply(e)) continue;
    const first = firstTouch.get(e.prospectId);
    if (!first || e.occurredAt < first || e.occurredAt > now) continue;
    replied.add(e.prospectId);
    if (e.sentiment === "positive") positive.add(e.prospectId);
  }

  const booked = new Set(
    events.filter((e) => e.type === "call_booked" && inPeriod(e.occurredAt, period)).map((e) => e.prospectId),
  );
  const bookedInCohort = [...booked].filter((p) => cohort.has(p)).length;

  const oppsInPeriod = opportunities.filter((o) => inPeriod(o.createdAt, period));
  const wonInPeriod = opportunities.filter((o) => o.stageKind === "won" && o.closedAt && inPeriod(o.closedAt, period));
  const cohortWithOpp = new Set(opportunities.filter((o) => o.prospectId && cohort.has(o.prospectId)).map((o) => o.prospectId!));
  const cohortWon = new Set(
    opportunities.filter((o) => o.stageKind === "won" && o.prospectId && cohort.has(o.prospectId)).map((o) => o.prospectId!),
  );

  const dueInPeriod = followUps.filter((f) => f.status !== "cancelled" && inPeriod(f.dueAt, period) && f.dueAt <= now);
  const completed = dueInPeriod.filter((f) => f.status === "done").length;

  const leadToClient = rate(cohortWon.size, cohort.size);
  leadToClient.sufficient = cohort.size >= 20;

  return {
    messagesSent: successful.length,
    failedOrBounced: outboundInPeriod.length - successful.length,
    contacted: cohort.size,
    replied: replied.size,
    positive: positive.size,
    callsBooked: booked.size,
    qualifiedOpportunities: oppsInPeriod.filter((o) => o.stageKind !== "lost").length,
    won: wonInPeriod.length,
    wonValueCents: wonInPeriod.reduce((s, o) => s + (o.valueCents ?? 0), 0),
    replyRate: rate(replied.size, cohort.size),
    positiveReplyRate: rate(positive.size, cohort.size),
    meetingRate: rate(bookedInCohort, cohort.size),
    qualifiedOpportunityRate: rate(cohortWithOpp.size, cohort.size),
    wonRate: rate(cohortWon.size, cohort.size),
    followUpCompletion: rate(completed, dueInPeriod.length),
    leadToClient,
  };
}

/** Per-campaign rates using the same definitions, for campaign reporting. */
export function campaignBreakdown(events: EventLike[], opportunities: OpportunityLike[], period: Period, now?: Date) {
  const ids = new Set(events.map((e) => e.campaignId).filter((c): c is string => !!c));
  return [...ids].map((campaignId) => {
    const scoped = events.filter((e) => e.campaignId === campaignId);
    const cohortProspects = new Set(scoped.map((e) => e.prospectId));
    // Replies are often not tagged with a campaign; include inbound events from cohort prospects.
    const inbound = events.filter((e) => isInboundReply(e) && cohortProspects.has(e.prospectId));
    return {
      campaignId,
      summary: summarizeOutreach({
        events: [...scoped.filter((e) => !isInboundReply(e)), ...inbound],
        opportunities,
        followUps: [],
        period,
        now,
      }),
    };
  });
}
