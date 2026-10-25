"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { aiInsights, aiRecommendations, contentIdeas } from "@/db/schema";
import { UserError, defineAction } from "@/server/action";

const uuid = z.string().uuid();

export const setInsightStatus = defineAction(
  "insight.status",
  z.object({ id: uuid, status: z.enum(["useful", "dismissed", "active"]) }),
  async ({ id, status }, { tx }) => {
    await tx.update(aiInsights).set({ status }).where(eq(aiInsights.id, id));
    return null;
  },
);

/** Turns an insight into a content idea, keeping a link back to the evidence. */
export const insightToIdea = defineAction("insight.to_idea", z.object({ id: uuid }), async ({ id }, { tx }) => {
  const [i] = await tx.select().from(aiInsights).where(eq(aiInsights.id, id));
  if (!i) throw new UserError("Insight not found.");
  const pillarId = i.kind === "pillar_performance" ? ((i.evidence as { group?: string }).group ?? null) : null;
  await tx.insert(contentIdeas).values({
    title: `Idea from insight: ${i.title}`,
    notes: i.body,
    source: "insight",
    sourceRef: i.id,
    pillarId: pillarId && /^[0-9a-f-]{36}$/.test(pillarId) ? pillarId : null,
  });
  await tx.update(aiInsights).set({ status: "converted" }).where(eq(aiInsights.id, id));
  return null;
});

export const setRecommendationStatus = defineAction(
  "recommendation.status",
  z.object({ id: uuid, status: z.enum(["done", "dismissed", "open"]) }),
  async ({ id, status }, { tx }) => {
    await tx.update(aiRecommendations).set({ status, statusChangedAt: new Date() }).where(eq(aiRecommendations.id, id));
    return null;
  },
);
