"use server";

import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  conversationEvents,
  outreachCampaigns,
  outreachMessages,
  portfolioProjects,
  profiles,
  prospectResearch,
  prospects,
  type ResearchObservation,
} from "@/db/schema";
import { UserError, defineAction, defineAIAction } from "@/server/action";
import { getAIProvider, withGeneration } from "@/server/ai";
import { UNTRUSTED_RULE, positioningBlock, untrusted, validateOutreach } from "@/server/ai/prompts";
import { FetchBlockedError, fetchPublicPage, type ExtractedPage } from "@/server/integrations/website";
import { log } from "@/lib/logger";

const uuid = z.string().uuid();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const researchSchema = z.object({
  what_they_do: z.string().describe("One or two sentences, only from the page content"),
  target_audience: z.string().nullable(),
  value_proposition: z.string().nullable(),
  offerings: z.string().nullable(),
  primary_cta: z.string().nullable(),
  observations: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(["verified", "hypothesis"]),
      evidence_quote: z.string().nullable().describe("For verified observations: an exact short quote from the page text that supports it"),
    }),
  ),
});

/**
 * Researches a prospect's public website. Deterministic extraction always runs; if an AI
 * provider is connected it also drafts a summary. Observations marked "verified" must quote
 * the page — any that don't are downgraded to hypotheses. The result is a draft until the
 * user reviews it.
 */
export const runResearch = defineAIAction(
  "research.run",
  z.object({ prospectId: uuid, url: z.string().trim().min(4).max(500).optional() }),
  async ({ prospectId, url }, { user, db }) => {
    const [p] = await db((tx) => tx.select().from(prospects).where(eq(prospects.id, prospectId)));
    if (!p) throw new UserError("Prospect not found.");
    const target = url ?? p.websiteUrl ?? p.companyWebsite;
    if (!target) throw new UserError("Add a website URL to research.");

    let page: ExtractedPage;
    try {
      page = await fetchPublicPage(target);
    } catch (e) {
      if (e instanceof FetchBlockedError) throw new UserError(e.message);
      log("warn", "research_fetch_failed", { prospectId, error: e });
      throw new UserError("Couldn't load that website (timeout or network error). You can add research manually.");
    }

    const base = {
      url: page.finalUrl,
      keySections: page.headings.filter((h) => h.level <= 2).map((h) => h.text).slice(0, 12),
      trustSignals: page.trustSignals,
      primaryCta: page.ctas[0] ?? null,
      sources: [page.finalUrl],
      extracted: { title: page.title, metaDescription: page.metaDescription, headings: page.headings, ctas: page.ctas, trustSignals: page.trustSignals, fetchedAt: page.fetchedAt },
      fetchedAt: new Date(page.fetchedAt),
    };

    const facts: ResearchObservation[] = [
      ...(page.title ? [{ text: `Page title: “${page.title}”`, kind: "verified" as const, source_url: page.finalUrl }] : []),
      ...(page.headings[0] ? [{ text: `Main headline: “${page.headings[0].text}”`, kind: "verified" as const, source_url: page.finalUrl }] : []),
      ...(page.ctas.length ? [{ text: `Calls to action found: ${page.ctas.slice(0, 5).map((c) => `“${c}”`).join(", ")}`, kind: "verified" as const, source_url: page.finalUrl }] : []),
    ];

    let row: typeof prospectResearch.$inferInsert = {
      ...base,
      prospectId,
      whatTheyDo: page.metaDescription,
      valueProposition: page.headings[0]?.text ?? null,
      observations: facts,
      generatedBy: "extraction",
    };

    if (getAIProvider()) {
      const pageText = [
        `URL: ${page.finalUrl}`,
        `Title: ${page.title ?? ""}`,
        `Meta description: ${page.metaDescription ?? ""}`,
        `Headings:\n${page.headings.map((h) => `${"#".repeat(h.level)} ${h.text}`).join("\n")}`,
        `Buttons/CTAs: ${page.ctas.join(" | ")}`,
        `Body text:\n${page.text.slice(0, 15000)}`,
      ].join("\n");
      const { data } = await withGeneration(user.id, { feature: "research.website", promptSummary: `website research: ${page.finalUrl}`, prospectId }, async (ai) => {
        const res = await ai.generateObject({
          system: [
            "You analyse a company's public landing page for a web designer who does conversion-focused landing pages and Framer builds.",
            "Report only what the page shows. Separate verified observations (directly visible on the page — include an exact short quote) from hypotheses (your interpretation, e.g. possible messaging or UX friction).",
            "Never claim the site is broken, slow, or underperforming. Never guess revenue, traffic or conversion rates. Be fair and specific.",
            UNTRUSTED_RULE,
          ].join("\n"),
          prompt: `Analyse this page.\n\n${untrusted("website", pageText, 20000)}`,
          schema: researchSchema,
          effort: "low",
        });
        return { ...res, output: JSON.stringify(res.data) };
      });
      const haystack = norm(pageText);
      const observations: ResearchObservation[] = data.observations.map((o) => {
        const supported = o.kind === "verified" && o.evidence_quote && haystack.includes(norm(o.evidence_quote));
        return {
          text: o.kind === "verified" && !supported ? `${o.text} (couldn't match a quote on the page — treat as unverified)` : o.text,
          kind: supported ? "verified" : "hypothesis",
          source_url: supported ? page.finalUrl : null,
        };
      });
      row = {
        ...row,
        whatTheyDo: data.what_they_do,
        targetAudience: data.target_audience,
        valueProposition: data.value_proposition,
        offerings: data.offerings,
        primaryCta: data.primary_cta ?? base.primaryCta,
        observations: [...facts, ...observations],
        generatedBy: "ai",
      };
    }

    return db(async (tx) => {
      const [r] = await tx.insert(prospectResearch).values(row).returning({ id: prospectResearch.id });
      await tx.insert(conversationEvents).values({ prospectId, type: "website_audited", direction: "internal", source: "system", content: `Researched ${page.finalUrl}`, notes: row.generatedBy === "ai" ? "Extraction + AI summary (draft)" : "Extraction only (draft)" });
      if (p.status === "new") await tx.update(prospects).set({ status: "researched" }).where(eq(prospects.id, prospectId));
      return { id: r!.id, ai: row.generatedBy === "ai" };
    });
  },
);

const observationSchema = z.object({ text: z.string().trim().min(1).max(1000), kind: z.enum(["verified", "hypothesis"]), source_url: z.string().nullable() });

export const saveResearch = defineAction(
  "research.save",
  z.object({
    id: uuid.optional(),
    prospectId: uuid,
    url: z.string().max(500).nullable().optional(),
    whatTheyDo: z.string().max(2000).nullable().optional(),
    targetAudience: z.string().max(1000).nullable().optional(),
    valueProposition: z.string().max(1000).nullable().optional(),
    offerings: z.string().max(2000).nullable().optional(),
    primaryCta: z.string().max(200).nullable().optional(),
    observations: z.array(observationSchema).max(40),
    reviewed: z.boolean().default(true),
  }),
  async ({ id, reviewed, ...input }, { tx }) => {
    const values = { ...input, reviewStatus: reviewed ? ("reviewed" as const) : ("draft" as const) };
    if (id) {
      await tx.update(prospectResearch).set(values).where(eq(prospectResearch.id, id));
      return { id };
    }
    const [r] = await tx.insert(prospectResearch).values({ ...values, generatedBy: "manual" }).returning({ id: prospectResearch.id });
    await tx.insert(conversationEvents).values({ prospectId: input.prospectId, type: "profile_researched", direction: "internal", source: "system", content: "Research added manually" });
    return { id: r!.id };
  },
);

export const deleteResearch = defineAction("research.delete", z.object({ id: uuid }), async ({ id }, { tx }) => {
  await tx.delete(prospectResearch).where(eq(prospectResearch.id, id));
  return null;
});

// ---------------------------------------------------------------------------
// Personalized outreach
// ---------------------------------------------------------------------------
const messageSchema = z.object({
  company_summary: z.string().describe("What the company does, from the research only"),
  observation: z.string().describe("The single most relevant verified observation used"),
  service_fit: z.string().describe("Whether and how the user's services could reasonably help; say 'weak fit' honestly if so"),
  fit_is_reasonable: z.boolean(),
  portfolio_project_number: z.number().int().nullable().describe("Number of the most relevant portfolio project from the list, or null if none fits"),
  portfolio_reason: z.string().nullable(),
  variants: z.array(
    z.object({
      variant: z.enum(["short", "value_first", "relationship"]),
      subject: z.string().nullable().describe("Email subject (email only), else null"),
      body: z.string(),
      claims: z.array(z.object({ claim: z.string(), support: z.enum(["research", "notes", "profile", "conversation", "none"]) })).describe("Every factual statement about the recipient and where it comes from"),
    }),
  ),
});

export type OutreachDraft = z.infer<typeof messageSchema> & {
  warnings: Record<string, string[]>;
  portfolio: { name: string; url: string | null; reason: string | null } | null;
  generationId: string;
  usedResearch: boolean;
};

const CHANNEL_GUIDE = {
  email: "Email: subject under 7 words, no clickbait. Body 50–110 words. Plain text. Sign off with first name only.",
  linkedin: "LinkedIn message: 40–90 words, conversational. If a connection request, under 280 characters and no pitch.",
  x: "X DM: 25–60 words, casual and direct. No links in the first message unless asked.",
} as const;

export const generateOutreach = defineAIAction(
  "outreach.generate",
  z.object({
    prospectId: uuid,
    channel: z.enum(["email", "linkedin", "x"]),
    goal: z.enum(["start_conversation", "offer_ideas", "agency_partnership", "follow_up_content", "reconnect"]).default("start_conversation"),
    kind: z.enum(["initial", "connection_request"]).default("initial"),
    campaignId: uuid.nullable().optional(),
    extraNotes: z.string().max(3000).default(""),
  }),
  async (input, { user, db }) => {
    const ctx = await db(async (tx) => {
      const [p] = await tx.select().from(prospects).where(eq(prospects.id, input.prospectId));
      if (!p) throw new UserError("Prospect not found.");
      if (p.status === "do_not_contact") throw new UserError("This prospect is marked do not contact.");
      const research = await tx.select().from(prospectResearch).where(eq(prospectResearch.prospectId, p.id)).orderBy(desc(prospectResearch.createdAt)).limit(1);
      const history = await tx.select().from(conversationEvents).where(eq(conversationEvents.prospectId, p.id)).orderBy(asc(conversationEvents.occurredAt)).limit(30);
      const [profile] = await tx.select().from(profiles).where(eq(profiles.id, user.id));
      const portfolio = await tx.select().from(portfolioProjects);
      const [campaign] = input.campaignId ? await tx.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, input.campaignId)) : [];
      return { p, research: research[0] ?? null, history, profile, portfolio, campaign };
    });
    const { p, research, history, profile, portfolio, campaign } = ctx;

    const researchText = research
      ? [
          `What they do: ${research.whatTheyDo ?? "unknown"}`,
          `Audience: ${research.targetAudience ?? "unknown"}`,
          `Value proposition: ${research.valueProposition ?? "unknown"}`,
          `Primary CTA: ${research.primaryCta ?? "unknown"}`,
          `Observations:\n${research.observations.map((o) => `- [${o.kind}] ${o.text}`).join("\n")}`,
          `Review status: ${research.reviewStatus}`,
        ].join("\n")
      : "No research recorded.";
    const notes = [p.websiteObservations, p.businessProblem, p.personalizationNotes, input.extraNotes].filter(Boolean).join("\n");
    const profileText = [`Name: ${p.fullName}`, `Title: ${p.jobTitle ?? "unknown"}`, `Company: ${p.company ?? "unknown"}`, `Company type: ${p.companyType ?? "unknown"}`, `Industry: ${p.industry ?? "unknown"}`, `Location: ${p.location ?? "unknown"}`].join("\n");
    const historyText = history
      .filter((e) => e.content && e.type !== "status_changed")
      .map((e) => `${e.occurredAt.toISOString().slice(0, 10)} ${e.direction} ${e.type}: ${e.content!.slice(0, 600)}`)
      .join("\n");
    const sourceText = [researchText, notes, profileText, historyText].join("\n");

    const goalText = {
      start_conversation: "Open a low-pressure conversation based on one specific observation.",
      offer_ideas: "Offer to share a couple of concrete ideas about their landing page.",
      agency_partnership: "Propose a Framer development partnership for overflow or build work (they are an agency/studio).",
      follow_up_content: "They engaged with the user's content; continue that thread naturally.",
      reconnect: "Reconnect after a previous conversation went quiet, referencing it accurately.",
    }[input.goal];

    const result = await withGeneration(
      user.id,
      { feature: "outreach.personalize", promptSummary: `${input.channel}/${input.goal} for prospect ${p.id}`, prospectId: p.id },
      async (ai) => {
        const res = await ai.generateObject({
          system: [
            "You write personalized outreach for an independent web designer. Messages must be concise, specific, human, warm, confident and low-pressure.",
            positioningBlock(profile, portfolio),
            "Hard rules:",
            "- Base every statement about the recipient on the provided research, notes, profile or conversation. List each such statement in claims with its support; use 'none' if you couldn't avoid an unsupported claim.",
            "- Prefer [verified] observations. You may mention a [hypothesis] only as a question or 'wondered if', never as fact.",
            "- Never say you came across their profile, were impressed, or used their product. No flattery, no fake familiarity, no invented problems, numbers, results or connections.",
            "- Don't claim their site is broken or underperforming. Frame ideas as possibilities.",
            "- Mention a portfolio project only if it genuinely relates; never invent outcomes.",
            "- If the fit is weak, say so in service_fit and set fit_is_reasonable=false — still write respectful drafts.",
            CHANNEL_GUIDE[input.channel],
            UNTRUSTED_RULE,
          ].join("\n"),
          prompt: [
            `Goal: ${goalText}${input.kind === "connection_request" ? " This is a LinkedIn connection request note." : ""}`,
            campaign ? `Campaign strategy: ${campaign.messageStrategy ?? campaign.description ?? campaign.name}` : "",
            `Recipient profile:\n${untrusted("prospect_profile", profileText)}`,
            `Research:\n${untrusted("research", researchText)}`,
            notes ? `User's notes:\n${untrusted("user_notes", notes)}` : "",
            historyText ? `Conversation history (oldest first):\n${untrusted("history", historyText)}` : "No previous conversation.",
            "Write exactly three variants: short, value_first, relationship.",
          ]
            .filter(Boolean)
            .join("\n\n"),
          schema: messageSchema,
          effort: "medium",
        });
        return { ...res, output: JSON.stringify(res.data) };
      },
    );
    const data = result.data;
    const warnings: Record<string, string[]> = {};
    for (const v of data.variants) {
      const w = validateOutreach(v.body, sourceText, v.claims);
      if (input.kind === "connection_request" && v.body.length > 300) w.push("Over LinkedIn's connection note limit (300 characters).");
      warnings[v.variant] = w;
    }
    const proj = data.portfolio_project_number ? portfolio[data.portfolio_project_number - 1] : undefined;
    return {
      ...data,
      warnings,
      portfolio: proj ? { name: proj.name, url: proj.url, reason: data.portfolio_reason } : null,
      generationId: result.generationId,
      usedResearch: !!research,
    } satisfies OutreachDraft;
  },
);

const followUpSchema = z.object({
  body: z.string(),
  subject: z.string().nullable(),
  references: z.string().describe("Which earlier message this follows up on, in a few words"),
});

export const generateFollowUp = defineAIAction(
  "outreach.follow_up",
  z.object({ prospectId: uuid, channel: z.enum(["email", "linkedin", "x"]) }),
  async ({ prospectId, channel }, { user, db }) => {
    const { p, history, profile } = await db(async (tx) => {
      const [p] = await tx.select().from(prospects).where(eq(prospects.id, prospectId));
      if (!p) throw new UserError("Prospect not found.");
      const history = await tx.select().from(conversationEvents).where(eq(conversationEvents.prospectId, prospectId)).orderBy(asc(conversationEvents.occurredAt));
      const [profile] = await tx.select().from(profiles).where(eq(profiles.id, user.id));
      return { p, history, profile };
    });
    const lastOut = [...history].reverse().find((e) => e.direction === "outbound");
    const lastIn = [...history].reverse().find((e) => e.direction === "inbound");
    if (!lastOut) throw new UserError("There's no earlier outbound message to follow up on.");
    if (lastIn && lastIn.occurredAt > lastOut.occurredAt) throw new UserError("They replied after your last message — reply to the conversation instead of sending a follow-up.");
    if (p.status === "do_not_contact") throw new UserError("This prospect is marked do not contact.");
    const historyText = history
      .filter((e) => e.content && (e.direction !== "internal" || e.type === "note"))
      .map((e) => `${e.occurredAt.toISOString().slice(0, 10)} ${e.direction}: ${e.content!.slice(0, 800)}`)
      .join("\n");
    const { data, generationId } = await withGeneration(user.id, { feature: "outreach.follow_up", promptSummary: `follow-up ${channel} for ${prospectId}`, prospectId }, async (ai) => {
      const res = await ai.generateObject({
        system: [
          "Write one short, polite follow-up message for an independent web designer.",
          positioningBlock(profile),
          "Reference the actual previous message briefly. Add one small piece of value or a simple question. Under 70 words. No guilt-tripping ('just bumping this'), no pressure, no invented details.",
          CHANNEL_GUIDE[channel],
          UNTRUSTED_RULE,
        ].join("\n"),
        prompt: `Recipient: ${p.fullName}${p.company ? ` at ${p.company}` : ""}.\nConversation so far:\n${untrusted("history", historyText)}`,
        schema: followUpSchema,
        effort: "low",
      });
      return { ...res, output: JSON.stringify(res.data) };
    });
    return { ...data, warnings: validateOutreach(data.body, historyText, []), generationId };
  },
);

/** Saves a draft (new or as a new version of an existing draft) — keeps version history. */
export const saveMessageDraft = defineAction(
  "message.save_draft",
  z.object({
    prospectId: uuid,
    channel: z.enum(["email", "linkedin", "x"]),
    kind: z.enum(["initial", "follow_up", "connection_request", "reply"]).default("initial"),
    variant: z.enum(["short", "value_first", "relationship", "custom"]).nullable().optional(),
    subject: z.string().max(200).nullable().optional(),
    body: z.string().trim().min(1, "The message is empty").max(10000),
    campaignId: uuid.nullable().optional(),
    previousVersionId: uuid.nullable().optional(),
    generationId: uuid.nullable().optional(),
    unsupportedClaims: z.array(z.string()).default([]),
  }),
  async (input, { tx }) => {
    let version = 1;
    if (input.previousVersionId) {
      const [prev] = await tx.select().from(outreachMessages).where(eq(outreachMessages.id, input.previousVersionId));
      if (!prev) throw new UserError("Previous draft not found.");
      if (!["draft", "approved"].includes(prev.status)) throw new UserError("Only drafts can be revised.");
      version = prev.version + 1;
      // The earlier version is kept for history but is no longer actionable; a revision needs fresh approval.
      await tx.update(outreachMessages).set({ status: "cancelled" }).where(and(eq(outreachMessages.id, prev.id), inArray(outreachMessages.status, ["draft", "approved"])));
    }
    const [m] = await tx
      .insert(outreachMessages)
      .values({ ...input, variant: input.variant ?? "custom", campaignId: input.campaignId ?? null, previousVersionId: input.previousVersionId ?? null, generationId: input.generationId ?? null, version, status: "draft" })
      .returning({ id: outreachMessages.id });
    return { id: m!.id };
  },
);
