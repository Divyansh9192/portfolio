import type { CSSProperties, ReactNode } from "react";
import { protocolClass, type EducationItem, type LabRef, type Project, type Protocol, type ProtocolClass, type SystemGraph } from "@/content";
import { DIAGRAM_LAYOUT, SystemDiagram } from "@/components/system/SystemDiagram";
import { layoutGraph } from "@/lib/graph/layout";
import type { Health } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

/** Project status → health colour + always-visible text label. */
export function projectStatus(status: Project["status"]): { health: Health; label: string } {
  switch (status) {
    case "live":
      return { health: "ok", label: "Live" };
    case "in-development":
      return { health: "warn", label: "In development" };
    default:
      return { health: "unknown", label: "Complete" };
  }
}

export const LAB_KIND_LABEL: Record<LabRef["kind"], string> = {
  simulation: "Simulation",
  "in-browser": "In your browser",
};

/** "B.Tech, Computer Science & Engineering" + "2023 – present (4th year)" → "B.Tech CSE, 4th year". */
export function shortDegree(e: EducationItem | undefined): string | null {
  if (!e) return null;
  const [level, field] = e.degree.split(",").map((s) => s.trim());
  const initials = field
    ? field
        .split(/\s+/)
        .filter((w) => /^[A-Z]/.test(w))
        .map((w) => w[0])
        .join("")
    : "";
  const year = e.period.match(/\((\d+(?:st|nd|rd|th) year)\)/i)?.[1];
  return [initials ? `${level} ${initials}` : level, year].filter(Boolean).join(", ");
}

/** Section rhythm: 64px mobile, 112px desktop, hairline on top. */
export function Section({
  id,
  labelledBy,
  arch,
  className,
  children,
}: {
  id?: string;
  labelledBy: string;
  arch: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      data-arch={arch}
      data-arch-kind="server"
      className={cn("border-t border-line py-16 lg:py-28", className)}
    >
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Edge legend (same semantics as SystemDiagram)                       */
/* ------------------------------------------------------------------ */

const EDGE_DASH: Record<ProtocolClass, string | undefined> = {
  sync: undefined,
  async: "6 5",
  data: "1.5 4",
};
const EDGE_STROKE: Record<ProtocolClass, string> = {
  sync: "var(--sync)",
  async: "var(--async)",
  data: "var(--text-3)",
};
const PROTOCOL_NAME: Record<Protocol, string> = {
  http: "HTTP",
  feign: "Feign",
  grpc: "gRPC",
  llm: "LLM",
  sse: "SSE",
  kafka: "Kafka",
  amqp: "AMQP",
  webhook: "webhooks",
  sql: "SQL",
  cypher: "Cypher",
  vector: "vector",
  redis: "Redis",
  other: "other",
};
const CLASS_WORDS: Record<ProtocolClass, { line: string; meaning: string }> = {
  sync: { line: "Solid", meaning: "synchronous call" },
  async: { line: "Dashed", meaning: "message" },
  data: { line: "Dotted", meaning: "data store access" },
};

function protocolsOf(cls: ProtocolClass): string {
  return (Object.keys(protocolClass) as Protocol[])
    .filter((p) => p !== "other" && protocolClass[p] === cls)
    .map((p) => PROTOCOL_NAME[p])
    .join(", ");
}

export function EdgeSwatch({ cls, width = 32 }: { cls: ProtocolClass; width?: number }) {
  return (
    <svg width={width} height="8" aria-hidden className="shrink-0">
      <line x1="1" y1="4" x2={width - 1} y2="4" stroke={EDGE_STROKE[cls]} strokeWidth="2" strokeDasharray={EDGE_DASH[cls]} />
    </svg>
  );
}

/** Legend for solid / dashed / dotted edges, with the protocols each covers (derived from content types). */
export function EdgeLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("grid gap-x-8 gap-y-3 sm:grid-cols-3", className)} aria-label="How to read the diagrams">
      {(["sync", "async", "data"] as const).map((cls) => (
        <li key={cls} className="flex items-start gap-3">
          <span className="pt-[7px]">
            <EdgeSwatch cls={cls} />
          </span>
          <span className="text-[13.5px] leading-snug text-text-2">
            <span className="text-text">
              {CLASS_WORDS[cls].line}: {CLASS_WORDS[cls].meaning}
            </span>
            <span className="block font-mono text-[11.5px] text-text-3">{protocolsOf(cls)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Mini diagram at a legible scale                                      */
/* ------------------------------------------------------------------ */


/**
 * SystemDiagram's SVG scales to fill its container. Mini graphs are up to ~980px wide, so in
 * a narrow column their labels would shrink to ~5px. This keeps the SVG at its natural width
 * (scrolling inside SystemDiagram's own overflow box) below lg, and lets it shrink to fit only
 * on wide screens, where the scale stays at roughly 0.75 or more.
 */
export function MiniDiagram({ graph, title, className }: { graph: SystemGraph; title: string; className?: string }) {
  const { width } = layoutGraph(
    graph.nodes.map((n) => ({ id: n.id, label: n.label })),
    graph.edges,
    DIAGRAM_LAYOUT.mini,
  );
  return (
    <div
      className={cn("min-w-0 [&_svg]:w-[var(--diagram-w)] [&_svg]:max-w-none lg:[&_svg]:max-w-full", className)}
      style={{ "--diagram-w": `${Math.ceil(width)}px` } as CSSProperties}
    >
      <SystemDiagram graph={graph} size="mini" title={title} />
    </div>
  );
}
