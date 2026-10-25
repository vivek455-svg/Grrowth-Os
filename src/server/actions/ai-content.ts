"use server";

import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { contentIdeas, contentItems, contentPillars, contentPlatformVersions, portfolioProjects, profiles } from "@/db/schema";
import { defineAIAction, UserError } from "@/server/action";
import { withGeneration } from "@/server/ai";
import { UNTRUSTED_RULE, WRITING_RULES, positioningBlock, untrusted, voiceExamples } from "@/server/ai/prompts";
import { loadContentDataset } from "@/server/queries/analytics";
import { groupPerformance, lengthBucket } from "@/lib/metrics/content";
import { periodFromRange } from "@/lib/metrics/period";
import { FORMAT_LABEL, HOOK_LABEL } from "@/lib/labels";
import { LAB_MODES, type LabMode } from "@/lib/lab-modes";
import { fmtPercent } from "@/lib/format";
import type { Tx } from "@/db/client";
import type { ContentFormat, HookStyle } from "@/db/schema";



const draftSchema = z.object({
  items: z.array(
    z.object({
      title: z.string().describe("Short internal label"),
      body: z.string().describe("Full post text, ready to edit. Empty string for idea-only outputs."),
      platform: z.enum(["x", "linkedin"]).nullable(),
      format: z.enum(["text", "image", "carousel", "video", "link", "thread"]),
      hook_style: z.enum(["question", "contrarian", "how_to", "story", "list", "observation", "data", "other"]).nullable(),
      pillar: z.string().nullable().describe("Exact name of one of the user's pillars, or null"),
      suggested_day: z.string().nullable().describe("For weekly plans: Monday..Sunday, else null"),
      rationale: z.string().describe("One or two sentences: why this angle, grounded in the provided material"),
    }),
  ),
  warnings: z.array(z.string()).describe("Anything the user must verify, or gaps in the provided material"),
});
export type LabOutput = z.infer<typeof draftSchema>;

async function context(tx: Tx, userId: string) {
  const [profile] = await tx.select().from(profiles).where(eq(profiles.id, userId));
  const pillars = await tx.select().from(contentPillars).where(isNull(contentPillars.archivedAt)).orderBy(asc(contentPillars.sortOrder));
  const portfolio = await tx.select().from(portfolioProjects);
  const ds = await loadContentDataset(tx, userId, periodFromRange("90d"));
  const rated = ds.perf.filter((r) => r.engagementRate !== null).sort((a, b) => b.engagementRate! - a.engagementRate!);
  const top = rated.slice(0, 3).map((r) => ({ platform: r.post.platform, body: r.post.body, engagementRate: r.engagementRate }));
  const stats = (label: string, groups: ReturnType<typeof groupPerformance>, name: (k: string) => string) =>
    groups.length
      ? `${label}:\n` + groups.map((g) => `- ${name(g.key)}: median engagement ${fmtPercent(g.medianRate)} over ${g.postsWithRate} posts${g.sufficient ? "" : " (small sample — weak evidence)"}`).join("\n")
      : "";
  const pillarName = new Map(pillars.map((p) => [p.id, p.name]));
  const performance = [
    `Performance over the last 90 days (${rated.length} posts with metrics). Use ONLY these numbers; do not invent others.`,
    stats("By pillar", groupPerformance(ds.perf, (r) => r.post.pillarId), (k) => pillarName.get(k) ?? "Unknown"),
    stats("By format", groupPerformance(ds.perf, (r) => r.post.format), (k) => FORMAT_LABEL[k as ContentFormat] ?? k),
    stats("By hook style", groupPerformance(ds.perf, (r) => r.post.hookStyle), (k) => HOOK_LABEL[k as HookStyle] ?? k),
    stats("By length", groupPerformance(ds.perf, (r) => lengthBucket(r.post.body)), (k) => k),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { profile, pillars, portfolio, top, performance, ratedCount: rated.length };
}

const MODE_INSTRUCTIONS: Record<LabMode, string> = {
  ideas_from_pillars: "Generate distinct post ideas for the selected pillars. Each item: title + 2–3 sentence outline in body. No full posts.",
  ideas_from_performance:
    "Generate post ideas informed by the performance data. Each rationale must cite the specific statistic it builds on. If the data is thin (small samples), say so in warnings and lean on the user's positioning instead.",
  project_angles: "Turn the described project into distinct content angles (process, problem/solution, lesson, before/after reasoning, tool tip). Use only facts given about the project.",
  linkedin_post: "Write complete LinkedIn posts (roughly 120–250 words), skimmable line breaks, one clear idea each.",
  x_post: "Write complete X posts under 280 characters each.",
  x_thread: "Write X threads: body contains numbered posts (1/, 2/ …) separated by blank lines, each under 280 characters, 4–7 posts.",
  repurpose: "Adapt the source post for the target platform's norms. Keep the core idea and any facts exactly; don't add new claims.",
  rewrite_hook: "Rewrite only the opening line(s) of the source post. Return each alternative hook as a separate item with the full post body using that hook.",
  improve_clarity: "Edit the source post for clarity: shorter sentences, remove filler, keep the user's voice and every factual claim unchanged. Return one improved version.",
  alt_ctas: "Suggest alternative closing CTAs for the source post, ranging from no CTA to a soft invitation. body = the CTA line only.",
  teardown_post:
    "Write a landing page teardown post from the user's observations. Only use the observations provided; don't claim anything else about the page. Frame critiques constructively — no mocking.",
  lesson_post: "Turn the design lesson into an educational post with a concrete example and a practical takeaway.",
  content_series: "Plan a short content series (4–6 posts) with a consistent through-line. Each item is one episode with an outline.",
  weekly_plan: "Plan one week of posts across X and LinkedIn based on pillars and performance. Each item: suggested_day, platform, title, outline in body.",
};

export const generateLab = defineAIAction(
  "ai.content_lab",
  z.object({
    mode: z.enum(Object.keys(LAB_MODES) as [LabMode, ...LabMode[]]),
    pillarIds: z.array(z.string().uuid()).max(10).default([]),
    brief: z.string().max(8000).default(""),
    sourceVersionId: z.string().uuid().nullable().optional(),
    /** Raw text to work from (e.g. an unsaved Lab draft or a selected passage). */
    sourceText: z.string().max(25000).nullable().optional(),
    targetPlatform: z.enum(["x", "linkedin"]).nullable().optional(),
    format: z.enum(["text", "image", "carousel", "video", "link", "thread"]).nullable().optional(),
    count: z.number().int().min(1).max(10).default(3),
  }),
  async (input, { user, db }) => {
    const ctx = await db((tx) => context(tx, user.id));
    let source: { body: string; platform: string; contentItemId: string | null } | null = null;
    if (input.sourceVersionId) {
      const [v] = await db((tx) => tx.select().from(contentPlatformVersions).where(eq(contentPlatformVersions.id, input.sourceVersionId!)));
      if (!v) throw new UserError("Source post not found.");
      source = { body: v.body, platform: v.platform, contentItemId: v.contentItemId };
    }
    if (!source && input.sourceText?.trim()) source = { body: input.sourceText, platform: input.targetPlatform ?? "draft", contentItemId: null };
    const needsSource = ["repurpose", "rewrite_hook", "improve_clarity", "alt_ctas"].includes(input.mode);
    if (needsSource && !source?.body.trim()) throw new UserError("Pick a post with copy to work from.");
    const needsBrief = ["project_angles", "teardown_post", "lesson_post"].includes(input.mode);
    if (needsBrief && input.brief.trim().length < 20) throw new UserError("Add a few sentences of material for the AI to work from.");
    const selected = ctx.pillars.filter((p) => input.pillarIds.includes(p.id));

    const system = [
      "You are a writing assistant for an independent web designer's personal brand on X and LinkedIn.",
      positioningBlock(ctx.profile, ctx.portfolio),
      WRITING_RULES,
      UNTRUSTED_RULE,
      "Output is a draft for the user to edit and approve. Never state that anything has been published.",
    ].join("\n\n");

    const prompt = [
      `Task: ${LAB_MODES[input.mode]}. ${MODE_INSTRUCTIONS[input.mode]}`,
      `Produce ${input.mode === "improve_clarity" ? 1 : input.count} item(s).`,
      input.targetPlatform ? `Target platform: ${input.targetPlatform === "x" ? "X" : "LinkedIn"}.` : "",
      input.format ? `Preferred format: ${input.format}.` : "",
      `User's content pillars: ${ctx.pillars.map((p) => p.name).join("; ") || "none defined"}.`,
      selected.length ? `Focus on these pillars: ${selected.map((p) => p.name).join("; ")}.` : "",
      ["ideas_from_performance", "weekly_plan", "content_series", "ideas_from_pillars"].includes(input.mode) ? ctx.performance : "",
      voiceExamples(ctx.top),
      source ? `Source post (${source.platform}):\n${untrusted("source_post", source.body)}` : "",
      input.brief.trim() ? `Material from the user:\n${untrusted("user_brief", input.brief)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const { data, generationId } = await withGeneration(
      user.id,
      { feature: `content_lab.${input.mode}`, promptSummary: `${input.mode}; pillars=${selected.map((p) => p.name).join(",")}; brief=${input.brief.slice(0, 120)}`, contentItemId: source?.contentItemId ?? null },
      async (ai) => {
        const res = await ai.generateObject({ system, prompt, schema: draftSchema, effort: "medium" });
        return { ...res, output: JSON.stringify(res.data) };
      },
    );
    const warnings = [...data.warnings];
    if (input.mode === "ideas_from_performance" && ctx.ratedCount < 10)
      warnings.unshift(`Only ${ctx.ratedCount} posts have metrics, so performance-based ideas rest on limited evidence.`);
    for (const item of data.items)
      if ((item.platform === "x" || input.targetPlatform === "x") && item.format !== "thread" && item.body.length > 280)
        warnings.push(`“${item.title}” is ${item.body.length} characters — over X's 280 limit.`);
    return { ...data, warnings, generationId, pillarNames: ctx.pillars.map((p) => ({ id: p.id, name: p.name })) };
  },
);

/** Saves an AI draft (after the user edits it) as a normal draft post. Never schedules or publishes. */
export const saveLabDraft = defineAIAction(
  "ai.save_draft",
  z.object({
    title: z.string().trim().min(1).max(200),
    body: z.string().max(25000),
    platform: z.enum(["x", "linkedin"]),
    format: z.enum(["text", "image", "carousel", "video", "link", "thread"]),
    hookStyle: z.enum(["question", "contrarian", "how_to", "story", "list", "observation", "data", "other"]).nullable(),
    pillarName: z.string().nullable(),
    plannedAt: z.coerce.date().nullable().optional(),
    asIdea: z.boolean().default(false),
    contentItemId: z.string().uuid().nullable().optional(),
    derivedFromVersionId: z.string().uuid().nullable().optional(),
  }),
  async (input, { db }) =>
    db(async (tx) => {
      const [pillar] = input.pillarName ? await tx.select().from(contentPillars).where(eq(contentPillars.name, input.pillarName)) : [];
      if (input.asIdea) {
        await tx.insert(contentIdeas).values({ title: input.title, notes: input.body || null, pillarId: pillar?.id ?? null, source: "ai" });
        return { id: null as string | null };
      }
      // Attach to an existing item (repurposing) or create a new one.
      let itemId = input.contentItemId ?? null;
      if (!itemId) {
        const [item] = await tx.insert(contentItems).values({ title: input.title, pillarId: pillar?.id ?? null }).returning({ id: contentItems.id });
        itemId = item!.id;
      }
      await tx.insert(contentPlatformVersions).values({
        contentItemId: itemId,
        platform: input.platform,
        format: input.format,
        body: input.body,
        hookStyle: input.hookStyle,
        derivedFromVersionId: input.derivedFromVersionId ?? null,
        status: "draft",
        plannedAt: input.plannedAt ?? null,
      });
      return { id: itemId };
    }),
);
