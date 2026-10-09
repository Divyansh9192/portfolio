"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { layoutGraph } from "@/lib/graph/layout";
import { protocolClass, type NodeKind, type ProtocolClass, type SystemGraph } from "@/content/types";

const KIND_LABEL: Record<NodeKind, string> = {
  client: "client",
  gateway: "gateway",
  service: "service",
  worker: "worker",
  broker: "broker",
  db: "database",
  cache: "cache",
  index: "index",
  model: "model",
  external: "external",
  ui: "frontend",
};

const EDGE_STYLE: Record<ProtocolClass, { stroke: string; dash?: string }> = {
  sync: { stroke: "var(--sync)" },
  async: { stroke: "var(--async)", dash: "6 5" },
  data: { stroke: "var(--text-3)", dash: "1.5 4" },
};

export interface SystemDiagramProps {
  graph: SystemGraph;
  /** "mini" hides edge labels and tech lines; "full" shows everything and a legend. */
  size?: "mini" | "full";
  /** Accessible name, e.g. "Orchrez architecture". */
  title: string;
  className?: string;
  /** Highlight these node ids (e.g. from an external control). */
  highlight?: string[];
  /** Called when a node is activated (click / Enter). */
  onNodeSelect?: (id: string) => void;
}

/**
 * Architecture diagram drawn from content (nodes + edges), laid out automatically.
 * Hover or focus a node to trace its connections. Edge style encodes protocol class:
 * solid = synchronous call, dashed = message, dotted = data store.
 */
export function SystemDiagram({ graph, size = "full", title, className, highlight, onNodeSelect }: SystemDiagramProps) {
  const uid = useId().replace(/:/g, "");
  const mini = size === "mini";
  const layout = useMemo(
    () =>
      layoutGraph(
        graph.nodes.map((n) => ({ id: n.id, label: n.label, sublabel: mini ? undefined : n.tech })),
        graph.edges,
        mini ? { colGap: 40, rowGap: 12, nodeHeight: 30, minWidth: 74, maxWidth: 150, charWidth: 6.6, padding: 6 } : { colGap: 84, rowGap: 22 },
      ),
    [graph, mini],
  );
  const [active, setActive] = useState<string | null>(null);
  const focusSet = useMemo(() => {
    const ids = new Set<string>(highlight ?? []);
    if (active) {
      ids.add(active);
      graph.edges.forEach((e) => {
        if (e.from === active) ids.add(e.to);
        if (e.to === active) ids.add(e.from);
      });
    }
    return ids;
  }, [active, graph.edges, highlight]);
  const dimming = focusSet.size > 0;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  return (
    <figure data-arch="SystemDiagram" data-arch-kind="client" className={cn("flex flex-col gap-3", className)}>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          role="group"
          aria-label={title}
          className={cn("block h-auto max-w-none", mini ? "w-full min-w-[420px]" : "w-full min-w-[640px]")}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <defs>
            {(["sync", "async", "data"] as const).map((cls) => (
              <marker key={cls} id={`${uid}-arrow-${cls}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={EDGE_STYLE[cls].stroke} />
              </marker>
            ))}
          </defs>

          <g>
            {layout.edges.map((e) => {
              const src = graph.edges[e.index];
              const cls = protocolClass[src.protocol];
              const style = EDGE_STYLE[cls];
              const on = !dimming || (active ? e.from === active || e.to === active : focusSet.has(e.from) && focusSet.has(e.to));
              return (
                <g key={`${e.from}-${e.to}-${e.index}`} opacity={on ? 1 : 0.18} style={{ transition: "opacity 160ms" }}>
                  <path
                    d={e.d}
                    fill="none"
                    stroke={style.stroke}
                    strokeWidth={mini ? 1.25 : 1.5}
                    strokeDasharray={style.dash}
                    markerEnd={`url(#${uid}-arrow-${cls})`}
                  >
                    <title>{`${nodeById.get(src.from)?.label} → ${nodeById.get(src.to)?.label} · ${src.protocol}: ${src.label}`}</title>
                  </path>
                  {!mini && on && dimming ? (
                    <text x={e.mid.x} y={e.mid.y - 6} textAnchor="middle" fontSize={10.5} fill="var(--text-2)" style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 4 }}>
                      {src.protocol} · {src.label.length > 34 ? src.label.slice(0, 33) + "…" : src.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>

          <g>
            {layout.nodes.map((p) => {
              const n = nodeById.get(p.id)!;
              const on = !dimming || focusSet.has(p.id);
              const isActive = active === p.id || highlight?.includes(p.id);
              const dashed = n.kind === "external";
              return (
                <g
                  key={p.id}
                  transform={`translate(${p.x},${p.y})`}
                  opacity={on ? 1 : 0.35}
                  style={{ transition: "opacity 160ms", cursor: onNodeSelect ? "pointer" : "default", outline: "none" }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${n.label}, ${KIND_LABEL[n.kind]}, ${n.tech}${n.note ? `. ${n.note}` : ""}`}
                  aria-pressed={isActive ? true : undefined}
                  onMouseEnter={() => setActive(p.id)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(p.id)}
                  onBlur={() => setActive(null)}
                  onClick={() => onNodeSelect?.(p.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onNodeSelect?.(p.id);
                    }
                  }}
                >
                  <rect
                    width={p.w}
                    height={p.h}
                    rx={n.kind === "db" || n.kind === "cache" || n.kind === "index" ? 10 : 6}
                    fill="var(--surface-2)"
                    stroke={isActive ? "var(--text)" : "var(--line-strong)"}
                    strokeWidth={isActive ? 1.5 : 1}
                    strokeDasharray={dashed ? "4 3" : undefined}
                  />
                  {n.kind === "broker" ? <rect x={3} y={3} width={p.w - 6} height={p.h - 6} rx={4} fill="none" stroke="var(--line-strong)" /> : null}
                  {mini ? (
                    <text x={p.w / 2} y={p.h / 2 + 4} textAnchor="middle" fontSize={11} fill="var(--text)">
                      {n.label}
                    </text>
                  ) : (
                    <>
                      <text x={10} y={16} fontSize={9.5} letterSpacing="0.08em" fill="var(--text-3)">
                        {KIND_LABEL[n.kind].toUpperCase()}
                      </text>
                      <text x={10} y={33} fontSize={12.5} fill="var(--text)">
                        {n.label.length > 24 ? n.label.slice(0, 23) + "…" : n.label}
                      </text>
                    </>
                  )}
                  <title>{`${n.label} · ${n.tech}${n.note ? ` · ${n.note}` : ""}`}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {!mini ? (
        <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11.5px] text-text-3">
          <LegendSwatch cls="sync" label="Synchronous call (HTTP, Feign, LLM)" />
          <LegendSwatch cls="async" label="Message (Kafka, AMQP, webhook, SSE)" />
          <LegendSwatch cls="data" label="Data store access" />
          <span className="text-text-3">Hover or focus a box to trace it.</span>
        </figcaption>
      ) : null}
    </figure>
  );
}

function LegendSwatch({ cls, label }: { cls: ProtocolClass; label: string }) {
  const s = EDGE_STYLE[cls];
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="28" height="8" aria-hidden>
        <line x1="1" y1="4" x2="27" y2="4" stroke={s.stroke} strokeWidth="2" strokeDasharray={s.dash} />
      </svg>
      {label}
    </span>
  );
}
