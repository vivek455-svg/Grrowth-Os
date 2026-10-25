"use server";

import { z } from "zod";
import { and, eq, inArray, max } from "drizzle-orm";
import {
  contentIdeas,
  contentItems,
  contentItemTags,
  contentMetricsSnapshots,
  contentPillars,
  contentPlatformVersions,
  contentTags,
  audienceSnapshots,
  contentCampaigns,
} from "@/db/schema";
import { UserError, audit, defineAction, optionalDate, optionalText, optionalUrl } from "@/server/action";
import type { Tx } from "@/db/client";

const platform = z.enum(["x", "linkedin"]);
const format = z.enum(["text", "image", "carousel", "video", "link", "thread"]);
const editableStatus = z.enum(["idea", "draft", "ready", "scheduled", "archived"]);
const goal = z.enum(["reach", "authority", "engagement", "portfolio_traffic", "leads", "sales"]).nullable().optional();
const uuid = z.string().uuid();

async function setTags(tx: Tx, contentItemId: string, names: string[]) {
  const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  await tx.delete(contentItemTags).where(eq(contentItemTags.contentItemId, contentItemId));
  if (!clean.length) return;
  await tx.insert(contentTags).values(clean.map((name) => ({ name }))).onConflictDoNothing();
  const tags = await tx.select().from(contentTags).where(inArray(contentTags.name, clean));
  await tx.insert(contentItemTags).values(tags.map((t) => ({ contentItemId, tagId: t.id })));
}

function assertSchedulable(status: string, plannedAt: Date | null) {
  if (status === "scheduled" && !plannedAt) throw new UserError("Pick a date and time before marking a post as scheduled.");
}

export const createContent = defineAction(
  "content.create",
  z.object({
    title: z.string().trim().min(1, "Give the post an internal label").max(200),
    platforms: z.array(platform).min(1, "Choose at least one platform"),
    format: format.default("text"),
    body: z.string().max(25000).default(""),
    pillarId: uuid.nullable().optional(),
    topic: optionalText(200),
    goal,
    status: editableStatus.default("draft"),
    plannedAt: optionalDate,
    ideaId: uuid.nullable().optional(),
  }),
  async (input, { tx }) => {
    assertSchedulable(input.status, input.plannedAt);
    const [item] = await tx
      .insert(contentItems)
      .values({
        title: input.title,
        pillarId: input.pillarId ?? null,
        topic: input.topic,
        goal: input.goal ?? null,
        ideaId: input.ideaId ?? null,
      })
      .returning({ id: contentItems.id });
    await tx.insert(contentPlatformVersions).values(
      input.platforms.map((p) => ({
        contentItemId: item!.id,
        platform: p,
        format: input.format,
        body: input.body,
        status: input.status,
        plannedAt: input.plannedAt,
      })),
    );
    if (input.ideaId) await tx.update(contentIdeas).set({ status: "used" }).where(eq(contentIdeas.id, input.ideaId));
    return { id: item!.id };
  },
);

export const updateContentItem = defineAction(
  "content.update_item",
  z.object({
    id: uuid,
    title: z.string().trim().min(1).max(200),
    pillarId: uuid.nullable().optional(),
    topic: optionalText(200),
    keywords: z.array(z.string().trim().max(50)).max(30).default([]),
    tags: z.array(z.string().max(50)).max(20).default([]),
    audience: optionalText(300),
    goal,
    campaignId: uuid.nullable().optional(),
    relatedUrl: optionalUrl,
    notes: optionalText(10000),
  }),
  async ({ id, tags, ...input }, { tx }) => {
    const res = await tx
      .update(contentItems)
      .set({ ...input, pillarId: input.pillarId ?? null, goal: input.goal ?? null, campaignId: input.campaignId ?? null })
      .where(eq(contentItems.id, id))
      .returning({ id: contentItems.id });
    if (!res.length) throw new UserError("Content not found.");
    await setTags(tx, id, tags);
    return null;
  },
);

const versionFields = z.object({
  format,
  body: z.string().max(25000),
  cta: optionalText(500),
  ctaType: z.enum(["none", "follow", "comment", "dm", "link", "booking", "other"]).nullable().optional(),
  hookStyle: z.enum(["question", "contrarian", "how_to", "story", "list", "observation", "data", "other"]).nullable().optional(),
  status: editableStatus,
  plannedAt: optionalDate,
});

export const saveVersion = defineAction(
  "content.save_version",
  versionFields.extend({ id: uuid }),
  async ({ id, ...input }, { tx }) => {
    const [current] = await tx.select().from(contentPlatformVersions).where(eq(contentPlatformVersions.id, id));
    if (!current) throw new UserError("Post version not found.");
    // Once published, the status can only change by archiving; publication data stays intact.
    const status = current.status === "published" && input.status !== "archived" ? "published" : input.status;
    assertSchedulable(status, input.plannedAt);
    await tx
      .update(contentPlatformVersions)
      .set({ ...input, status, ctaType: input.ctaType ?? null, hookStyle: input.hookStyle ?? null })
      .where(eq(contentPlatformVersions.id, id));
    return null;
  },
);

/** Applies an approved AI suggestion (or other targeted edit) to an unpublished version. */
export const patchVersion = defineAction(
  "content.patch_version",
  z.object({ id: uuid, body: z.string().max(25000).optional(), cta: optionalText(500) }),
  async ({ id, ...patch }, { tx }) => {
    const [v] = await tx.select().from(contentPlatformVersions).where(eq(contentPlatformVersions.id, id));
    if (!v) throw new UserError("Post version not found.");
    if (v.status === "published" && patch.body !== undefined) throw new UserError("Published text can't be changed.");
    await tx
      .update(contentPlatformVersions)
      .set({ ...(patch.body !== undefined ? { body: patch.body } : {}), ...(patch.cta ? { cta: patch.cta } : {}) })
      .where(eq(contentPlatformVersions.id, id));
    return null;
  },
);

export const addVersion = defineAction(
  "content.add_version",
  z.object({ contentItemId: uuid, platform, format: format.default("text"), derivedFromVersionId: uuid.nullable().optional(), body: z.string().max(25000).optional() }),
  async (input, { tx }) => {
    let body = input.body ?? "";
    if (input.derivedFromVersionId && input.body === undefined) {
      const [src] = await tx.select().from(contentPlatformVersions).where(eq(contentPlatformVersions.id, input.derivedFromVersionId));
      body = src?.body ?? "";
    }
    const [v] = await tx
      .insert(contentPlatformVersions)
      .values({
        contentItemId: input.contentItemId,
        platform: input.platform,
        format: input.format,
        body,
        derivedFromVersionId: input.derivedFromVersionId ?? null,
        status: "draft",
      })
      .returning({ id: contentPlatformVersions.id });
    return { id: v!.id };
  },
);

export const deleteVersion = defineAction("content.delete_version", z.object({ id: uuid }), async ({ id }, { tx }) => {
  const [v] = await tx.select().from(contentPlatformVersions).where(eq(contentPlatformVersions.id, id));
  if (!v) throw new UserError("Post version not found.");
  const siblings = await tx.select({ id: contentPlatformVersions.id }).from(contentPlatformVersions).where(eq(contentPlatformVersions.contentItemId, v.contentItemId));
  if (siblings.length <= 1) throw new UserError("A post needs at least one platform version. Archive the post instead.");
  await tx.delete(contentPlatformVersions).where(eq(contentPlatformVersions.id, id));
  return null;
});

export const reschedule = defineAction(
  "content.reschedule",
  z.object({ id: uuid, plannedAt: z.coerce.date() }),
  async ({ id, plannedAt }, { tx }) => {
    const [v] = await tx.select().from(contentPlatformVersions).where(eq(contentPlatformVersions.id, id));
    if (!v) throw new UserError("Post not found.");
    if (v.status === "published") throw new UserError("Published posts can't be rescheduled.");
    await tx.update(contentPlatformVersions).set({ plannedAt }).where(eq(contentPlatformVersions.id, id));
    return null;
  },
);

/** Manual publication record. Only the user (or a confirmed API response) can mark a post as published. */
export const markPublished = defineAction(
  "content.mark_published",
  z.object({
    id: uuid,
    publishedAt: z.coerce.date(),
    platformPostUrl: optionalUrl,
    platformPostId: optionalText(100),
  }),
  async ({ id, ...input }, { tx }) => {
    if (input.publishedAt > new Date(Date.now() + 5 * 60000)) throw new UserError("Publication time can't be in the future.");
    await tx
      .update(contentPlatformVersions)
      .set({ ...input, status: "published", publishSource: "manual" })
      .where(eq(contentPlatformVersions.id, id));
    await audit(tx, "content.published_manually", { type: "content_version", id });
    return null;
  },
);

export const unpublish = defineAction("content.unpublish", z.object({ id: uuid }), async ({ id }, { tx }) => {
  await tx
    .update(contentPlatformVersions)
    .set({ status: "draft", publishedAt: null, publishSource: null })
    .where(and(eq(contentPlatformVersions.id, id), eq(contentPlatformVersions.publishSource, "manual")));
  return null;
});

const metric = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0), "Must be a whole number ≥ 0");

export const recordMetrics = defineAction(
  "content.record_metrics",
  z.object({
    versionId: uuid,
    capturedAt: z.coerce.date().optional(),
    impressions: metric,
    likes: metric,
    replies: metric,
    reposts: metric,
    bookmarks: metric,
    linkClicks: metric,
    profileVisits: metric,
    meaningfulReplies: metric,
    source: z.enum(["manual", "estimated"]).default("manual"),
  }),
  async ({ versionId, capturedAt, ...m }, { tx }) => {
    if (Object.entries(m).every(([k, v]) => k === "source" || v === null)) throw new UserError("Enter at least one metric.");
    const [v] = await tx.select().from(contentPlatformVersions).where(eq(contentPlatformVersions.id, versionId));
    if (!v) throw new UserError("Post not found.");
    if (v.status !== "published") throw new UserError("Record the publication first, then add its metrics.");
    await tx.insert(contentMetricsSnapshots).values({ versionId, capturedAt: capturedAt ?? new Date(), ...m });
    return null;
  },
);

export const recordFollowers = defineAction(
  "content.record_followers",
  z.object({ platform, followers: z.coerce.number().int().min(0), capturedAt: z.coerce.date().optional() }),
  async (input, { tx }) => {
    await tx.insert(audienceSnapshots).values({ ...input, capturedAt: input.capturedAt ?? new Date(), source: "manual" });
    return null;
  },
);

export const duplicateContent = defineAction("content.duplicate", z.object({ id: uuid }), async ({ id }, { tx }) => {
  const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, id));
  if (!item) throw new UserError("Content not found.");
  const versions = await tx.select().from(contentPlatformVersions).where(eq(contentPlatformVersions.contentItemId, id));
  const [copy] = await tx
    .insert(contentItems)
    .values({
      title: `${item.title} (copy)`.slice(0, 200),
      pillarId: item.pillarId,
      topic: item.topic,
      keywords: item.keywords,
      audience: item.audience,
      goal: item.goal,
      campaignId: item.campaignId,
      relatedUrl: item.relatedUrl,
      notes: item.notes,
    })
    .returning({ id: contentItems.id });
  if (versions.length)
    await tx.insert(contentPlatformVersions).values(
      versions.map((v) => ({
        contentItemId: copy!.id,
        platform: v.platform,
        format: v.format,
        body: v.body,
        cta: v.cta,
        ctaType: v.ctaType,
        hookStyle: v.hookStyle,
        status: "draft" as const,
      })),
    );
  return { id: copy!.id };
});

export const archiveContent = defineAction(
  "content.archive",
  z.object({ id: uuid, archived: z.boolean() }),
  async ({ id, archived }, { tx }) => {
    await tx.update(contentItems).set({ archivedAt: archived ? new Date() : null }).where(eq(contentItems.id, id));
    return null;
  },
);

export const deleteContent = defineAction("content.delete", z.object({ id: uuid }), async ({ id }, { tx }) => {
  await tx.delete(contentItems).where(eq(contentItems.id, id));
  await audit(tx, "content.deleted", { type: "content_item", id });
  return null;
});

// ---------------------------------------------------------------------------
// Pillars
// ---------------------------------------------------------------------------
export const savePillar = defineAction(
  "pillar.save",
  z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(80), description: optionalText(500) }),
  async ({ id, ...input }, { tx }) => {
    if (id) {
      await tx.update(contentPillars).set(input).where(eq(contentPillars.id, id));
      return { id };
    }
    const [{ next }] = (await tx.select({ next: max(contentPillars.sortOrder) }).from(contentPillars)) as [{ next: number | null }];
    const [p] = await tx
      .insert(contentPillars)
      .values({ ...input, sortOrder: (next ?? 0) + 10 })
      .returning({ id: contentPillars.id });
    return { id: p!.id };
  },
);

export const archivePillar = defineAction(
  "pillar.archive",
  z.object({ id: uuid, archived: z.boolean() }),
  async ({ id, archived }, { tx }) => {
    await tx.update(contentPillars).set({ archivedAt: archived ? new Date() : null }).where(eq(contentPillars.id, id));
    return null;
  },
);

// ---------------------------------------------------------------------------
// Ideas
// ---------------------------------------------------------------------------
export const saveIdea = defineAction(
  "idea.save",
  z.object({
    title: z.string().trim().min(1).max(300),
    notes: optionalText(5000),
    pillarId: uuid.nullable().optional(),
    source: z.enum(["manual", "ai", "insight", "repurpose"]).default("manual"),
    sourceRef: uuid.nullable().optional(),
  }),
  async (input, { tx }) => {
    const [idea] = await tx
      .insert(contentIdeas)
      .values({ ...input, pillarId: input.pillarId ?? null, sourceRef: input.sourceRef ?? null })
      .returning({ id: contentIdeas.id });
    return { id: idea!.id };
  },
);

export const setIdeaStatus = defineAction(
  "idea.status",
  z.object({ id: uuid, status: z.enum(["open", "used", "dismissed"]) }),
  async ({ id, status }, { tx }) => {
    await tx.update(contentIdeas).set({ status }).where(eq(contentIdeas.id, id));
    return null;
  },
);

// ---------------------------------------------------------------------------
// Content campaigns (groups of posts, e.g. a launch week or a teardown series)
// ---------------------------------------------------------------------------
export const saveContentCampaign = defineAction(
  "content_campaign.save",
  z.object({ name: z.string().trim().min(1).max(120), description: optionalText(1000), startDate: z.string().optional().nullable().transform((v) => v || null), endDate: z.string().optional().nullable().transform((v) => v || null) }),
  async (input, { tx }) => {
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw new UserError("End date must be after the start date.");
    const [c] = await tx.insert(contentCampaigns).values(input).returning({ id: contentCampaigns.id });
    return { id: c!.id };
  },
);

export const deleteContentCampaign = defineAction("content_campaign.delete", z.object({ id: uuid }), async ({ id }, { tx }) => {
  await tx.delete(contentCampaigns).where(eq(contentCampaigns.id, id));
  return null;
});
