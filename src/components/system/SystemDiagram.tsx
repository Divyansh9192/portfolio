"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { DIAGRAM_LAYOUT } from "@/lib/graph/diagram-layout";
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
        mini ? DIAGRAM_LAYOUT.mini : DIAGRAM_LAYOUT.full,
      ),
    [graph, mini],
  );
  const [active, setActive] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolls = useOverflowX(scrollRef);
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
  const edgeLabels = !mini && dimming ? placeEdgeLabels(layout.edges, graph, active, focusSet) : [];

  return (
    <figure data-arch="SystemDiagram" data-arch-kind="client" className={cn("flex flex-col gap-3", className)}>
      <div
        ref={scrollRef}
        className="overflow-x-auto"
        // A picture wider than the screen needs a keyboard stop so it can be scrolled (full diagrams scroll as nodes take focus).
        {...(mini && scrolls ? { tabIndex: 0, role: "group", "aria-label": `${title} (scrolls sideways)` } : {})}
      >
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          role={mini ? "img" : "group"}
          aria-label={mini ? `${title}: ${graph.nodes.map((n) => n.label).join(", ")}` : title}
          aria-describedby={mini ? `${uid}-edges` : undefined}
          className={cn("block h-auto max-w-none w-full", mini && "min-w-[420px]")}
          // Full diagrams never shrink below 80% (labels stay ≥ 10px); wider ones scroll inside the box.
          style={{ fontFamily: "var(--font-mono)", ...(mini ? {} : { minWidth: Math.round(layout.width * 0.8) }) }}
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
                </g>
              );
            })}
          </g>

          <g>
            {layout.nodes.map((p) => {
              const n = nodeById.get(p.id)!;
              const on = !dimming || focusSet.has(p.id);
              const isSelected = Boolean(highlight?.includes(p.id));
              const isHot = active === p.id || isSelected;
              const dashed = n.kind === "external";
              return (
                <g
                  key={p.id}
                  transform={`translate(${p.x},${p.y})`}
                  opacity={on ? 1 : 0.35}
                  style={{ transition: "opacity 160ms", cursor: onNodeSelect ? "pointer" : "default", outline: "none" }}
                  // Mini diagrams are pictures (one accessible name on the <svg>); only full diagrams are explorable by keyboard.
                  tabIndex={mini ? undefined : 0}
                  role={mini ? undefined : "button"}
                  aria-label={mini ? undefined : `${n.label}, ${KIND_LABEL[n.kind]}, ${n.tech}${n.note ? `. ${n.note}` : ""}`}
                  aria-pressed={!mini && onNodeSelect ? isSelected : undefined}
                  onMouseEnter={() => setActive(p.id)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={(ev) => {
                    setActive(p.id);
                    // The ring is for keyboard focus; a mouse click selects without it.
                    if (ev.currentTarget.matches(":focus-visible")) setFocused(p.id);
                  }}
                  onBlur={() => {
                    setActive(null);
                    setFocused(null);
                  }}
                  onClick={() => onNodeSelect?.(p.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onNodeSelect?.(p.id);
                    }
                  }}
                >
                  {focused === p.id ? (
                    <rect x={-4} y={-4} width={p.w + 8} height={p.h + 8} rx={9} fill="none" stroke="var(--focus)" strokeWidth={2} />
                  ) : null}
                  <rect
                    width={p.w}
                    height={p.h}
                    rx={n.kind === "db" || n.kind === "cache" || n.kind === "index" ? 10 : 6}
                    fill={isSelected ? "var(--surface)" : "var(--surface-2)"}
                    stroke={isHot ? "var(--text)" : "var(--line-strong)"}
                    strokeWidth={isSelected ? 2 : isHot ? 1.5 : 1}
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
          {/* Labels for the traced edges, drawn last so boxes never cover them. */}
          {edgeLabels.length ? (
            <g aria-hidden="true">
              {edgeLabels.map((l) => (
                <g key={l.key}>
                  <rect x={l.x - l.w / 2} y={l.y - 11} width={l.w} height={15} rx={3} fill="var(--surface)" stroke="var(--line)" />
                  <text x={l.x} y={l.y} textAnchor="middle" fontSize={10.5} fill="var(--text-2)">
                    {l.text}
                  </text>
                </g>
              ))}
            </g>
          ) : null}
        </svg>
      </div>
      {mini ? (
        <p id={`${uid}-edges`} className="sr-only">
          {`Connections: ${graph.edges
            .map((e) => `${nodeById.get(e.from)?.label} to ${nodeById.get(e.to)?.label} (${e.protocol}${e.label ? `, ${e.label}` : ""})`)
            .join("; ")}.`}
        </p>
      ) : null}
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

/** True while the element is narrower than its content, so it scrolls sideways. */
function useOverflowX(ref: React.RefObject<HTMLElement | null>): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOver(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return over;
}

/** Positions labels for the traced edges, nudging any that would sit on top of each other. */
function placeEdgeLabels(
  edges: { from: string; to: string; index: number; mid: { x: number; y: number } }[],
  graph: SystemGraph,
  active: string | null,
  focusSet: Set<string>,
): { key: string; x: number; y: number; w: number; text: string }[] {
  const labels = edges
    .filter((e) => (active ? e.from === active || e.to === active : focusSet.has(e.from) && focusSet.has(e.to)))
    .map((e) => {
      const src = graph.edges[e.index];
      const name = src.label.length > 34 ? `${src.label.slice(0, 33)}…` : src.label;
      const text = `${src.protocol} · ${name}`;
      return { key: `${e.from}-${e.to}-${e.index}`, x: e.mid.x, y: e.mid.y - 4, w: Math.round(text.length * 6.3 + 10), text };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: typeof labels = [];
  for (const l of labels) {
    let y = l.y;
    for (const p of placed) {
      if (Math.abs(p.x - l.x) < (p.w + l.w) / 2 + 4 && Math.abs(p.y - y) < 17) y = p.y + 17;
    }
    placed.push({ ...l, y });
  }
  return placed;
}
