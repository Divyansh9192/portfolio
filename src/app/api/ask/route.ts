/**
 * POST /api/ask  {"question": "..."}  →  application/x-ndjson stream of AgentEvent lines.
 *
 *   curl -N -X POST <site>/api/ask -H 'content-type: application/json' \
 *        -d '{"question":"What did he build with Kafka?"}'
 *
 * Guards: 8 questions per minute per IP (token bucket, 429 + Retry-After), a site-wide
 * daily cap on LLM calls (ASK_LLM_DAILY_CAP, default 300; over it, answers are extractive),
 * JSON only, body ≤ 2 KB. Both limits are in-memory and therefore per instance: best-effort
 * on serverless (see src/lib/agent/ratelimit.ts).
 *
 * Privacy: the question is never logged, and nothing logged carries the IP.
 */

import { z } from "zod";
import { llmFromEnv } from "@/lib/agent/anthropic";
import { runAgent } from "@/lib/agent/pipeline";
import { clientIp, createRateLimiter } from "@/lib/agent/ratelimit";
import type { AgentEvent, RateLimitedBody } from "@/lib/agent/types";

export const runtime = "nodejs";
/** LLM deadline is 15 s; leave room for the extractive fallback and stream teardown. */
export const maxDuration = 30;

const MAX_BODY_BYTES = 2048;
const PER_MINUTE = 8;
const DAY_MS = 86_400_000;
const LLM_DAILY_CAP = Math.max(0, Number.parseInt(process.env.ASK_LLM_DAILY_CAP ?? "", 10) || 300);

const perIp = createRateLimiter({ capacity: PER_MINUTE, refill: PER_MINUTE, intervalMs: 60_000 });
const llmBudget = createRateLimiter({ capacity: LLM_DAILY_CAP, refill: LLM_DAILY_CAP, intervalMs: DAY_MS, maxKeys: 1 });

const Body = z.object({ question: z.string().max(4000) });

const BASE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...BASE_HEADERS, ...headers } });
}

/** Read at most `limit` bytes; null when the body is larger. */
async function readCapped(req: Request, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(req: Request): Promise<Response> {
  const limit = perIp.take(clientIp(req.headers));
  if (!limit.ok) {
    const body: RateLimitedBody = {
      error: `That's ${PER_MINUTE} questions in a minute. Try again in ${limit.retryAfterSeconds} seconds.`,
      retryAfterSeconds: limit.retryAfterSeconds,
    };
    return json(429, body, { "Retry-After": String(limit.retryAfterSeconds) });
  }

  // JSON only: a cross-site page cannot send this content type without a CORS preflight,
  // which this route does not answer, so other sites cannot spend the visitor's quota.
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    return json(415, { error: 'Send JSON: Content-Type: application/json, body {"question": "..."}' });
  }

  const raw = await readCapped(req, MAX_BODY_BYTES);
  if (raw === null) return json(413, { error: `Body too large (limit ${MAX_BODY_BYTES} bytes).` });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { error: "Body is not valid JSON." });
  }
  const body = Body.safeParse(parsed);
  if (!body.success) return json(400, { error: 'Expected {"question": string}.' });

  const llm = llmFromEnv();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        const result = await runAgent(body.data.question, {
          emit,
          signal: abort.signal,
          ...(llm ? { llm, allowLLMCall: () => llmBudget.take("llm").ok } : { noLLMReason: "no_key" as const }),
        });
        if (!result.aborted) {
          // Operational signal only: no question text, no IP.
          console.info(JSON.stringify({ route: "/api/ask", mode: result.mode, ms: result.ms, fallback: result.fallback ?? null, cited: result.citations.length }));
        }
      } catch (err) {
        console.error("[api/ask] pipeline error:", err instanceof Error ? err.message : "unknown");
        try {
          emit({ type: "error", message: "The agent failed before it could answer. Try again." });
        } catch {
          // Stream already closed by the client.
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed or cancelled.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-RateLimit-Limit": String(PER_MINUTE),
      "X-RateLimit-Remaining": String(limit.remaining),
    },
  });
}

/** Everything else is 405 (Next answers OPTIONS/HEAD itself); GET explains how to call it. */
export function GET(): Response {
  return json(405, { error: 'Method not allowed. POST {"question": "..."} as JSON.' }, { Allow: "POST" });
}
