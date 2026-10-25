"use server";

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import {
  contentItems,
  contentMetricsSnapshots,
  contentPlatformVersions,
  prospects,
  prospectSources,
} from "@/db/schema";
import { audit, defineAction, UserError } from "@/server/action";
import { validateContentRows, validateProspectRows } from "@/lib/domain/csv-import";
import type { Tx } from "@/db/client";

const MAX_ROWS = 2000;
const rowsSchema = z.array(z.record(z.string(), z.string())).max(MAX_ROWS, `Import up to ${MAX_ROWS} rows at a time`);

async function existingProspects(tx: Tx) {
  return tx
    .select({
      id: prospects.id,
      fullName: prospects.fullName,
      company: prospects.company,
      email: prospects.email,
      linkedinUrl: prospects.linkedinUrl,
      companyWebsite: prospects.companyWebsite,
      websiteUrl: prospects.websiteUrl,
    })
    .from(prospects);
}

export const previewProspectImport = defineAction("import.prospects.preview", z.object({ rows: rowsSchema }), async ({ rows }, { tx }) => {
  return validateProspectRows(rows, await existingProspects(tx));
});

/** Re-validates on the server (never trusts the preview) and inserts only the selected valid rows. */
export const commitProspectImport = defineAction(
  "import.prospects.commit",
  z.object({ rows: rowsSchema, include: z.array(z.number().int()).max(MAX_ROWS), status: z.string().default("new") }),
  async ({ rows, include, status }, { tx }) => {
    const results = validateProspectRows(rows, await existingProspects(tx));
    const wanted = new Set(include);
    const toInsert = results.filter((r) => wanted.has(r.index) && r.data && !r.duplicateOf && r.duplicateInFile === null);
    if (!toInsert.length) throw new UserError("No valid, non-duplicate rows selected.");
    let inserted = 0;
    for (const r of toInsert) {
      const [p] = await tx
        .insert(prospects)
        .values({ ...r.data!, status })
        .onConflictDoNothing()
        .returning({ id: prospects.id });
      if (!p) continue;
      inserted++;
      await tx.insert(prospectSources).values({ prospectId: p.id, sourceType: "csv", reason: r.data!.source, reviewStatus: "added" });
    }
    await audit(tx, "import.prospects", { type: "prospect" }, { inserted, requested: include.length });
    return { inserted, skipped: include.length - inserted };
  },
);

export const previewContentImport = defineAction("import.content.preview", z.object({ rows: rowsSchema }), async ({ rows }, { tx }) => {
  const results = validateContentRows(rows);
  const urls = results.map((r) => r.data?.url).filter((u): u is string => !!u);
  const existing = urls.length
    ? new Set((await tx.select({ url: contentPlatformVersions.platformPostUrl }).from(contentPlatformVersions).where(inArray(contentPlatformVersions.platformPostUrl, urls))).map((r) => r.url))
    : new Set<string | null>();
  return results.map((r) => ({ ...r, duplicate: !!r.data?.url && existing.has(r.data.url) }));
});

export const commitContentImport = defineAction(
  "import.content.commit",
  z.object({ rows: rowsSchema, include: z.array(z.number().int()).max(MAX_ROWS) }),
  async ({ rows, include }, { tx }) => {
    const wanted = new Set(include);
    const results = validateContentRows(rows).filter((r) => wanted.has(r.index) && r.data);
    let inserted = 0;
    for (const r of results) {
      const d = r.data!;
      if (d.url) {
        const [dup] = await tx.select({ id: contentPlatformVersions.id }).from(contentPlatformVersions).where(and(eq(contentPlatformVersions.platformPostUrl, d.url)));
        if (dup) continue;
      }
      const [item] = await tx.insert(contentItems).values({ title: d.title }).returning({ id: contentItems.id });
      const [v] = await tx
        .insert(contentPlatformVersions)
        .values({ contentItemId: item!.id, platform: d.platform, body: d.text, status: "published", publishedAt: d.publishedAt, publishSource: "manual", platformPostUrl: d.url })
        .returning({ id: contentPlatformVersions.id });
      if (Object.values(d.metrics).some((m) => m !== null))
        await tx.insert(contentMetricsSnapshots).values({ versionId: v!.id, capturedAt: new Date(), source: "csv", ...d.metrics });
      inserted++;
    }
    await audit(tx, "import.content", { type: "content_item" }, { inserted });
    return { inserted, skipped: include.length - inserted };
  },
);
