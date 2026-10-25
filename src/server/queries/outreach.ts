import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { addDays, endOfDay, startOfDay } from "date-fns";
import type { Tx } from "@/db/client";
import {
  campaignProspects,
  contentItems,
  conversationEvents,
  followUps,
  integrations,
  leadStatuses,
  opportunities,
  opportunityTouchpoints,
  outreachCampaigns,
  outreachMessages,
  pipelineStages,
  prospects,
} from "@/db/schema";
import { filterEvents, summarizeOutreach } from "@/lib/metrics/outreach";
import { loadOutreachDataset } from "./analytics";

const DAY = 86400000;

export async function inboxEvents(tx: Tx, view: string) {
  const where =
    view === "replies"
      ? eq(conversationEvents.direction, "inbound")
      : view === "sent"
        ? eq(conversationEvents.direction, "outbound")
        : sql`${conversationEvents.type} not in ('status_changed')`;
  return tx
    .select({
      e: conversationEvents,
      prospectName: prospects.fullName,
      company: prospects.company,
      campaign: outreachCampaigns.name,
    })
    .from(conversationEvents)
    .innerJoin(prospects, eq(prospects.id, conversationEvents.prospectId))
    .leftJoin(outreachCampaigns, eq(outreachCampaigns.id, conversationEvents.campaignId))
    .where(where)
    .orderBy(desc(conversationEvents.occurredAt))
    .limit(200);
}

export async function messagesByStatus(tx: Tx, statuses: ("draft" | "approved" | "failed" | "bounced" | "sending")[]) {
  return tx
    .select({ m: outreachMessages, prospectName: prospects.fullName, company: prospects.company, campaign: outreachCampaigns.name })
    .from(outreachMessages)
    .innerJoin(prospects, eq(prospects.id, outreachMessages.prospectId))
    .leftJoin(outreachCampaigns, eq(outreachCampaigns.id, outreachMessages.campaignId))
    .where(inArray(outreachMessages.status, statuses))
    .orderBy(desc(outreachMessages.updatedAt));
}

export async function connectedChannels(tx: Tx) {
  const rows = await tx.select({ provider: integrations.provider, status: integrations.status, lastSyncAt: integrations.lastSyncAt }).from(integrations);
  return Object.fromEntries(rows.map((r) => [r.provider, r]));
}

export async function followUpBuckets(tx: Tx) {
  const now = new Date();
  const pending = await tx
    .select({ f: followUps, p: prospects })
    .from(followUps)
    .innerJoin(prospects, eq(prospects.id, followUps.prospectId))
    .where(and(eq(followUps.status, "pending"), lte(followUps.dueAt, endOfDay(addDays(now, 7)))))
    .orderBy(asc(followUps.dueAt));

  // Last outbound/inbound per prospect, for "waiting" and "gone quiet".
  const last = await tx.execute<{ prospect_id: string; last_out: Date | null; last_in: Date | null; last_out_content: string | null; last_out_channel: string | null }>(sql`
    select prospect_id,
      max(occurred_at) filter (where direction = 'outbound') as last_out,
      max(occurred_at) filter (where direction = 'inbound') as last_in,
      (array_agg(content order by occurred_at desc) filter (where direction = 'outbound'))[1] as last_out_content,
      (array_agg(channel order by occurred_at desc) filter (where direction = 'outbound'))[1] as last_out_channel
    from conversation_events group by prospect_id`);
  const lastMap = new Map([...last].map((r) => [r.prospect_id, { ...r, last_out: r.last_out ? new Date(r.last_out) : null, last_in: r.last_in ? new Date(r.last_in) : null }]));
  const excluded = new Set((await tx.select({ key: leadStatuses.key }).from(leadStatuses).where(inArray(leadStatuses.category, ["excluded", "won", "lost"]))).map((s) => s.key));
  const withPending = new Set((await tx.select({ id: followUps.prospectId }).from(followUps).where(eq(followUps.status, "pending"))).map((r) => r.id));
  const allProspects = await tx.select().from(prospects);

  const waiting = allProspects
    .filter((p) => !excluded.has(p.status) && !withPending.has(p.id))
    .map((p) => ({ p, l: lastMap.get(p.id) }))
    .filter(({ l }) => l?.last_out && (!l.last_in || l.last_in < l.last_out) && now.getTime() - l.last_out.getTime() > 3 * DAY)
    .map(({ p, l }) => ({ p, lastOut: l!.last_out!, lastOutContent: l!.last_out_content, channel: l!.last_out_channel, suggested: new Date(Math.max(now.getTime() + DAY, l!.last_out!.getTime() + 5 * DAY)) }))
    .sort((a, b) => a.lastOut.getTime() - b.lastOut.getTime());

  const quiet = allProspects
    .filter((p) => !excluded.has(p.status))
    .map((p) => ({ p, l: lastMap.get(p.id) }))
    // A real two-way conversation with no activity on either side for 14+ days.
    .filter(({ l }) => l?.last_in && l.last_out && Math.max(l.last_in.getTime(), l.last_out.getTime()) < now.getTime() - 14 * DAY)
    .map(({ p, l }) => ({ p, lastActivity: new Date(Math.max(l!.last_in!.getTime(), l!.last_out!.getTime())) }));

  const openOpp = new Set(
    (
      await tx
        .select({ id: opportunities.prospectId })
        .from(opportunities)
        .innerJoin(pipelineStages, and(eq(pipelineStages.key, opportunities.stage), eq(pipelineStages.userId, opportunities.userId)))
        .where(eq(pipelineStages.kind, "open"))
    ).map((r) => r.id),
  );
  const interestedNoStep = allProspects.filter((p) => p.status === "interested" && !withPending.has(p.id) && !openOpp.has(p.id));

  const staleOpps = await tx
    .select({ o: opportunities, stageLabel: pipelineStages.label })
    .from(opportunities)
    .innerJoin(pipelineStages, and(eq(pipelineStages.key, opportunities.stage), eq(pipelineStages.userId, opportunities.userId)))
    .where(and(eq(pipelineStages.kind, "open"), sql`coalesce(${opportunities.lastActivityAt}, ${opportunities.createdAt}) < ${new Date(now.getTime() - 14 * DAY).toISOString()}::timestamptz`));

  const enrich = (f: (typeof pending)[number]) => ({ ...f, lastOutContent: lastMap.get(f.p.id)?.last_out_content ?? null, channel: (lastMap.get(f.p.id)?.last_out_channel ?? f.p.preferredChannel) as string | null });
  return {
    overdue: pending.filter((x) => x.f.dueAt < startOfDay(now)).map(enrich),
    today: pending.filter((x) => x.f.dueAt >= startOfDay(now) && x.f.dueAt <= endOfDay(now)).map(enrich),
    week: pending.filter((x) => x.f.dueAt > endOfDay(now)).map(enrich),
    waiting,
    quiet,
    interestedNoStep,
    staleOpps,
  };
}

export async function pipeline(tx: Tx) {
  const stages = await tx.select().from(pipelineStages).orderBy(asc(pipelineStages.sortOrder));
  const rows = await tx
    .select({ o: opportunities, prospectName: prospects.fullName, campaign: outreachCampaigns.name, content: contentItems.title })
    .from(opportunities)
    .leftJoin(prospects, eq(prospects.id, opportunities.prospectId))
    .leftJoin(outreachCampaigns, eq(outreachCampaigns.id, opportunities.outreachCampaignId))
    .leftJoin(contentItems, eq(contentItems.id, opportunities.contentItemId))
    .orderBy(desc(opportunities.updatedAt));
  const touchpoints = await tx
    .select({ t: opportunityTouchpoints, content: contentItems.title, campaign: outreachCampaigns.name })
    .from(opportunityTouchpoints)
    .leftJoin(contentItems, eq(contentItems.id, opportunityTouchpoints.contentItemId))
    .leftJoin(outreachCampaigns, eq(outreachCampaigns.id, opportunityTouchpoints.outreachCampaignId));
  return { stages, rows, touchpoints };
}

export async function campaignStats(tx: Tx) {
  const campaigns = await tx.select().from(outreachCampaigns).orderBy(desc(outreachCampaigns.createdAt));
  const members = await tx.select({ campaignId: campaignProspects.campaignId, state: campaignProspects.state }).from(campaignProspects);
  const data = await loadOutreachDataset(tx, null);
  const allTime = { start: new Date(0), end: new Date() };
  return campaigns.map((c) => {
    const scoped = filterEvents(data.events, { campaignId: c.id });
    const cohort = new Set(scoped.map((e) => e.prospectId));
    const s = summarizeOutreach({
      events: [...scoped, ...data.events.filter((e) => e.direction === "inbound" && cohort.has(e.prospectId) && e.campaignId !== c.id), ...data.events.filter((e) => e.type === "call_booked" && cohort.has(e.prospectId))],
      opportunities: data.opportunities.filter((o) => o.outreachCampaignId === c.id),
      followUps: [],
      period: allTime,
    });
    const m = members.filter((x) => x.campaignId === c.id);
    return { c, members: m.length, queued: m.filter((x) => x.state === "queued" || x.state === "drafted" || x.state === "approved").length, s };
  });
}

export async function campaignDetail(tx: Tx, id: string) {
  const [c] = await tx.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, id));
  if (!c) return null;
  const members = await tx
    .select({ cp: campaignProspects, p: prospects })
    .from(campaignProspects)
    .innerJoin(prospects, eq(prospects.id, campaignProspects.prospectId))
    .where(eq(campaignProspects.campaignId, id))
    .orderBy(asc(prospects.fullName));
  const queue = await tx
    .select({ m: outreachMessages, prospectName: prospects.fullName })
    .from(outreachMessages)
    .innerJoin(prospects, eq(prospects.id, outreachMessages.prospectId))
    .where(and(eq(outreachMessages.campaignId, id), inArray(outreachMessages.status, ["draft", "approved", "failed"])))
    .orderBy(asc(outreachMessages.createdAt));
  const stats = (await campaignStats(tx)).find((x) => x.c.id === id)!;
  const statuses = await tx.select().from(leadStatuses);
  const timeline = await tx
    .select({ day: sql<string>`to_char(date_trunc('week', ${conversationEvents.occurredAt}), 'YYYY-MM-DD')`, sent: sql<number>`count(*) filter (where ${conversationEvents.direction} = 'outbound')::int`, replies: sql<number>`count(*) filter (where ${conversationEvents.direction} = 'inbound')::int` })
    .from(conversationEvents)
    .where(and(eq(conversationEvents.campaignId, id), gte(conversationEvents.occurredAt, new Date(Date.now() - 120 * DAY))))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return { c, members, queue, stats, statuses, timeline };
}
