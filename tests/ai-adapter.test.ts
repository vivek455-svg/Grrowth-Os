import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "@/server/ai/anthropic";
import { AIError } from "@/server/ai/types";
import { reconcileObservations } from "@/lib/domain/research";

type Call = { url: string; headers: Headers; body: Record<string, unknown> };

/** Fake Messages API: returns queued responses and records every request. */
function fakeApi(responses: Record<string, unknown>[], status = 200) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const next = responses.shift() ?? {};
    return new Response(JSON.stringify(next), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const message = (content: unknown[], stop_reason = "end_turn") => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 20 },
});

describe("Anthropic provider adapter", () => {
  it("requests structured output with refusal fallback and parses the result", async () => {
    const { calls, fetchImpl } = fakeApi([message([{ type: "text", text: JSON.stringify({ items: ["a", "b"] }) }])]);
    const ai = new AnthropicProvider("sk-test", "claude-opus-5-5", { fetch: fetchImpl, maxRetries: 0 });
    const res = await ai.generateObject({ system: "sys", prompt: "hello", schema: z.object({ items: z.array(z.string()) }), effort: "low" });
    expect(res.data).toEqual({ items: ["a", "b"] });
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    const body = calls[0]!.body as { model: string; fallbacks: unknown; output_config: { effort: string; format: { type: string } }; system: string };
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(body.output_config.effort).toBe("low");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(calls[0]!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
  });

  it("surfaces refusals as a safe AIError", async () => {
    const { fetchImpl } = fakeApi([message([], "refusal")]);
    const ai = new AnthropicProvider("sk-test", "claude-opus-5-5", { fetch: fetchImpl, maxRetries: 0 });
    await expect(ai.generateObject({ system: "s", prompt: "p", schema: z.object({ a: z.string() }) })).rejects.toMatchObject({ kind: "refused" });
  });

  it("maps auth failures to a not_configured error without leaking details", async () => {
    const { fetchImpl } = fakeApi([{ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }], 401);
    const ai = new AnthropicProvider("sk-bad", "claude-opus-5-5", { fetch: fetchImpl, maxRetries: 0 });
    const err = await ai.generateObject({ system: "s", prompt: "p", schema: z.object({ a: z.string() }) }).catch((e) => e);
    expect(err).toBeInstanceOf(AIError);
    expect(err.kind).toBe("not_configured");
    expect(err.message).not.toContain("x-api-key");
  });

  it("runs the tool loop: executes tools, returns all results in one user turn, then answers", async () => {
    const { calls, fetchImpl } = fakeApi([
      message(
        [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "tu_1", name: "follow_ups_due", input: {} },
          { type: "tool_use", id: "tu_2", name: "pipeline_summary", input: {} },
        ],
        "tool_use",
      ),
      message([{ type: "text", text: "You have 2 follow-ups due." }]),
    ]);
    const executed: string[] = [];
    const ai = new AnthropicProvider("sk-test", "claude-opus-5-5", { fetch: fetchImpl, maxRetries: 0 });
    const res = await ai.runWithTools({
      system: "sys",
      messages: [{ role: "user", content: "What's due?" }],
      tools: [
        { name: "follow_ups_due", description: "d", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
        { name: "pipeline_summary", description: "d", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
      ],
      execute: async (name) => {
        executed.push(name);
        if (name === "pipeline_summary") throw new Error("db down");
        return JSON.stringify({ count: 2 });
      },
    });
    expect(res.text).toBe("You have 2 follow-ups due.");
    expect(executed).toEqual(["follow_ups_due", "pipeline_summary"]);
    const second = calls[1]!.body as { messages: { role: string; content: { type: string; tool_use_id?: string; is_error?: boolean }[] }[]; tools: { strict: boolean }[] };
    const last = second.messages[second.messages.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content.map((c) => [c.tool_use_id, c.is_error])).toEqual([["tu_1", false], ["tu_2", true]]);
    expect(second.tools.every((t) => t.strict)).toBe(true);
    // The assistant turn with tool_use blocks is passed back unchanged.
    expect(second.messages[1]!.role).toBe("assistant");
  });
});

describe("research observation guard", () => {
  const page = "Reports in minutes. Trusted by 2,000 teams. Book a demo.";
  it("keeps verified observations only when the quote is on the page", () => {
    const out = reconcileObservations(
      [
        { text: "Hero promises speed", kind: "verified", evidence_quote: "Reports in minutes" },
        { text: "Claims SOC 2", kind: "verified", evidence_quote: "SOC 2 certified" },
        { text: "Visitors may not know who it's for", kind: "hypothesis", evidence_quote: null },
      ],
      page,
      "https://acme.test",
    );
    expect(out[0]).toEqual({ text: "Hero promises speed", kind: "verified", source_url: "https://acme.test" });
    expect(out[1]!.kind).toBe("hypothesis");
    expect(out[1]!.text).toMatch(/treat as unverified/);
    expect(out[2]!.kind).toBe("hypothesis");
  });
});
