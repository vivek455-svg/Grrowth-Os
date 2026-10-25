import "server-only";
import { and, count, eq, gte } from "drizzle-orm";
import { env } from "@/lib/env";
import { withUser, type Tx } from "@/db/client";
import { aiGenerationHistory } from "@/db/schema";
import { log } from "@/lib/logger";
import { AnthropicProvider } from "./anthropic";
import { AIError, type AIProvider, type AIUsage } from "./types";

export { AIError } from "./types";
export type { AIProvider } from "./types";

export const DEFAULT_MODEL = "claude-opus-5-5";
/** Per-user cap on AI generations per rolling hour (protects cost and abuse). */
export const AI_HOURLY_LIMIT = 60;

let cached: AIProvider | null | undefined;

/**
 * Returns the configured provider, or null when no AI credentials are set.
 * Register additional providers here; nothing else in the app needs to change.
 */
export function getAIProvider(): AIProvider | null {
  if (cached !== undefined) return cached;
  const e = env();
  const provider = e.AI_PROVIDER ?? (e.ANTHROPIC_API_KEY ? "anthropic" : undefined);
  if (provider === "anthropic" && e.ANTHROPIC_API_KEY) cached = new AnthropicProvider(e.ANTHROPIC_API_KEY, e.AI_MODEL ?? DEFAULT_MODEL);
  else cached = null;
  return cached;
}

export function aiStatus() {
  const p = getAIProvider();
  return p ? { connected: true as const, provider: p.name, model: p.model } : { connected: false as const, provider: null, model: null };
}

export function requireAI(): AIProvider {
  const p = getAIProvider();
  if (!p) throw new AIError("Connect an AI provider on the Integrations page to use this feature.", "not_configured");
  return p;
}

/** DB-backed rate limit: works across serverless instances without extra infrastructure. */
export async function assertAIBudget(tx: Tx) {
  const [row] = await tx
    .select({ n: count() })
    .from(aiGenerationHistory)
    .where(gte(aiGenerationHistory.createdAt, new Date(Date.now() - 3600_000)));
  if ((row?.n ?? 0) >= AI_HOURLY_LIMIT)
    throw new AIError(`You've reached the limit of ${AI_HOURLY_LIMIT} AI generations per hour. Try again later.`, "rate_limited");
}

/**
 * Runs an AI call with a budget check and history logging. The provider call happens
 * OUTSIDE any database transaction (it can take a while); budget check and logging are
 * short, separate RLS-scoped transactions so failures are recorded too.
 * Inputs are summarised, not stored verbatim, to keep prospect data out of history.
 */
export async function withGeneration<T>(
  userId: string,
  meta: { feature: string; promptSummary: string; prospectId?: string | null; contentItemId?: string | null },
  fn: (ai: AIProvider) => Promise<{ data: T; usage: AIUsage; output: string }>,
): Promise<{ data: T; generationId: string }> {
  const ai = requireAI();
  await withUser(userId, assertAIBudget);
  const base = {
    feature: meta.feature,
    provider: ai.name,
    model: ai.model,
    promptSummary: meta.promptSummary.slice(0, 500),
    prospectId: meta.prospectId ?? null,
    contentItemId: meta.contentItemId ?? null,
  };
  try {
    const res = await fn(ai);
    const [row] = await withUser(userId, (tx) =>
      tx
        .insert(aiGenerationHistory)
        .values({ ...base, output: res.output.slice(0, 20000), status: "succeeded", inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens })
        .returning({ id: aiGenerationHistory.id }),
    );
    return { data: res.data, generationId: row!.id };
  } catch (e) {
    const message = e instanceof AIError ? e.message : "AI generation failed";
    log("warn", "ai_generation_failed", { feature: meta.feature, error: e });
    await withUser(userId, (tx) => tx.insert(aiGenerationHistory).values({ ...base, status: "failed", error: message }));
    throw e;
  }
}

export async function recentGenerations(tx: Tx, feature: string, limit = 10) {
  return tx
    .select()
    .from(aiGenerationHistory)
    .where(and(eq(aiGenerationHistory.feature, feature), eq(aiGenerationHistory.status, "succeeded")))
    .limit(limit);
}
