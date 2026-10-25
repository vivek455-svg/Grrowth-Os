"use server";

import { z } from "zod";
import { and, eq, inArray, max } from "drizzle-orm";
import {
  campaignProspects,
  conversationEvents,
  leadStatuses,
  opportunities,
  opportunityTouchpoints,
  outreachCampaigns,
  pipelineStages,
  prospects,
} from "@/db/schema";
import { UserError, audit, defineAction, optionalText } from "@/server/action";
import { cooldownBlock } from "@/lib/domain/outreach-rules";
import { profiles } from "@/db/schema";

const uuid = z.string().uuid();

const money = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v) => (v === "" || v === null || v === undefined ? null : Math.round(Number(v) * 100)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Enter a positive amount");

const oppFields = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  prospectId: uuid.nullable().optional(),
  company: optionalText(200),
  serviceType: optionalText(200),
  value: money,
  currency: z.string().trim().toUpperCase().length(3).default("USD"),
  expectedCloseDate: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
  stage: z.string().min(1),
  sourceChannel: z.enum(["content", "outreach", "referral", "inbound", "other"]).nullable().optional(),
  outreachCampaignId: uuid.nullable().optional(),
  contentItemId: uuid.nullable().optional(),
  nextAction: optionalText(500),
  nextActionAt: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),
  outcomeNotes: optionalText(5000),
});

export const saveOpportunity = defineAction(
  "opportunity.save",
  oppFields.extend({ id: uuid.optional() }),
  async ({ id, value, ...input }, { tx }) => {
    const [stage] = await tx.select().from(pipelineStages).where(eq(pipelineStages.key, input.stage));
    if (!stage) throw new UserError("Unknown pipeline stage.");
    const closedAt = stage.kind === "open" ? null : new Date();
    const values = {
      ...input,
      valueCents: value,
      prospectId: input.prospectId ?? null,
      sourceChannel: input.sourceChannel ?? null,
      outreachCampaignId: input.outreachCampaignId ?? null,
      contentItemId: input.contentItemId ?? null,
      lastActivityAt: new Date(),
    };
    if (id) {
      const [current] = await tx.select().from(opportunities).where(eq(opportunities.id, id));
      if (!current) throw new UserError("Opportunity not found.");
      await tx
        .update(opportunities)
        .set({ ...values, closedAt: stage.kind === "open" ? null : (current.closedAt ?? closedAt) })
        .where(eq(opportunities.id, id));
      return { id };
    }
    const [o] = await tx.insert(opportunities).values({ ...values, closedAt }).returning({ id: opportunities.id });
    if (input.prospectId) {
      await tx.insert(conversationEvents).values({
        prospectId: input.prospectId,
        type: "opportunity_created",
        direction: "internal",
        source: "system",
        content: input.name,
      });
    }
    // Record the primary source as a touchpoint so attribution reporting has a starting point.
    if (input.sourceChannel)
      await tx.insert(opportunityTouchpoints).values({
        opportunityId: o!.id,
        kind: input.sourceChannel,
        contentItemId: input.contentItemId ?? null,
        outreachCampaignId: input.outreachCampaignId ?? null,
        note: "Primary source",
      });
    return { id: o!.id };
  },
);

export const moveOpportunity = defineAction(
  "opportunity.move",
  z.object({ id: uuid, stage: z.string().min(1) }),
  async ({ id, stage }, { tx }) => {
    const [s] = await tx.select().from(pipelineStages).where(eq(pipelineStages.key, stage));
    if (!s) throw new UserError("Unknown stage.");
    const [o] = await tx.select().from(opportunities).where(eq(opportunities.id, id));
    if (!o) throw new UserError("Opportunity not found.");
    await tx
      .update(opportunities)
      .set({ stage, lastActivityAt: new Date(), closedAt: s.kind === "open" ? null : (o.closedAt ?? new Date()) })
      .where(eq(opportunities.id, id));
    // Keep the prospect's lead status consistent with a won/lost outcome.
    if (o.prospectId && s.kind !== "open") {
      const target = s.kind === "won" ? "won" : "lost";
      const [hasStatus] = await tx.select().from(leadStatuses).where(eq(leadStatuses.key, target));
      if (hasStatus) await tx.update(prospects).set({ status: target }).where(eq(prospects.id, o.prospectId));
    }
    return null;
  },
);

export const deleteOpportunity = defineAction("opportunity.delete", z.object({ id: uuid }), async ({ id }, { tx }) => {
  await tx.delete(opportunities).where(eq(opportunities.id, id));
  await audit(tx, "opportunity.deleted", { type: "opportunity", id });
  return null;
});

export const addTouchpoint = defineAction(
  "opportunity.touchpoint",
  z.object({
    opportunityId: uuid,
    kind: z.enum(["content", "outreach", "referral", "inbound", "other"]),
    contentItemId: uuid.nullable().optional(),
    outreachCampaignId: uuid.nullable().optional(),
    note: optionalText(500),
  }),
  async (input, { tx }) => {
    await tx.insert(opportunityTouchpoints).values({ ...input, contentItemId: input.contentItemId ?? null, outreachCampaignId: input.outreachCampaignId ?? null });
    return null;
  },
);

export const removeTouchpoint = defineAction("opportunity.touchpoint_remove", z.object({ id: uuid }), async ({ id }, { tx }) => {
  await tx.delete(opportunityTouchpoints).where(eq(opportunityTouchpoints.id, id));
  return null;
});

// ---------------------------------------------------------------------------
// Pipeline stages & lead statuses (custom)
// ---------------------------------------------------------------------------
const keyFrom = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

export const addPipelineStage = defineAction(
  "stage.add",
  z.object({ label: z.string().trim().min(1).max(40), kind: z.enum(["open", "won", "lost"]).default("open") }),
  async ({ label, kind }, { tx }) => {
    const key = keyFrom(label);
    if (!key) throw new UserError("Use letters or numbers in the stage name.");
    const [{ m }] = (await tx.select({ m: max(pipelineStages.sortOrder) }).from(pipelineStages)) as [{ m: number | null }];
    await tx.insert(pipelineStages).values({ key, label, kind, sortOrder: (m ?? 0) + 10 });
    return null;
  },
);

export const renameStage = defineAction(
  "stage.rename",
  z.object({ key: z.string(), label: z.string().trim().min(1).max(40), sortOrder: z.number().int().optional() }),
  async ({ key, label, sortOrder }, { tx }) => {
    await tx.update(pipelineStages).set({ label, ...(sortOrder !== undefined ? { sortOrder } : {}) }).where(eq(pipelineStages.key, key));
    return null;
  },
);

export const deleteStage = defineAction("stage.delete", z.object({ key: z.string() }), async ({ key }, { tx }) => {
  const used = await tx.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.stage, key)).limit(1);
  if (used.length) throw new UserError("Move the opportunities in this stage first.");
  await tx.delete(pipelineStages).where(eq(pipelineStages.key, key));
  return null;
});

export const addLeadStatus = defineAction(
  "status.add",
  z.object({ label: z.string().trim().min(1).max(40), category: z.enum(["open", "active", "won", "lost", "excluded"]).default("active") }),
  async ({ label, category }, { tx }) => {
    const key = keyFrom(label);
    if (!key) throw new UserError("Use letters or numbers in the status name.");
    const [{ m }] = (await tx.select({ m: max(leadStatuses.sortOrder) }).from(leadStatuses)) as [{ m: number | null }];
    await tx.insert(leadStatuses).values({ key, label, category, sortOrder: (m ?? 0) + 10, isSystem: false });
    return null;
  },
);

export const deleteLeadStatus = defineAction("status.delete", z.object({ key: z.string() }), async ({ key }, { tx }) => {
  const [s] = await tx.select().from(leadStatuses).where(eq(leadStatuses.key, key));
  if (!s) throw new UserError("Status not found.");
  if (s.isSystem) throw new UserError("Built-in statuses can be renamed but not deleted.");
  const used = await tx.select({ id: prospects.id }).from(prospects).where(eq(prospects.status, key)).limit(1);
  if (used.length) throw new UserError("Move prospects out of this status first.");
  await tx.delete(leadStatuses).where(eq(leadStatuses.key, key));
  return null;
});

export const renameLeadStatus = defineAction(
  "status.rename",
  z.object({ key: z.string(), label: z.string().trim().min(1).max(40) }),
  async ({ key, label }, { tx }) => {
    await tx.update(leadStatuses).set({ label }).where(eq(leadStatuses.key, key));
    return null;
  },
);

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
const campaignFields = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: optionalText(2000),
  targetAudience: optionalText(1000),
  criteria: optionalText(2000),
  channel: z.enum(["email", "linkedin", "x", "mixed"]),
  messageStrategy: optionalText(4000),
  startDate: z.string().optional().nullable().transform((v) => v || null),
  endDate: z.string().optional().nullable().transform((v) => v || null),
  status: z.enum(["draft", "active", "paused", "completed"]).default("draft"),
});

export const saveCampaign = defineAction("campaign.save", campaignFields.extend({ id: uuid.optional() }), async ({ id, ...input }, { tx }) => {
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw new UserError("End date must be after the start date.");
  if (id) {
    await tx.update(outreachCampaigns).set(input).where(eq(outreachCampaigns.id, id));
    return { id };
  }
  const [c] = await tx.insert(outreachCampaigns).values(input).returning({ id: outreachCampaigns.id });
  return { id: c!.id };
});

export const deleteCampaign = defineAction("campaign.delete", z.object({ id: uuid }), async ({ id }, { tx }) => {
  await tx.delete(outreachCampaigns).where(eq(outreachCampaigns.id, id));
  await audit(tx, "campaign.deleted", { type: "campaign", id });
  return null;
});

/**
 * Adds prospects to a campaign. Enrolment only queues them for review — nothing is sent.
 * Prospects excluded by status or contacted within the cooldown window are skipped and reported.
 */
export const addToCampaign = defineAction(
  "campaign.add_prospects",
  z.object({ campaignId: uuid, prospectIds: z.array(uuid).min(1).max(500), ignoreCooldown: z.boolean().default(false) }),
  async ({ campaignId, prospectIds, ignoreCooldown }, { tx, user }) => {
    const [profile] = await tx.select().from(profiles).where(eq(profiles.id, user.id));
    const statuses = await tx.select().from(leadStatuses);
    const excluded = new Set(statuses.filter((s) => s.category === "excluded").map((s) => s.key));
    const rows = await tx.select().from(prospects).where(inArray(prospects.id, prospectIds));
    const skipped: { name: string; reason: string }[] = [];
    const ok: string[] = [];
    for (const p of rows) {
      if (excluded.has(p.status)) {
        skipped.push({ name: p.fullName, reason: "Excluded status" });
        continue;
      }
      const cd = ignoreCooldown ? null : cooldownBlock(p.lastContactedAt, profile?.outreachCooldownDays ?? 30);
      if (cd) {
        skipped.push({ name: p.fullName, reason: cd });
        continue;
      }
      ok.push(p.id);
    }
    if (ok.length)
      await tx
        .insert(campaignProspects)
        .values(ok.map((prospectId) => ({ campaignId, prospectId })))
        .onConflictDoNothing();
    return { added: ok.length, skipped };
  },
);

export const removeFromCampaign = defineAction(
  "campaign.remove_prospect",
  z.object({ campaignId: uuid, prospectId: uuid }),
  async ({ campaignId, prospectId }, { tx }) => {
    await tx.delete(campaignProspects).where(and(eq(campaignProspects.campaignId, campaignId), eq(campaignProspects.prospectId, prospectId)));
    return null;
  },
);
