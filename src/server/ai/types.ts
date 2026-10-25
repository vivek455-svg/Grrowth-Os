import type { z } from "zod";

/**
 * Provider-agnostic AI interface. The rest of the app depends only on this; adding a
 * provider means implementing it and registering it in ./index.ts.
 */
export type AIUsage = { inputTokens: number | null; outputTokens: number | null };

export type AIToolDef = {
  name: string;
  description: string;
  /** JSON Schema with additionalProperties: false and every property required. */
  inputSchema: Record<string, unknown>;
};

export type AIChatMessage = { role: "user" | "assistant"; content: string };

export type AIToolCall = { name: string; input: unknown; output: string };

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /** Structured output validated against a Zod schema. */
  generateObject<T>(opts: { system: string; prompt: string; schema: z.ZodType<T>; effort?: "low" | "medium" | "high"; maxTokens?: number }): Promise<{ data: T; usage: AIUsage }>;
  /** Multi-step tool use. Tools are executed by the caller-supplied handler (read-only by contract). */
  runWithTools(opts: {
    system: string;
    messages: AIChatMessage[];
    tools: AIToolDef[];
    execute: (name: string, input: unknown) => Promise<string>;
    maxSteps?: number;
  }): Promise<{ text: string; toolCalls: AIToolCall[]; usage: AIUsage }>;
}

export class AIError extends Error {
  constructor(
    message: string,
    readonly kind: "not_configured" | "refused" | "rate_limited" | "invalid_output" | "provider_error",
  ) {
    super(message);
  }
}
