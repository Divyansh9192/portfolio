"use client";

import { useMemo, useState, type ReactNode } from "react";
import { SystemDiagram } from "@/components/system/SystemDiagram";
import type { SystemGraph } from "@/content/types";
import { cn } from "@/lib/cn";
import { NODE_KIND_LABEL, edgesTouching, protocolSummary } from "./case-utils";
import { ProtocolSwatch } from "./ProtocolSwatch";

type Selection = { type: "node"; id: string } | { type: "edge"; index: number } | null;

/**
 * The full interactive system diagram plus two tables generated from the same graph:
 * Components (nodes) and Connections (edges). Selecting a component or connection in a
 * table, or clicking a box in the diagram, highlights it in both places.
 */
export function ArchitectureExplorer({ graph, title }: { graph: SystemGraph; title: string }) {
  const [sel, setSel] = useState<Selection>(null);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const selectedNode = sel?.type === "node" ? sel.id : null;
  const selectedEdge = sel?.type === "edge" ? sel.index : null;
  const touching = useMemo(() => new Set(selectedNode ? edgesTouching(graph, selectedNode) : []), [graph, selectedNode]);

  const highlight = useMemo(() => {
    if (sel?.type === "node") return [sel.id];
    if (sel?.type === "edge") {
      const e = graph.edges[sel.index];
      return e ? [e.from, e.to] : undefined;
    }
    return undefined;
  }, [sel, graph.edges]);

  const name = (id: string) => byId.get(id)?.label ?? id;

  let status = "Nothing selected. Pick a component or connection to highlight it in the diagram.";
  if (sel?.type === "node") {
    const n = touching.size;
    status = `Selected ${name(sel.id)}: ${n} ${n === 1 ? "connection" : "connections"}, marked in the table below.`;
  } else if (sel?.type === "edge") {
    const e = graph.edges[sel.index];
    if (e) status = `Selected connection ${name(e.from)} to ${name(e.to)} over ${protocolSummary(e.protocol).name}.`;
  }

  const toggleNode = (id: string) => setSel((s) => (s?.type === "node" && s.id === id ? null : { type: "node", id }));
  const toggleEdge = (index: number) => setSel((s) => (s?.type === "edge" && s.index === index ? null : { type: "edge", index }));

  return (
    <div data-arch="ArchitectureExplorer" data-arch-kind="client" className="flex flex-col gap-10">
      <div className="rounded-xl border border-line bg-surface p-3 sm:p-5">
        <SystemDiagram graph={graph} size="full" title={title} highlight={highlight} onNodeSelect={toggleNode} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3" data-print="hide">
          <p aria-live="polite" className="font-mono text-[12px] text-text-3">
            {status}
          </p>
          {sel ? (
            <button
              type="button"
              onClick={() => setSel(null)}
              className="min-h-10 rounded-md px-2.5 font-mono text-[12px] text-text-2 underline decoration-line-strong underline-offset-4 hover:text-text"
            >
              Clear selection
            </button>
          ) : null}
        </div>
      </div>

      <TableBlock caption="Components" note={`${graph.nodes.length} components, generated from the same data as the diagram.`}>
        <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
          <caption className="sr-only">Components: name, kind, technology and responsibility</caption>
          <thead>
            <tr className="border-b border-line-strong font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">
              <th scope="col" className="py-2 pl-2 pr-4 font-normal">Component</th>
              <th scope="col" className="py-2 pr-4 font-normal">Kind</th>
              <th scope="col" className="py-2 pr-4 font-normal">Technology</th>
              <th scope="col" className="py-2 font-normal">Responsibility</th>
            </tr>
          </thead>
          <tbody>
            {graph.nodes.map((n) => {
              const on = selectedNode === n.id || (highlight?.includes(n.id) ?? false);
              return (
                <tr key={n.id} className={cn("border-b border-line align-baseline transition-colors", on && "bg-surface-2")}>
                  <th scope="row" className="py-1.5 pr-4 font-normal">
                    <button
                      type="button"
                      aria-pressed={selectedNode === n.id}
                      onClick={() => toggleNode(n.id)}
                      className={cn(
                        "inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-left font-mono text-[13px] hover:bg-surface-2",
                        on ? "text-text underline decoration-text-2 underline-offset-4" : "text-text",
                      )}
                    >
                      {n.label}
                      <span className="sr-only">, highlight in diagram</span>
                    </button>
                  </th>
                  <td className="py-2.5 pr-4 text-text-2">{NODE_KIND_LABEL[n.kind]}</td>
                  <td className="py-2.5 pr-4 text-text-2">{n.tech}</td>
                  <td className="py-2.5 text-text-2">{n.note ?? <span className="text-text-3">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableBlock>

      <TableBlock caption="Connections" note="Solid line: synchronous call. Dashed: message. Dotted: data store.">
        <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
          <caption className="sr-only">Connections: from, to, protocol and what flows over each</caption>
          <thead>
            <tr className="border-b border-line-strong font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">
              <th scope="col" className="py-2 pl-2 pr-4 font-normal">From → to</th>
              <th scope="col" className="py-2 pr-4 font-normal">Protocol</th>
              <th scope="col" className="py-2 font-normal">What flows</th>
            </tr>
          </thead>
          <tbody>
            {graph.edges.map((e, i) => {
              const p = protocolSummary(e.protocol);
              const on = selectedEdge === i || touching.has(i);
              const dim = sel !== null && !on;
              return (
                <tr key={`${e.from}-${e.to}-${i}`} className={cn("border-b border-line align-baseline transition-colors", on && "bg-surface-2", dim && "text-text-3")}>
                  <th scope="row" className="py-1.5 pr-4 font-normal">
                    <button
                      type="button"
                      aria-pressed={selectedEdge === i}
                      onClick={() => toggleEdge(i)}
                      className={cn(
                        "inline-flex min-h-10 flex-wrap items-center gap-x-1.5 rounded-md px-2 text-left font-mono text-[13px] hover:bg-surface-2",
                        dim ? "text-text-3" : "text-text",
                        selectedEdge === i && "underline decoration-text-2 underline-offset-4",
                      )}
                    >
                      <span>{name(e.from)}</span>
                      <span aria-hidden className="text-text-3">→</span>
                      <span className="sr-only"> to </span>
                      <span>{name(e.to)}</span>
                      <span className="sr-only">, highlight in diagram</span>
                    </button>
                  </th>
                  <td className="py-2.5 pr-4">
                    <span className={cn("inline-flex items-center gap-2 whitespace-nowrap", dim ? "text-text-3" : "text-text-2")}>
                      <ProtocolSwatch cls={p.cls} />
                      {p.name}
                      <span className="font-mono text-[11.5px] text-text-3">{p.clsLabel}</span>
                    </span>
                  </td>
                  <td className={cn("py-2.5 font-mono text-[12.5px]", dim ? "text-text-3" : "text-text-2")}>{e.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableBlock>
    </div>
  );
}

function TableBlock({ caption, note, children }: { caption: string; note: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-[1.25rem] font-bold tracking-[-0.01em] text-text [font-stretch:112%]">{caption}</h3>
        <p className="font-mono text-[11.5px] text-text-3">{note}</p>
      </div>
      {/* Scrolls inside its own container on narrow screens; focusable so keyboard users can scroll it. */}
      <div role="region" aria-label={`${caption} table`} tabIndex={0} className="-mx-2 overflow-x-auto rounded-sm px-2 pb-2">
        {children}
      </div>
    </div>
  );
}
