"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AGENT_NODES, type AgentNode, type FallbackReason, type NodeSummaries } from "@/lib/agent/types";
import type { NodeState, NodesState } from "./useAskStream";

const NODE_ROLE: Record<AgentNode, string> = {
  guard: "Sanitise, cap at 500 chars, flag injection, redirect off-topic",
  plan: "Classify intent with keyword rules, pick retrieval depth",
  retrieve: "BM25 over the site's content, boosted by the plan",
  rerank: "Drop weak or empty chunks, one per section, keep five",
  compose: "Claude with a grounding prompt, or quoted sentences",
  cite: "Keep only citations that point into the context",
};

export const FALLBACK_SHORT: Record<FallbackReason, string> = {
  no_key: "no LLM key configured",
  spend_cap: "daily LLM budget used up",
  llm_error: "Claude call failed",
  timeout: "Claude timed out",
  refusal: "Claude declined",
  empty_output: "Claude returned no text",
};

export function formatMs(ms: number) {
  return ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** One line per node, written for a person scanning the trace. */
function oneLine<N extends AgentNode>(node: N, s: NodeSummaries[N]): string {
  switch (node) {
    case "guard": {
      const g = s as NodeSummaries["guard"];
      if (g.reason === "empty") return "empty, rejected";
      if (g.reason === "off_topic") return "off-topic, redirected";
      const parts = [`${g.chars} chars`];
      if (g.truncated) parts.push("cut to 500");
      parts.push(g.injectionSuspected ? "injection pattern flagged, not followed" : "clean");
      return parts.join(" · ");
    }
    case "plan": {
      const p = s as NodeSummaries["plan"];
      return [`intent ${p.intent}`, ...(p.projects.length ? [p.projects.join(", ")] : []), `k=${p.k}`].join(" · ");
    }
    case "retrieve": {
      const r = s as NodeSummaries["retrieve"];
      return r.hits.length ? `${plural(r.hits.length, "doc")} · top ${r.hits[0].score.toFixed(2)}` : "no matches";
    }
    case "rerank": {
      const r = s as NodeSummaries["rerank"];
      return `${r.context.length} kept · ${r.dropped.length} dropped`;
    }
    case "compose": {
      const c = s as NodeSummaries["compose"];
      if (c.mode === "llm") return ["Claude", ...(c.outputTokens ? [`${c.outputTokens} tokens out`] : []), ...(c.truncated ? ["hit max tokens"] : [])].join(" · ");
      if (!c.sentences) return "nothing relevant, no LLM call";
      return [`${plural(c.sentences, "sentence")} quoted`, ...(c.fallback ? [FALLBACK_SHORT[c.fallback]] : [])].join(" · ");
    }
    case "cite": {
      const c = s as NodeSummaries["cite"];
      const parts = [plural(c.cited, "source")];
      if (c.dropped) parts.push(`${c.dropped} invented id${c.dropped === 1 ? "" : "s"} dropped`);
      if (c.unverifiedNumbers.length) parts.push(`${plural(c.unverifiedNumbers.length, "number")} not in sources`);
      if (!c.grounded) parts.push("uncited");
      return parts.join(" · ");
    }
  }
  return "";
}

/** Health of a finished node: degraded when it fell back or grounding was imperfect. */
function degraded<N extends AgentNode>(node: N, s: NodeSummaries[N]): boolean {
  if (node === "compose") {
    const c = s as NodeSummaries["compose"];
    return !!c.fallback && c.fallback !== "no_key";
  }
  if (node === "cite") {
    const c = s as NodeSummaries["cite"];
    return c.dropped > 0 || c.unverifiedNumbers.length > 0 || !c.grounded;
  }
  return false;
}

function Dl({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-text-3">{k}</dt>
          <dd className="min-w-0 break-words text-text-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <code className="font-mono text-[11.5px] text-text-2">{children}</code>;

function Details<N extends AgentNode>({ node, s }: { node: N; s: NodeSummaries[N] }) {
  switch (node) {
    case "guard": {
      const g = s as NodeSummaries["guard"];
      return (
        <Dl
          rows={[
            ["length", <span key="l" className="tnum">{g.chars} chars{g.truncated ? " (truncated)" : ""}</span>],
            ["injection", g.injectionSuspected ? g.injectionPatterns.join(", ") : "none found"],
            ["on topic", g.offTopic ? "no, redirected without an LLM call" : g.reason === "empty" ? "n/a" : "yes"],
          ]}
        />
      );
    }
    case "plan": {
      const p = s as NodeSummaries["plan"];
      return (
        <Dl
          rows={[
            ["intent", p.intent],
            ["signals", p.signals.length ? p.signals.join(", ") : "none (general)"],
            ["projects", p.projects.length ? p.projects.join(", ") : "none named"],
            ["k", <span key="k" className="tnum">{p.k}</span>],
            ["query", p.query ? <Mono key="q">{p.query}</Mono> : "(empty, anchors only)"],
          ]}
        />
      );
    }
    case "retrieve": {
      const r = s as NodeSummaries["retrieve"];
      if (!r.hits.length) return <p className="text-text-3">BM25 found nothing for this query.</p>;
      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[17rem] border-collapse text-left">
            <thead>
              <tr className="text-text-3">
                <th scope="col" className="py-0.5 pr-3 font-normal">doc</th>
                <th scope="col" className="py-0.5 pr-2 text-right font-normal">score</th>
                <th scope="col" className="py-0.5 text-right font-normal">boost</th>
              </tr>
            </thead>
            <tbody>
              {r.hits.map((h) => (
                <tr key={h.id} className="border-t border-line align-top">
                  <td className="py-1 pr-3">
                    <Mono>{h.id}</Mono>
                    <span className="block text-text-3">{h.title}</span>
                  </td>
                  <td className="tnum py-1 pr-2 text-right text-text-2">{h.score.toFixed(2)}</td>
                  <td className="tnum py-1 text-right text-text-3">{h.injected ? "anchor" : h.boost === 1 ? "·" : `×${h.boost}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "rerank": {
      const r = s as NodeSummaries["rerank"];
      return (
        <div className="flex flex-col gap-2">
          <div>
            <p className="text-text-3">context, in rank order</p>
            <ol className="mt-1 flex flex-col gap-0.5">
              {r.context.map((id, i) => (
                <li key={id} className="flex gap-2">
                  <span className="tnum text-text-3">{i + 1}</span>
                  <Mono>{id}</Mono>
                </li>
              ))}
            </ol>
          </div>
          {r.dropped.length ? (
            <div>
              <p className="text-text-3">dropped</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {r.dropped.map((d) => (
                  <li key={d.id} className="flex flex-wrap gap-x-2">
                    <Mono>{d.id}</Mono>
                    <span className="text-text-3">{d.reason.replace("_", " ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );
    }
    case "compose": {
      const c = s as NodeSummaries["compose"];
      return (
        <Dl
          rows={[
            ["mode", c.mode === "llm" ? "LLM (grounded prompt, context chunks only)" : "extractive (sentences quoted from the context)"],
            ...(c.model ? ([["model", <Mono key="m">{c.model}</Mono>]] as [string, ReactNode][]) : []),
            ...(c.fallback ? ([["why", FALLBACK_SHORT[c.fallback]]] as [string, ReactNode][]) : []),
            ...(c.outputTokens !== undefined ? ([["tokens out", <span key="t" className="tnum">{c.outputTokens}</span>]] as [string, ReactNode][]) : []),
            ...(c.sentences !== undefined ? ([["sentences", <span key="s" className="tnum">{c.sentences}</span>]] as [string, ReactNode][]) : []),
          ]}
        />
      );
    }
    case "cite": {
      const c = s as NodeSummaries["cite"];
      return (
        <Dl
          rows={[
            ["cited", <span key="c" className="tnum">{c.cited}</span>],
            ["dropped", c.droppedIds.length ? c.droppedIds.map((id) => <Mono key={id}>{id} </Mono>) : "none"],
            ["numbers", c.unverifiedNumbers.length ? `not found in sources: ${c.unverifiedNumbers.join(", ")}` : "all found in sources"],
            ["grounded", c.grounded ? "yes" : "no citations"],
          ]}
        />
      );
    }
  }
  return null;
}

function Led({ state, isDegraded, pulse }: { state: NodeState; isDegraded: boolean; pulse: boolean }) {
  if (state.status === "waiting" || state.status === "skipped") {
    return <span aria-hidden className="inline-block size-[7px] shrink-0 rounded-full border border-text-3" />;
  }
  if (state.status === "running") return <span aria-hidden className="led shrink-0 text-text" data-pulse={pulse ? "true" : "false"} />;
  return <span aria-hidden className={cn("led shrink-0", isDegraded ? "text-warn" : "text-ok")} />;
}

function StatusText({ state }: { state: NodeState }) {
  switch (state.status) {
    case "done":
      return <span className="tnum text-text-2">{formatMs(state.ms ?? 0)} ms</span>;
    case "running":
      return <span className="text-text">running</span>;
    case "skipped":
      return <span className="text-text-3">skipped</span>;
    default:
      return (
        <span className="text-text-3">
          <span aria-hidden>·</span>
          <span className="sr-only">waiting</span>
        </span>
      );
  }
}

/** The pipeline as a vertical list of nodes that light up as the server reports them. */
export function AgentTrace({ nodes, motionOK, idle }: { nodes: NodesState; motionOK: boolean; idle: boolean }) {
  return (
    <ol className="flex flex-col divide-y divide-line rounded-lg border border-line bg-bg-raised font-mono text-[12px]">
      {AGENT_NODES.map((name, i) => {
        const state = nodes[name] as NodeState;
        const summary = state.summary;
        const isDegraded = summary ? degraded(name, summary) : false;
        const row = (
          <>
            <span className="tnum w-4 shrink-0 text-text-3">{i + 1}</span>
            <Led state={state} isDegraded={isDegraded} pulse={motionOK} />
            <span className={cn("w-[4.6rem] shrink-0", state.status === "waiting" || state.status === "skipped" ? "text-text-3" : "text-text")}>{name}</span>
            <span className="min-w-0 flex-1 truncate text-text-3">
              {summary ? oneLine(name, summary) : idle ? NODE_ROLE[name] : ""}
            </span>
            <span className="shrink-0 text-right">
              <StatusText state={state} />
            </span>
          </>
        );
        return (
          <li key={name}>
            {summary ? (
              <details className="group">
                <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2.5 px-3 py-2 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                  {row}
                  <ChevronRight aria-hidden className="size-3.5 shrink-0 text-text-3 transition-transform group-open:rotate-90" />
                </summary>
                <div className="border-t border-line px-3 py-2.5 font-sans text-[12.5px] leading-relaxed sm:pl-[2.6rem]">
                  <p className="mb-2 font-mono text-[11px] text-text-3">{NODE_ROLE[name]}</p>
                  <Details node={name} s={summary} />
                </div>
              </details>
            ) : (
              <div className="flex min-h-10 items-center gap-2.5 px-3 py-2" title={NODE_ROLE[name]}>
                {row}
                <span aria-hidden className="size-3.5 shrink-0" />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
