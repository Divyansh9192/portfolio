import { describe, expect, it } from "vitest";
import { createAnthropicLLM, DEFAULT_MODEL, llmFromEnv } from "./anthropic";
import type { LLMChunk } from "./pipeline";

/** A Messages API SSE stream as the API sends it: a thinking block, then text, then usage. */
function sse(stopReason: string) {
  const events: [string, unknown][] = [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: DEFAULT_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 812, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "He built " } }],
    ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "it [a:b]." } }],
    ["content_block_stop", { type: "content_block_stop", index: 1 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 42 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
}

describe("createAnthropicLLM", () => {
  it("streams text deltas, skips thinking, and reports stop reason and usage", async () => {
    const requests: Record<string, unknown>[] = [];
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(sse("end_turn"), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const llm = createAnthropicLLM({ apiKey: "test-key", fetch: fakeFetch });
    const chunks: LLMChunk[] = [];
    for await (const c of llm.stream({ system: "sys", prompt: "q", maxTokens: 400, signal: new AbortController().signal })) chunks.push(c);

    expect(chunks).toEqual([
      { type: "text", text: "He built " },
      { type: "text", text: "it [a:b]." },
      { type: "end", stopReason: "end_turn", usage: { inputTokens: 812, outputTokens: 42 } },
    ]);
    expect(requests[0]).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 400, system: "sys", stream: true, output_config: { effort: "low" } });
    expect(requests[0]).not.toHaveProperty("temperature");
    expect(requests[0]).not.toHaveProperty("thinking");
  });

  it("surfaces API errors to the pipeline (which falls back)", async () => {
    const fakeFetch = (async () => Response.json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, { status: 529 })) as typeof fetch;
    const llm = createAnthropicLLM({ apiKey: "test-key", fetch: fakeFetch });
    const run = async () => {
      for await (const chunk of llm.stream({ system: "s", prompt: "q", maxTokens: 400, signal: new AbortController().signal })) void chunk;
    };
    await expect(run()).rejects.toThrow();
  });
});

describe("llmFromEnv", () => {
  it("returns null without a key and honours ANTHROPIC_MODEL", () => {
    expect(llmFromEnv({ NODE_ENV: "test" })).toBeNull();
    expect(llmFromEnv({ NODE_ENV: "test", ANTHROPIC_API_KEY: "k" })?.model).toBe(DEFAULT_MODEL);
    expect(llmFromEnv({ NODE_ENV: "test", ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-sonnet-5-5" })?.model).toBe("claude-sonnet-5-5");
  });
});
