"use server";

import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  campaignProspects,
  conversationEvents,
  followUps,
  leadStatuses,
  prospects,
  savedViews,
  suppressionList,
  prospectSources,
} from "@/db/schema";
import { UserError, audit, defineAction, optionalDate, optionalText, optionalUrl } from "@/server/action";
import type { Tx } from "@/db/client";
import { findDuplicates, nextStatusAfterEvent, normalizeDomain, normalizeLinkedin, type DuplicateMatch } from "@/lib/domain/outreach-rules";
import { EVENT_TYPES } from "@/db/schema";
import { INBOUND_TYPES, OUTBOUND_TYPES } from "@/lib/metrics/outreach";

const uuid = z.string().uuid();
const channel = z.enum(["email", "linkedin", "x"]);

const prospectFields = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(200),
  jobTitle: optionalText(200),
  company: optionalText(200),
  companyWebsite: optionalUrl,
  linkedinUrl: optionalUrl,
  xUrl: optionalUrl,
  email: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email"),
  location: optionalText(200),
  companyType: optionalText(100),
  industry: optionalText(100),
  companySize: optionalText(50),
  source: optionalText(200),
  persona: optionalText(200),
  relevantServices: z.array(z.string().max(100)).max(20).default([]),
  websiteUrl: optionalUrl,
  websiteObservations: optionalText(5000),
  businessProblem: optionalText(2000),
  personalizationNotes: optionalText(5000),
  fitScore: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 100), "0–100"),
  fitExplanation: optionalText(2000),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  status: z.string().min(1).default("new"),
  preferredChannel: channel.nullable().optional(),
  tags: z.array(z.string().trim().toLowerCase().max(40)).max(30).default([]),
  nextFollowUpAt: optionalDate,
});

export type ProspectInput = z.input<typeof prospectFields>;

async function duplicatesFor(tx: Tx, input: { fullName: string; email?: string | null; linkedinUrl?: string | null; companyWebsite?: string | null; websiteUrl?: string | null }, excludeId?: string) {
  const domain = normalizeDomain(input.companyWebsite ?? input.websiteUrl);
  const linkedin = normalizeLinkedin(input.linkedinUrl);
  const candidates = await tx
    .select({
      id: prospects.id,
      fullName: prospects.fullName,
      company: prospects.company,
      email: prospects.email,
      linkedinUrl: prospects.linkedinUrl,
      companyWebsite: prospects.companyWebsite,
      websiteUrl: prospects.websiteUrl,
    })
    .from(prospects)
    .where(
      sql`(${input.email ? sql`lower(${prospects.email}) = ${input.email.toLowerCase()}` : sql`false`}
        or ${linkedin ? sql`${prospects.linkedinKey} = ${linkedin}` : sql`false`}
        or ${domain ? sql`${prospects.domainKey} = ${domain}` : sql`false`})`,
    );
  return findDuplicates(input, candidates.filter((c) => c.id !== excludeId));
}

async function ensureStatus(tx: Tx, key: string) {
  const [s] = await tx.select().from(leadStatuses).where(eq(leadStatuses.key, key));
  if (!s) throw new UserError("Unknown lead status.");
  return s;
}

/** Applies a status change with its side effects (timeline entry, suppression, follow-up cancellation). */
async function applyStatus(tx: Tx, prospectId: string, from: string, to: string, why?: string) {
  if (from === to) return;
  await tx.update(prospects).set({ status: to }).where(eq(prospects.id, prospectId));
  await tx.insert(conversationEvents).values({
    prospectId,
    type: "status_changed",
    direction: "internal",
    source: "system",
    content: `${from} → ${to}`,
    notes: why ?? null,
  });
  if (to === "do_not_contact") {
    await tx.insert(suppressionList).values({ prospectId, reason: "do_not_contact" });
    await tx
      .update(followUps)
      .set({ status: "cancelled", reason: sql`coalesce(${followUps.reason} || ' — ', '') || 'Cancelled: do not contact'` })
      .where(and(eq(followUps.prospectId, prospectId), eq(followUps.status, "pending")));
    await audit(tx, "prospect.do_not_contact", { type: "prospect", id: prospectId });
  }
}

export const createProspect = defineAction(
  "prospect.create",
  prospectFields.extend({ allowDuplicate: z.boolean().default(false) }),
  async ({ allowDuplicate, ...input }, { tx }): Promise<{ id: string | null; duplicates: DuplicateMatch[] }> => {
    await ensureStatus(tx, input.status);
    const duplicates = await duplicatesFor(tx, input);
    if (duplicates.length && !allowDuplicate) return { id: null, duplicates };
    const [p] = await tx
      .insert(prospects)
      .values({ ...input, preferredChannel: input.preferredChannel ?? null })
      .returning({ id: prospects.id });
    await tx.insert(prospectSources).values({ prospectId: p!.id, sourceType: "manual", reason: input.source ?? "Added manually", reviewStatus: "added" });
    return { id: p!.id, duplicates: [] };
  },
);

export const updateProspect = defineAction(
  "prospect.update",
  prospectFields.partial().extend({ id: uuid }),
  async ({ id, status, ...input }, { tx }) => {
    const [current] = await tx.select().from(prospects).where(eq(prospects.id, id));
    if (!current) throw new UserError("Prospect not found.");
    const fields = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (Object.keys(fields).length) await tx.update(prospects).set(fields).where(eq(prospects.id, id));
    if (status && status !== current.status) {
      await ensureStatus(tx, status);
      await applyStatus(tx, id, current.status, status);
    }
    return null;
  },
);

export const bulkUpdateProspects = defineAction(
  "prospect.bulk",
  z.object({
    ids: z.array(uuid).min(1).max(1000),
    op: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("status"), status: z.string().min(1) }),
      z.object({ kind: z.literal("add_tag"), tag: z.string().trim().toLowerCase().min(1).max(40) }),
      z.object({ kind: z.literal("remove_tag"), tag: z.string().trim().toLowerCase().min(1).max(40) }),
      z.object({ kind: z.literal("priority"), priority: z.enum(["low", "medium", "high"]) }),
      z.object({ kind: z.literal("campaign"), campaignId: uuid }),
      z.object({ kind: z.literal("delete") }),
    ]),
  }),
  async ({ ids, op }, { tx }) => {
    const rows = await tx.select({ id: prospects.id, status: prospects.status, tags: prospects.tags }).from(prospects).where(inArray(prospects.id, ids));
    switch (op.kind) {
      case "status":
        await ensureStatus(tx, op.status);
        for (const r of rows) await applyStatus(tx, r.id, r.status, op.status, "Bulk update");
        break;
      case "add_tag":
        await tx
          .update(prospects)
          .set({ tags: sql`array(select distinct unnest(${prospects.tags} || array[${op.tag}]::text[]))` })
          .where(inArray(prospects.id, ids));
        break;
      case "remove_tag":
        await tx.update(prospects).set({ tags: sql`array_remove(${prospects.tags}, ${op.tag})` }).where(inArray(prospects.id, ids));
        break;
      case "priority":
        await tx.update(prospects).set({ priority: op.priority }).where(inArray(prospects.id, ids));
        break;
      case "campaign":
        await tx
          .insert(campaignProspects)
          .values(rows.map((r) => ({ campaignId: op.campaignId, prospectId: r.id })))
          .onConflictDoNothing();
        break;
      case "delete":
        await tx.delete(prospects).where(inArray(prospects.id, ids));
        await audit(tx, "prospect.bulk_deleted", { type: "prospect" }, { count: rows.length });
        break;
    }
    return { affected: rows.length };
  },
);

export const deleteProspect = defineAction("prospect.delete", z.object({ id: uuid }), async ({ id }, { tx }) => {
  await tx.delete(prospects).where(eq(prospects.id, id));
  await audit(tx, "prospect.deleted", { type: "prospect", id });
  return null;
});

// ---------------------------------------------------------------------------
// Interactions (manual logging)
// ---------------------------------------------------------------------------
export const logInteraction = defineAction(
  "interaction.log",
  z.object({
    prospectId: uuid,
    type: z.enum(EVENT_TYPES),
    occurredAt: z.coerce.date().default(() => new Date()),
    content: optionalText(20000),
    notes: optionalText(5000),
    sentiment: z.enum(["positive", "neutral", "negative", "opt_out"]).nullable().optional(),
    campaignId: uuid.nullable().optional(),
    followUpAt: optionalDate,
  }),
  async (input, { tx }) => {
    const [p] = await tx.select().from(prospects).where(eq(prospects.id, input.prospectId));
    if (!p) throw new UserError("Prospect not found.");
    if (input.occurredAt > new Date(Date.now() + 5 * 60000)) throw new UserError("Interactions can't be logged in the future.");
    const isOutbound = OUTBOUND_TYPES.includes(input.type);
    const isInbound = INBOUND_TYPES.includes(input.type);
    if (isOutbound && (p.status === "do_not_contact")) throw new UserError("This prospect is marked do not contact.");

    const ch = input.type.startsWith("email") ? "email" : input.type.startsWith("linkedin") || input.type === "connection_request_sent" ? "linkedin" : input.type.startsWith("x_") ? "x" : null;
    const [event] = await tx
      .insert(conversationEvents)
      .values({
        prospectId: input.prospectId,
        type: input.type,
        channel: ch,
        direction: isOutbound ? "outbound" : isInbound ? "inbound" : "internal",
        occurredAt: input.occurredAt,
        content: input.content,
        notes: input.notes,
        sentiment: isInbound ? (input.sentiment ?? null) : null,
        campaignId: input.campaignId ?? null,
        deliveryStatus: isOutbound ? "sent" : null,
        source: "manual",
      })
      .returning({ id: conversationEvents.id });

    const patch: Partial<typeof prospects.$inferInsert> = { lastInteractionAt: input.occurredAt };
    if (isOutbound && (!p.lastContactedAt || p.lastContactedAt < input.occurredAt)) patch.lastContactedAt = input.occurredAt;
    await tx.update(prospects).set(patch).where(eq(prospects.id, p.id));

    if (isInbound) {
      // Never follow up on someone who replied after our last message. Logged times have minute
      // precision, so a reply in the same minute as the send still counts as "after".
      const [lastOut] = await tx
        .select({ at: conversationEvents.occurredAt })
        .from(conversationEvents)
        .where(and(eq(conversationEvents.prospectId, p.id), eq(conversationEvents.direction, "outbound")))
        .orderBy(desc(conversationEvents.occurredAt))
        .limit(1);
      if (!lastOut || input.occurredAt.getTime() >= lastOut.at.getTime() - 60_000)
        await tx
          .update(followUps)
          .set({ status: "cancelled", reason: sql`coalesce(${followUps.reason} || ' — ', '') || 'Cancelled: prospect replied'` })
          .where(and(eq(followUps.prospectId, p.id), eq(followUps.status, "pending")));
      if (input.campaignId)
        await tx.update(campaignProspects).set({ state: "replied" }).where(and(eq(campaignProspects.prospectId, p.id), eq(campaignProspects.campaignId, input.campaignId)));
    }
    if (isOutbound && input.campaignId)
      await tx.update(campaignProspects).set({ state: "contacted" }).where(and(eq(campaignProspects.prospectId, p.id), eq(campaignProspects.campaignId, input.campaignId)));

    const next = nextStatusAfterEvent(p.status, input.type, input.sentiment ?? null);
    await applyStatus(tx, p.id, p.status, next, "Updated from logged interaction");

    if (input.followUpAt && next !== "do_not_contact") {
      await tx.insert(followUps).values({ prospectId: p.id, dueAt: input.followUpAt, reason: "Scheduled when logging an interaction" });
      await tx.update(prospects).set({ nextFollowUpAt: input.followUpAt }).where(eq(prospects.id, p.id));
    }
    return { id: event!.id };
  },
);

export const updateEventSentiment = defineAction(
  "interaction.sentiment",
  z.object({ id: uuid, sentiment: z.enum(["positive", "neutral", "negative", "opt_out"]).nullable() }),
  async ({ id, sentiment }, { tx }) => {
    const [e] = await tx.select().from(conversationEvents).where(eq(conversationEvents.id, id));
    if (!e || e.direction !== "inbound") throw new UserError("Only incoming replies can be classified.");
    await tx.update(conversationEvents).set({ sentiment }).where(eq(conversationEvents.id, id));
    const [p] = await tx.select().from(prospects).where(eq(prospects.id, e.prospectId));
    if (p) await applyStatus(tx, p.id, p.status, nextStatusAfterEvent(p.status, e.type, sentiment), "Reply classified");
    return null;
  },
);

export const deleteEvent = defineAction("interaction.delete", z.object({ id: uuid }), async ({ id }, { tx }) => {
  const [e] = await tx.select().from(conversationEvents).where(eq(conversationEvents.id, id));
  if (!e) throw new UserError("Entry not found.");
  if (e.source !== "manual") throw new UserError("Only manually logged entries can be deleted.");
  await tx.delete(conversationEvents).where(eq(conversationEvents.id, id));
  return null;
});

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------
async function syncNextFollowUp(tx: Tx, prospectId: string) {
  await tx.execute(sql`
    update prospects set next_follow_up_at = (
      select min(due_at) from follow_ups where prospect_id = ${prospectId} and status = 'pending'
    ) where id = ${prospectId}`);
}

export const scheduleFollowUp = defineAction(
  "followup.schedule",
  z.object({ prospectId: uuid, dueAt: z.coerce.date(), reason: optionalText(500), suggested: z.boolean().default(false), opportunityId: uuid.nullable().optional() }),
  async (input, { tx }) => {
    const [p] = await tx.select().from(prospects).where(eq(prospects.id, input.prospectId));
    if (!p) throw new UserError("Prospect not found.");
    if (p.status === "do_not_contact") throw new UserError("This prospect is marked do not contact.");
    await tx.insert(followUps).values({ ...input, opportunityId: input.opportunityId ?? null });
    await tx.insert(conversationEvents).values({
      prospectId: p.id,
      type: "follow_up_scheduled",
      direction: "internal",
      source: "system",
      content: input.reason,
      occurredAt: new Date(),
      notes: `Due ${input.dueAt.toISOString()}`,
    });
    await syncNextFollowUp(tx, p.id);
    return null;
  },
);

export const updateFollowUp = defineAction(
  "followup.update",
  z.object({ id: uuid, status: z.enum(["pending", "done", "skipped", "cancelled"]).optional(), dueAt: z.coerce.date().optional() }),
  async ({ id, status, dueAt }, { tx }) => {
    const [f] = await tx.select().from(followUps).where(eq(followUps.id, id));
    if (!f) throw new UserError("Follow-up not found.");
    await tx
      .update(followUps)
      .set({
        ...(status ? { status, completedAt: status === "done" ? new Date() : null } : {}),
        ...(dueAt ? { dueAt } : {}),
      })
      .where(eq(followUps.id, id));
    await syncNextFollowUp(tx, f.prospectId);
    return null;
  },
);

// ---------------------------------------------------------------------------
// Saved views & suppression
// ---------------------------------------------------------------------------
export const saveView = defineAction(
  "view.save",
  z.object({ name: z.string().trim().min(1).max(60), entity: z.enum(["prospects", "content"]), filters: z.record(z.string(), z.string()) }),
  async (input, { tx }) => {
    const [v] = await tx.insert(savedViews).values(input).returning({ id: savedViews.id });
    return { id: v!.id };
  },
);

export const deleteView = defineAction("view.delete", z.object({ id: uuid }), async ({ id }, { tx }) => {
  await tx.delete(savedViews).where(eq(savedViews.id, id));
  return null;
});

export const addSuppression = defineAction(
  "suppression.add",
  z
    .object({
      email: z.string().trim().toLowerCase().optional().transform((v) => v || null),
      domain: z.string().trim().toLowerCase().optional().transform((v) => normalizeDomain(v) || null),
      linkedinUrl: z.string().trim().optional().transform((v) => v || null),
      xHandle: z.string().trim().optional().transform((v) => v || null),
      reason: z.enum(["opt_out", "do_not_contact", "bounced", "manual"]).default("manual"),
    })
    .refine((v) => v.email || v.domain || v.linkedinUrl || v.xHandle, "Enter an email, domain, LinkedIn URL, or X handle"),
  async (input, { tx }) => {
    await tx.insert(suppressionList).values(input);
    await audit(tx, "suppression.added", { type: "suppression" }, { reason: input.reason });
    return null;
  },
);

export const removeSuppression = defineAction("suppression.remove", z.object({ id: uuid }), async ({ id }, { tx }) => {
  await tx.delete(suppressionList).where(eq(suppressionList.id, id));
  await audit(tx, "suppression.removed", { type: "suppression", id });
  return null;
});
