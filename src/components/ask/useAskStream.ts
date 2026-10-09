"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  AGENT_NODES,
  type AgentEvent,
  type AgentNode,
  type Citation,
  type FallbackReason,
  type NodeSummaries,
  type RateLimitedBody,
} from "@/lib/agent/types";

export type NodeStatus = "waiting" | "running" | "done" | "skipped";

export interface NodeState<N extends AgentNode = AgentNode> {
  status: NodeStatus;
  ms?: number;
  summary?: NodeSummaries[N];
}

export type NodesState = { [N in AgentNode]: NodeState<N> };

export type Phase = "idle" | "streaming" | "done" | "stopped" | "error" | "limited";

export interface AskState {
  phase: Phase;
  question: string;
  nodes: NodesState;
  answer: string;
  citations: Citation[] | null;
  done: Extract<AgentEvent, { type: "done" }> | null;
  /** Set when an LLM answer was discarded mid-stream for an extractive one. */
  resetReason: FallbackReason | null;
  error: string | null;
  retryAfterSeconds: number | null;
}

type Action =
  | { type: "begin"; question: string }
  | { type: "event"; event: AgentEvent }
  | { type: "end" }
  | { type: "stopped" }
  | { type: "fail"; message: string }
  | { type: "limited"; seconds: number; message: string };

function freshNodes(): NodesState {
  return Object.fromEntries(AGENT_NODES.map((n) => [n, { status: "waiting" }])) as NodesState;
}

export const initialAskState: AskState = {
  phase: "idle",
  question: "",
  nodes: freshNodes(),
  answer: "",
  citations: null,
  done: null,
  resetReason: null,
  error: null,
  retryAfterSeconds: null,
};

/** Nodes that never ran are shown as skipped once the run is over. */
function settle(nodes: NodesState): NodesState {
  const next = { ...nodes };
  for (const n of AGENT_NODES) if (next[n].status !== "done") next[n] = { status: "skipped" };
  return next;
}

function reducer(state: AskState, action: Action): AskState {
  switch (action.type) {
    case "begin":
      return { ...initialAskState, nodes: freshNodes(), phase: "streaming", question: action.question };
    case "stopped":
      return state.phase === "streaming" ? { ...state, phase: "stopped", nodes: settle(state.nodes) } : state;
    case "fail":
      return { ...state, phase: "error", error: action.message, nodes: settle(state.nodes) };
    case "limited":
      return { ...state, phase: "limited", error: action.message, retryAfterSeconds: action.seconds, nodes: settle(state.nodes) };
    case "end":
      return state.phase === "streaming"
        ? { ...state, phase: "error", error: "The answer stopped early. Try again.", nodes: settle(state.nodes) }
        : state;
    case "event": {
      if (state.phase !== "streaming") return state;
      const e = action.event;
      switch (e.type) {
        case "node_start":
          return { ...state, nodes: { ...state.nodes, [e.node]: { status: "running" } } };
        case "node_end":
          return { ...state, nodes: { ...state.nodes, [e.node]: { status: "done", ms: e.ms, summary: e.summary } } };
        case "token":
          return { ...state, answer: state.answer + e.text };
        case "reset":
          return { ...state, answer: "", resetReason: e.reason };
        case "citations":
          return { ...state, citations: e.items };
        case "done":
          return { ...state, phase: "done", done: e, nodes: settle(state.nodes) };
        case "error":
          return { ...state, phase: "error", error: e.message, nodes: settle(state.nodes) };
        default:
          return state;
      }
    }
  }
}

function parseLine(line: string): AgentEvent | null {
  try {
    const v: unknown = JSON.parse(line);
    if (v && typeof v === "object" && typeof (v as { type?: unknown }).type === "string") return v as AgentEvent;
  } catch {
    // Ignore a malformed line rather than failing the whole answer.
  }
  return null;
}

/** POSTs a question to /api/ask and folds the NDJSON event stream into state. */
export function useAskStream(endpoint = "/api/ask") {
  const [state, dispatch] = useReducer(reducer, initialAskState);
  const controller = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (question: string) => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      dispatch({ type: "begin", question });
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
          signal: ac.signal,
        });
        if (res.status === 429) {
          const body = (await res.json().catch(() => null)) as Partial<RateLimitedBody> | null;
          const seconds = body?.retryAfterSeconds ?? (Number(res.headers.get("Retry-After")) || 60);
          dispatch({ type: "limited", seconds, message: body?.error ?? `Too many questions. Try again in ${seconds} seconds.` });
          return;
        }
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          dispatch({ type: "fail", message: body?.error ?? `The agent answered with HTTP ${res.status}. Try again.` });
          return;
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          let nl = buffer.indexOf("\n");
          while (nl >= 0) {
            const event = parseLine(buffer.slice(0, nl).trim());
            buffer = buffer.slice(nl + 1);
            if (event) dispatch({ type: "event", event });
            nl = buffer.indexOf("\n");
          }
        }
        const tail = parseLine(buffer.trim());
        if (tail) dispatch({ type: "event", event: tail });
        dispatch({ type: "end" });
      } catch {
        if (ac.signal.aborted) return; // stop() or a newer question already updated state
        dispatch({ type: "fail", message: "Couldn't reach the agent. Check your connection and try again." });
      } finally {
        if (controller.current === ac) controller.current = null;
      }
    },
    [endpoint],
  );

  const stop = useCallback(() => {
    if (!controller.current) return false;
    controller.current.abort();
    controller.current = null;
    dispatch({ type: "stopped" });
    return true;
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  return { state, ask, stop };
}
