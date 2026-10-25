"use server";

import { z } from "zod";
import { eq, isNotNull } from "drizzle-orm";
import { discoveryRuns, prospects, prospectSources, campaignProspects } from "@/db/schema";
import { UserError, defineAction, defineAIAction } from "@/server/action";
import { getAIProvider, withGeneration } from "@/server/ai";
import { UNTRUSTED_RULE, untrusted } from "@/server/ai/prompts";
import { searchProvider } from "@/server/integrations/providers";
import { IntegrationError } from "@/server/integrations/oauth";
import { normalizeDomain } from "@/lib/domain/outreach-rules";
import { discoveryConfigSchema } from "@/lib/domain/discovery";

const uuid = z.string().uuid();



/** Turns a natural-language request into a structured, editable discovery configuration. */
export const planDiscovery = defineAIAction("discovery.plan", z.object({ query: z.string().trim().min(10).max(1000) }), async ({ query }, { user }) => {
  const { data } = await withGeneration(user.id, { feature: "discovery.plan", promptSummary: query.slice(0, 200) }, async (ai) => {
    const res = await ai.generateObject({
      system: [
        "Convert a web designer's prospecting request into a structured search configuration.",
        "searchQueries: 1–3 web search queries likely to surface company websites or public pages (not personal data). Never include email-finding or scraping operators.",
        "requiredEvidence: what must be visible on a public page for a result to count.",
        "source: 'search_api' unless the request clearly refers to a list the user already has ('csv') or manual research ('manual').",
        "maxResults between 5 and 30.",
        UNTRUSTED_RULE,
      ].join("\n"),
      prompt: untrusted("request", query),
      schema: discoveryConfigSchema,
      effort: "low",
    });
    return { ...res, output: JSON.stringify(res.data) };
  });
  return data;
});

const candidateSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      is_company_site_or_profile: z.boolean(),
      company_name: z.string().nullable(),
      person_name: z.string().nullable().describe("Only if explicitly named in the title/snippet; else null"),
      person_title: z.string().nullable(),
      reason: z.string().describe("Why this result may match the request"),
      evidence: z.string().nullable().describe("Exact phrase from the title or snippet supporting the reason"),
      uncertainty: z.string().describe("What is unknown or needs checking"),
      relevant: z.boolean(),
    }),
  ),
});

/**
 * Runs a discovery configuration against the connected search API. Results are stored as
 * candidates for review — nothing is added to the CRM until the user chooses to.
 */
export const runDiscovery = defineAIAction("discovery.run", z.object({ query: z.string().max(1000), config: discoveryConfigSchema }), async ({ query, config }, { user, db }) => {
  const search = searchProvider();
  if (config.source !== "search_api") throw new UserError(config.source === "csv" ? "Use Import CSV for lists you already have." : "Add prospects manually from the Prospects page.");
  if (!search) throw new UserError("No search API connected. Add a Brave Search API key on the Integrations page, import a CSV, or add prospects manually.");

  const [run] = await db((tx) => tx.insert(discoveryRuns).values({ query, config, provider: "brave", status: "running" }).returning());
  try {
    const perQuery = Math.ceil(config.maxResults / config.searchQueries.length);
    const raw = (await Promise.all(config.searchQueries.map((q) => search.search(q, Math.min(perQuery + 5, 20))))).flat();
    // De-duplicate by domain and skip obvious non-business hosts.
    const seen = new Set<string>();
    const blocked = /(^|\.)(google|youtube|wikipedia|reddit|facebook|instagram|tiktok|pinterest|quora|medium)\./i;
    const results = raw.filter((r) => {
      const d = normalizeDomain(r.url);
      if (!d || seen.has(d) || blocked.test(`.${d}`)) return false;
      seen.add(d);
      return true;
    }).slice(0, config.maxResults);

    const existingDomains = new Set(
      (await db((tx) => tx.select({ d: prospects.domainKey }).from(prospects).where(isNotNull(prospects.domainKey)))).map((r) => r.d),
    );

    let classified: z.infer<typeof candidateSchema>["results"] | null = null;
    if (getAIProvider() && results.length) {
      const list = results.map((r, i) => `[${i}] ${r.title}\n${r.url}\n${r.description}`).join("\n\n");
      const { data } = await withGeneration(user.id, { feature: "discovery.classify", promptSummary: `${results.length} results for: ${query.slice(0, 120)}` }, async (ai) => {
        const res = await ai.generateObject({
          system: [
            "You review web search results for a web designer looking for potential clients.",
            `Target: ${config.companyType}; industry: ${config.industry}; geography: ${config.geography}; size: ${config.companySize}; decision maker: ${config.decisionMakerRole}. Required evidence: ${config.requiredEvidence}.`,
            "Judge only from the title and snippet. Never invent people, emails or facts. If something isn't stated, put it in uncertainty.",
            UNTRUSTED_RULE,
          ].join("\n"),
          prompt: untrusted("search_results", list, 30000),
          schema: candidateSchema,
          effort: "low",
        });
        return { ...res, output: JSON.stringify(res.data) };
      });
      classified = data.results;
    }

    const rows = results
      .map((r, i) => {
        const c = classified?.find((x) => x.index === i);
        if (classified && (!c || !c.relevant || !c.is_company_site_or_profile)) return null;
        const domain = normalizeDomain(r.url)!;
        // Evidence must appear in the snippet/title; otherwise it's dropped rather than trusted.
        const hay = `${r.title} ${r.description}`.toLowerCase();
        const evidence = c?.evidence && hay.includes(c.evidence.toLowerCase()) ? c.evidence : null;
        return {
          discoveryRunId: run!.id,
          sourceType: "search_api" as const,
          sourceUrl: r.url,
          candidateCompany: c?.company_name ?? r.title.split(/[|–—-]/)[0]!.trim().slice(0, 120),
          candidateName: c?.person_name && hay.includes(c.person_name.toLowerCase()) ? c.person_name : null,
          candidateTitle: c?.person_title ?? null,
          candidateWebsite: `https://${domain}`,
          reason: c?.reason ?? "Matched the search query",
          evidence: evidence ?? r.description.slice(0, 300),
          uncertainty: c?.uncertainty ?? "Not reviewed by AI. Check the site before adding.",
          reviewStatus: existingDomains.has(domain) ? ("duplicate" as const) : ("pending" as const),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    await db(async (tx) => {
      if (rows.length) await tx.insert(prospectSources).values(rows);
      await tx.update(discoveryRuns).set({ status: "completed" }).where(eq(discoveryRuns.id, run!.id));
    });
    return { runId: run!.id, found: rows.length, searched: results.length };
  } catch (e) {
    const message = e instanceof UserError || e instanceof IntegrationError ? e.message : "Discovery failed.";
    await db((tx) => tx.update(discoveryRuns).set({ status: "failed", error: message }).where(eq(discoveryRuns.id, run!.id)));
    if (e instanceof IntegrationError) throw new UserError(e.message);
    throw e;
  }
});

export const reviewCandidate = defineAction(
  "discovery.review",
  z.object({ id: uuid, status: z.enum(["dismissed", "duplicate", "pending"]) }),
  async ({ id, status }, { tx }) => {
    await tx.update(prospectSources).set({ reviewStatus: status }).where(eq(prospectSources.id, id));
    return null;
  },
);

/** Adds a reviewed candidate to the CRM. The user supplies the contact; nothing is inferred. */
export const addCandidate = defineAction(
  "discovery.add",
  z.object({
    id: uuid,
    fullName: z.string().trim().min(1, "Add the person's name").max(200),
    jobTitle: z.string().trim().max(200).optional(),
    linkedinUrl: z.string().trim().max(500).optional(),
    company: z.string().trim().max(200).optional(),
    campaignId: uuid.nullable().optional(),
  }),
  async (input, { tx }) => {
    const [c] = await tx.select().from(prospectSources).where(eq(prospectSources.id, input.id));
    if (!c) throw new UserError("Candidate not found.");
    if (c.reviewStatus === "added") throw new UserError("Already added.");
    const [p] = await tx
      .insert(prospects)
      .values({
        fullName: input.fullName,
        jobTitle: input.jobTitle || null,
        company: input.company || c.candidateCompany,
        companyWebsite: c.candidateWebsite,
        websiteUrl: c.candidateWebsite,
        linkedinUrl: input.linkedinUrl && /^https?:\/\//.test(input.linkedinUrl) ? input.linkedinUrl : null,
        source: "Prospect discovery",
        status: "new",
        websiteObservations: c.evidence,
      })
      .returning({ id: prospects.id });
    await tx.update(prospectSources).set({ prospectId: p!.id, reviewStatus: "added" }).where(eq(prospectSources.id, c.id));
    if (input.campaignId) await tx.insert(campaignProspects).values({ campaignId: input.campaignId, prospectId: p!.id }).onConflictDoNothing();
    return { id: p!.id };
  },
);
