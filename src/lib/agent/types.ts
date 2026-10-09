/**
 * Event schema for the ask-the-agent pipeline. Shared by the server (pipeline, /api/ask)
 * and the client (AskPanel). Framework-free, no runtime imports, safe in any bundle.
 *
 * Wire format: newline-delimited JSON, one AgentEvent per line, in this order:
 *   start
 *   (node_start, node_end) for guard, plan, retrieve, rerank, compose, cite
 *   token* and at most one reset, interleaved inside compose
 *   citations (after cite)
 *   done
 * A node that does not run (for example retrieve after an off-topic guard) emits nothing;
 * the client shows it as skipped. `error` replaces `done` only when the server itself fails.
 */

export const AGENT_NODES = ["guard", "plan", "retrieve", "rerank", "compose", "cite"] as const;
export type AgentNode = (typeof AGENT_NODES)[number];

export type Intent =
  | "project"
  | "skills"
  | "availability"
  | "education"
  | "achievements"
  | "site"
  | "comparison"
  | "general";

/** llm = Claude wrote the answer; extractive = sentences quoted from the site; refused = guard stopped it. */
export type AgentMode = "llm" | "extractive" | "refused";

/** Why compose ran extractively (or why the LLM answer was replaced). */
export type FallbackReason =
  | "no_key" // ANTHROPIC_API_KEY not configured
  | "spend_cap" // the site's LLM budget for the day is used up
  | "llm_error" // the API call failed
  | "timeout" // no answer within the deadline
  | "refusal" // the model declined
  | "empty_output"; // the model returned no text

export interface GuardSummary {
  ok: boolean;
  chars: number;
  truncated: boolean;
  injectionSuspected: boolean;
  /** Names of the injection patterns that matched (never the matched text). */
  injectionPatterns: string[];
  offTopic: boolean;
  reason?: "empty" | "off_topic";
}

export interface PlanSummary {
  intent: Intent;
  /** Slugs of projects the question names (their docs are boosted). */
  projects: string[];
  /** Retrieval depth chosen for this intent. */
  k: number;
  /** Keywords that decided the intent. */
  signals: string[];
  /** The question without question-shaped words ("build", "tell", "his"); what BM25 searches. */
  query: string;
}

export interface RetrievedDoc {
  id: string;
  title: string;
  /** BM25 score after boosts, 2 decimals. */
  score: number;
  /** Multiplier applied (1 = none). */
  boost: number;
  /** Added by the plan's anchors (e.g. the named project's summary), not found by BM25. */
  injected?: boolean;
}

export interface RetrieveSummary {
  k: number;
  hits: RetrievedDoc[];
}

export type RerankDropReason = "empty" | "duplicate_section" | "low_score" | "limit";

export interface RerankSummary {
  /** Final context ids, in rank order. These are the only ids the answer may cite. */
  context: string[];
  dropped: { id: string; reason: RerankDropReason }[];
}

export interface ComposeSummary {
  mode: AgentMode;
  /** Model id when mode is "llm" (or when an LLM call was attempted). */
  model?: string;
  fallback?: FallbackReason;
  /** Number of sentences in an extractive answer. */
  sentences?: number;
  /** The LLM stopped at max_tokens. */
  truncated?: boolean;
  outputTokens?: number;
}

export interface CiteSummary {
  cited: number;
  /** Bracketed ids in the answer that were not in the context (hallucinated), removed. */
  dropped: number;
  droppedIds: string[];
  /** Numbers in the answer that do not appear anywhere in the context. */
  unverifiedNumbers: string[];
  /** False when the answer cites nothing and is not an explicit "I don't know". */
  grounded: boolean;
}

export interface NodeSummaries {
  guard: GuardSummary;
  plan: PlanSummary;
  retrieve: RetrieveSummary;
  rerank: RerankSummary;
  compose: ComposeSummary;
  cite: CiteSummary;
}

export interface Citation {
  /** 1-based number in order of first appearance in the answer. */
  n: number;
  id: string;
  title: string;
  url: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type NodeEndEvent = {
  [N in AgentNode]: { type: "node_end"; node: N; ms: number; summary: NodeSummaries[N] };
}[AgentNode];

export type AgentEvent =
  | { type: "start"; v: 1 }
  | { type: "node_start"; node: AgentNode; at: number }
  | NodeEndEvent
  | { type: "token"; text: string }
  /** Discard the answer text so far (an LLM stream failed midway; an extractive answer follows). */
  | { type: "reset"; reason: FallbackReason }
  | { type: "citations"; items: Citation[]; dropped: number }
  | { type: "done"; ms: number; mode: AgentMode; model?: string; fallback?: FallbackReason; usage?: Usage }
  | { type: "error"; message: string };

/** 429 body from /api/ask. */
export interface RateLimitedBody {
  error: string;
  retryAfterSeconds: number;
}
