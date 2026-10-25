import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AIError, type AIProvider, type AIToolCall, type AIUsage } from "./types";

// Server-side refusal fallback: on a classifier decline, the API re-runs the request on
// Anthropic's recommended fallback model for that refusal category.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

function usageOf(u: { input_tokens?: number | null; output_tokens?: number | null } | undefined): AIUsage {
  return { inputTokens: u?.input_tokens ?? null, outputTokens: u?.output_tokens ?? null };
}

function mapError(e: unknown): never {
  if (e instanceof AIError) throw e;
  if (e instanceof Anthropic.RateLimitError) throw new AIError("The AI provider is rate limiting requests. Try again in a minute.", "rate_limited");
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    throw new AIError("The AI provider rejected the API key. Check it on the Integrations page.", "not_configured");
  if (e instanceof Anthropic.BadRequestError) throw new AIError("The AI request was invalid. Try shortening the input.", "provider_error");
  if (e instanceof Anthropic.APIError) throw new AIError("The AI provider is unavailable right now. Try again shortly.", "provider_error");
  if (e instanceof Anthropic.APIConnectionError) throw new AIError("Couldn't reach the AI provider. Check your network.", "provider_error");
  throw e;
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  }

  async generateObject<T>(opts: Parameters<AIProvider["generateObject"]>[0] & { schema: import("zod").ZodType<T> }) {
    try {
      const res = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: opts.maxTokens ?? 16000,
        system: opts.system,
        messages: [{ role: "user", content: opts.prompt }],
        output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
        ...FALLBACK,
      });
      if (res.stop_reason === "refusal") throw new AIError("The AI provider declined this request.", "refused");
      if (res.stop_reason === "max_tokens") throw new AIError("The response was too long and got cut off. Try a narrower request.", "invalid_output");
      if (!res.parsed_output) throw new AIError("The AI returned an unexpected format. Try again.", "invalid_output");
      return { data: res.parsed_output as T, usage: usageOf(res.usage) };
    } catch (e) {
      mapError(e);
    }
  }

  async runWithTools(opts: Parameters<AIProvider["runWithTools"]>[0]) {
    const tools: Anthropic.Beta.BetaTool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      strict: true,
    }));
    const messages: Anthropic.Beta.BetaMessageParam[] = opts.messages.map((m) => ({ role: m.role, content: m.content }));
    const calls: AIToolCall[] = [];
    const usage: AIUsage = { inputTokens: 0, outputTokens: 0 };
    try {
      for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
        const res = await this.client.beta.messages.create({
          model: this.model,
          max_tokens: 16000,
          system: opts.system,
          tools,
          messages,
          output_config: { effort: "medium" },
          ...FALLBACK,
        });
        usage.inputTokens! += res.usage.input_tokens ?? 0;
        usage.outputTokens! += res.usage.output_tokens ?? 0;
        if (res.stop_reason === "refusal") throw new AIError("The AI provider declined this request.", "refused");
        // Append the full content (including thinking blocks) unchanged.
        messages.push({ role: "assistant", content: res.content });
        const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
          const text = res.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n")
            .trim();
          return { text, toolCalls: calls, usage };
        }
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const t of toolUses) {
          let output: string;
          let isError = false;
          try {
            output = await opts.execute(t.name, t.input);
          } catch (err) {
            output = err instanceof Error ? err.message : "Tool failed";
            isError = true;
          }
          calls.push({ name: t.name, input: t.input, output });
          results.push({ type: "tool_result", tool_use_id: t.id, content: output, is_error: isError });
        }
        // All tool results go back in a single user message.
        messages.push({ role: "user", content: results });
      }
      throw new AIError("The assistant needed too many steps. Try a more specific question.", "invalid_output");
    } catch (e) {
      mapError(e);
    }
  }
}
