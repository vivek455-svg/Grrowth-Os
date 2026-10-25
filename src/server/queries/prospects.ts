import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { endOfDay } from "date-fns";
import type { Tx } from "@/db/client";
import {
  campaignProspects,
  conversationEvents,
  conversations,
  followUps,
  leadStatuses,
  opportunities,
  outreachCampaigns,
  outreachMessages,
  pipelineStages,
  prospectResearch,
  prospects,
  prospectSources,
  savedViews,
  suppressionList,
} from "@/db/schema";
import { suppressionReason } from "@/lib/domain/outreach-rules";

/** Built-in saved views. User-defined views are stored in saved_views with the same filter keys. */
export const BUILTIN_VIEWS: { key: string; name: string; filters: Record<string, string> }[] = [
  { key: "new-founders", name: "New founders", filters: { status: "new", persona: "founder" } },
  { key: "saas", name: "SaaS companies", filters: { companyType: "saas" } },
  { key: "agencies", name: "Design agencies", filters: { companyType: "agency" } },
  { key: "high-fit", name: "High-fit", filters: { fitMin: "75" } },
  { key: "high-fit-uncontacted", name: "High-fit, not contacted", filters: { fitMin: "75", uncontacted: "1" } },
  { key: "ready", name: "Ready to contact", filters: { status: "ready" } },
  { key: "followups-due", name: "Follow-ups due", filters: { due: "1" } },
  { key: "positive", name: "Positive replies", filters: { positive: "1" } },
  { key: "opportunities", name: "With opportunities", filters: { hasOpp: "1" } },
];

export type ProspectFilters = {
  q?: string;
  status?: string;
  priority?: string;
  channel?: string;
  companyType?: string;
  persona?: string;
  tag?: string;
  fitMin?: string;
  campaign?: string;
  uncontacted?: string;
  due?: string;
  positive?: string;
  hasOpp?: string;
  sort?: string;
};

export async function listProspects(tx: Tx, f: ProspectFilters) {
  const where: (SQL | undefined)[] = [];
  if (f.q) {
    const term = `%${f.q.replace(/[%_]/g, "")}%`;
    where.push(or(ilike(prospects.fullName, term), ilike(prospects.company, term), ilike(prospects.email, term), ilike(prospects.jobTitle, term), ilike(prospects.industry, term)));
  }
  if (f.status) where.push(eq(prospects.status, f.status));
  if (f.priority) where.push(eq(prospects.priority, f.priority as "high"));
  if (f.channel) where.push(eq(prospects.preferredChannel, f.channel as "email"));
  if (f.companyType) where.push(ilike(prospects.companyType, `%${f.companyType}%`));
  if (f.persona) where.push(ilike(prospects.persona, `%${f.persona}%`));
  if (f.tag) where.push(sql`${f.tag} = any(${prospects.tags})`);
  if (f.fitMin && /^\d+$/.test(f.fitMin)) where.push(gte(prospects.fitScore, Number(f.fitMin)));
  if (f.uncontacted) where.push(isNull(prospects.lastContactedAt));
  if (f.due) where.push(lte(prospects.nextFollowUpAt, endOfDay(new Date())));
  if (f.campaign) where.push(sql`exists (select 1 from campaign_prospects cp where cp.prospect_id = ${prospects.id} and cp.campaign_id = ${f.campaign})`);
  if (f.positive) where.push(sql`exists (select 1 from conversation_events e where e.prospect_id = ${prospects.id} and e.sentiment = 'positive')`);
  if (f.hasOpp) where.push(sql`exists (select 1 from opportunities o where o.prospect_id = ${prospects.id})`);
  if (f.uncontacted || f.fitMin) where.push(sql`${prospects.status} not in (select key from lead_statuses where category = 'excluded')`);

  const order =
    f.sort === "fit"
      ? [sql`${prospects.fitScore} desc nulls last`]
      : f.sort === "name"
        ? [asc(prospects.fullName)]
        : f.sort === "contacted"
          ? [sql`${prospects.lastContactedAt} desc nulls last`]
          : f.sort === "followup"
            ? [sql`${prospects.nextFollowUpAt} asc nulls last`]
            : [desc(prospects.createdAt)];

  return tx
    .select({
      id: prospects.id,
      fullName: prospects.fullName,
      jobTitle: prospects.jobTitle,
      company: prospects.company,
      companyWebsite: prospects.companyWebsite,
      email: prospects.email,
      linkedinUrl: prospects.linkedinUrl,
      xUrl: prospects.xUrl,
      companyType: prospects.companyType,
      status: prospects.status,
      priority: prospects.priority,
      fitScore: prospects.fitScore,
      preferredChannel: prospects.preferredChannel,
      tags: prospects.tags,
      lastContactedAt: prospects.lastContactedAt,
      nextFollowUpAt: prospects.nextFollowUpAt,
      createdAt: prospects.createdAt,
      domainKey: prospects.domainKey,
    })
    .from(prospects)
    .where(and(...where))
    .orderBy(...order)
    .limit(1000);
}

export async function prospectFilterOptions(tx: Tx) {
  const statuses = await tx.select().from(leadStatuses).orderBy(asc(leadStatuses.sortOrder));
  const tags = await tx.execute<{ tag: string }>(sql`select distinct unnest(tags) as tag from prospects order by 1`);
  const types = await tx.selectDistinct({ v: prospects.companyType }).from(prospects).where(sql`${prospects.companyType} is not null`);
  const campaigns = await tx.select({ id: outreachCampaigns.id, name: outreachCampaigns.name }).from(outreachCampaigns).orderBy(asc(outreachCampaigns.name));
  const views = await tx.select().from(savedViews).where(eq(savedViews.entity, "prospects")).orderBy(asc(savedViews.name));
  return { statuses, tags: [...tags].map((t) => t.tag), companyTypes: types.map((t) => t.v!), campaigns, views };
}

export async function prospectDetail(tx: Tx, id: string) {
  const [p] = await tx.select().from(prospects).where(eq(prospects.id, id));
  if (!p) return null;
  const [events, research, messages, fus, opps, camps, sources, convs, suppression, statuses, stages] = await Promise.all([
    tx.select().from(conversationEvents).where(eq(conversationEvents.prospectId, id)).orderBy(desc(conversationEvents.occurredAt)),
    tx.select().from(prospectResearch).where(eq(prospectResearch.prospectId, id)).orderBy(desc(prospectResearch.createdAt)),
    tx.select().from(outreachMessages).where(eq(outreachMessages.prospectId, id)).orderBy(desc(outreachMessages.createdAt)),
    tx.select().from(followUps).where(eq(followUps.prospectId, id)).orderBy(asc(followUps.dueAt)),
    tx
      .select({ o: opportunities, stageLabel: pipelineStages.label, stageKind: pipelineStages.kind })
      .from(opportunities)
      .innerJoin(pipelineStages, and(eq(pipelineStages.key, opportunities.stage), eq(pipelineStages.userId, opportunities.userId)))
      .where(eq(opportunities.prospectId, id)),
    tx
      .select({ id: outreachCampaigns.id, name: outreachCampaigns.name, state: campaignProspects.state, channel: outreachCampaigns.channel })
      .from(campaignProspects)
      .innerJoin(outreachCampaigns, eq(outreachCampaigns.id, campaignProspects.campaignId))
      .where(eq(campaignProspects.prospectId, id)),
    tx.select().from(prospectSources).where(eq(prospectSources.prospectId, id)),
    tx.select().from(conversations).where(eq(conversations.prospectId, id)),
    tx.select().from(suppressionList),
    tx.select().from(leadStatuses).orderBy(asc(leadStatuses.sortOrder)),
    tx.select().from(pipelineStages).orderBy(asc(pipelineStages.sortOrder)),
  ]);
  return {
    prospect: p,
    events,
    research,
    messages,
    followUps: fus,
    opportunities: opps,
    campaigns: camps,
    sources,
    conversations: convs,
    suppressed: suppressionReason(p, suppression),
    statuses,
    stages,
  };
}

export async function campaignsForProspects(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, string[]>();
  const rows = await tx
    .select({ prospectId: campaignProspects.prospectId, name: outreachCampaigns.name })
    .from(campaignProspects)
    .innerJoin(outreachCampaigns, eq(outreachCampaigns.id, campaignProspects.campaignId))
    .where(inArray(campaignProspects.prospectId, ids));
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.prospectId, [...(m.get(r.prospectId) ?? []), r.name]);
  return m;
}
