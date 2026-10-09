/**
 * LLMClient backed by the Anthropic SDK. Server-only (reads the API key, imports the SDK).
 *
 * Model: Claude Haiku 5.5 by default, the fast, low-cost tier, overridable with
 * ANTHROPIC_MODEL. The request is a single streamed message:
 *   - effort "low": short grounded answers need little thinking, and thinking tokens
 *     count toward max_tokens. Thinking is left at the model default (adaptive) rather
 *     than disabled, so an ANTHROPIC_MODEL override to an Opus/Sonnet model still works.
 *     (A Haiku 4.5 override would reject `effort`; the pipeline then falls back to extractive.)
 *   - no temperature/top_p: current models reject non-default sampling values.
 *   - maxRetries 0 and a 15 s timeout: the pipeline has an instant extractive fallback,
 *     so waiting on retries is worse for the visitor than answering without the LLM.
 */

import Anthropic from "@anthropic-ai/sdk";
import { LLM_TIMEOUT_MS, type LLMChunk, type LLMClient, type LLMRequest } from "./pipeline";

export const DEFAULT_MODEL = "claude-haiku-5-5";

export function createAnthropicLLM(opts: { apiKey: string; model?: string; fetch?: typeof fetch }): LLMClient {
  const model = opts.model || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 0, timeout: LLM_TIMEOUT_MS, ...(opts.fetch ? { fetch: opts.fetch } : {}) });

  return {
    model,
    async *stream({ system, prompt, maxTokens, signal }: LLMRequest): AsyncGenerator<LLMChunk> {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: maxTokens,
          system,
          output_config: { effort: "low" },
          messages: [{ role: "user", content: prompt }],
        },
        { signal },
      );
      try {
        for await (const event of stream) {
          // Read content by type: thinking blocks (empty text by default) are skipped.
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
          }
        }
        const final = await stream.finalMessage();
        yield {
          type: "end",
          stopReason: final.stop_reason,
          usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
        };
      } finally {
        // Consumer stopped early (client gone, deadline): close the HTTP stream.
        if (!stream.ended) stream.abort();
      }
    },
  };
}

/** The configured LLM, or null when no API key is set (the pipeline then answers extractively). */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LLMClient | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return createAnthropicLLM({ apiKey, model: env.ANTHROPIC_MODEL?.trim() || undefined });
}
