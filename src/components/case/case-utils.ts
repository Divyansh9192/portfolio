/**
 * Pure helpers for the case-study page and its social card.
 * Framework-free and deterministic so they can be unit-tested and used on the server,
 * in client islands and inside the Satori (next/og) renderer alike.
 */
import { layoutGraph } from "@/lib/graph/layout";
import { protocolClass, type LabRef, type NodeKind, type Project, type Protocol, type ProtocolClass, type SystemGraph } from "@/content/types";

/* ------------------------------------------------------------------ */
/* Document outline                                                    */
/* ------------------------------------------------------------------ */

export interface TocItem {
  id: string;
  label: string;
  /** Section number; the order of a design doc is meaningful, so it is shown as §n. */
  n: number;
}

/** The case study's numbered sections, in reading order. Ids are stable deep-link anchors. */
export const CASE_SECTIONS: readonly TocItem[] = [
  { id: "problem", label: "Problem", n: 1 },
  { id: "constraints", label: "Constraints", n: 2 },
  { id: "architecture", label: "Architecture", n: 3 },
  { id: "decisions", label: "Decisions", n: 4 },
  { id: "lab", label: "Try it", n: 5 },
  { id: "result", label: "Result", n: 6 },
  { id: "next", label: "What I'd do next", n: 7 },
  { id: "evidence", label: "Evidence", n: 8 },
];

export function sectionById(id: string): TocItem {
  const s = CASE_SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown case-study section: ${id}`);
  return s;
}

/**
 * Which ToC entry is current, given the ids of sections that intersect the reading band
 * (document order wins). Returns null when nothing is in the band and the reader is above
 * the first section; otherwise keeps the previous value (e.g. between two observer callbacks).
 */
export function pickActiveSection(order: readonly string[], visible: ReadonlySet<string>, previous: string | null, aboveFirst: boolean): string | null {
  for (const id of order) if (visible.has(id)) return id;
  if (aboveFirst) return null;
  return previous;
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const STATUS_LABEL: Record<Project["status"], string> = {
  live: "Live",
  complete: "Complete",
  "in-development": "In development",
};

export const LAB_KIND_LABEL: Record<LabRef["kind"], string> = {
  simulation: "Simulation",
  "in-browser": "In your browser",
};

export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  client: "Client",
  gateway: "Gateway",
  service: "Service",
  worker: "Worker",
  broker: "Broker",
  db: "Database",
  cache: "Cache",
  index: "Index",
  model: "Model",
  external: "External",
  ui: "Frontend",
};

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  http: "HTTP",
  feign: "Feign",
  grpc: "gRPC",
  kafka: "Kafka",
  amqp: "AMQP",
  webhook: "Webhook",
  sse: "SSE",
  sql: "SQL",
  cypher: "Cypher",
  vector: "Vector",
  redis: "Redis",
  llm: "LLM",
  other: "Direct call",
};

/** Words that go with the line style, so protocol class never relies on colour alone. */
export const PROTOCOL_CLASS_LABEL: Record<ProtocolClass, string> = {
  sync: "call",
  async: "message",
  data: "data",
};

export function protocolSummary(p: Protocol): { name: string; cls: ProtocolClass; clsLabel: string } {
  const cls = protocolClass[p];
  return { name: PROTOCOL_LABEL[p], cls, clsLabel: PROTOCOL_CLASS_LABEL[cls] };
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

export interface ParsedEvidence {
  /** Repo-relative file path. */
  path: string;
  /** Directory part including the trailing slash ("" for files at the root). */
  dir: string;
  /** File name. */
  file: string;
  /** "12" or "12-18", or null when the evidence has no line reference. */
  lines: string | null;
  /** "path:12-18" as shown to readers. */
  display: string;
}

/** Split a Fact.evidence like "backend/app/x.py:12-18" into display parts. Never throws. */
export function parseEvidence(evidence: string): ParsedEvidence {
  const m = evidence.trim().match(/^([^:\s]+)(?::(\d+)(?:-(\d+))?)?/);
  const path = m?.[1] ?? evidence.trim();
  const lines = m?.[2] ? (m[3] ? `${m[2]}-${m[3]}` : m[2]) : null;
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  return { path, dir, file, lines, display: lines ? `${path}:${lines}` : path };
}

/** "Divyansh9192/Orchrez" from "https://github.com/Divyansh9192/Orchrez". */
export function repoShortName(repoUrl: string): string {
  const m = repoUrl.match(/github\.com\/([^/]+\/[^/#?]+)/i);
  return m ? m[1].replace(/\.git$/, "") : repoUrl.replace(/^https?:\/\//, "");
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

/** Neighbours in display order. No wrap-around: the first has no previous, the last no next. */
export function adjacentProjects<T extends { slug: string }>(list: readonly T[], slug: string): { prev?: T; next?: T } {
  const i = list.findIndex((p) => p.slug === slug);
  if (i < 0) return {};
  return { prev: i > 0 ? list[i - 1] : undefined, next: i < list.length - 1 ? list[i + 1] : undefined };
}

/* ------------------------------------------------------------------ */
/* Graph helpers                                                       */
/* ------------------------------------------------------------------ */

/** Edge indices touching a node. */
export function edgesTouching(graph: SystemGraph, id: string): number[] {
  const out: number[] = [];
  graph.edges.forEach((e, i) => {
    if (e.from === id || e.to === id) out.push(i);
  });
  return out;
}

export interface StripNode {
  id: string;
  label: string;
  kind: NodeKind;
}

export interface StripColumn {
  nodes: StripNode[];
  /** Nodes in this layer that did not fit. */
  hidden: number;
}

/** Which kinds to keep first when a layer has to be trimmed for the social card. */
const KIND_PRIORITY: Record<NodeKind, number> = {
  gateway: 0,
  service: 1,
  broker: 2,
  worker: 3,
  model: 4,
  index: 5,
  ui: 6,
  client: 7,
  cache: 8,
  external: 9,
  db: 10,
};

/**
 * A simplified left-to-right "architecture strip": the graph's layers (from the same
 * layered layout the interactive diagram uses), at most `maxNodes` boxes in total and
 * `maxPerColumn` per layer. Every layer gets one box before any layer gets a second,
 * so the flow stays complete; trimmed layers report how many boxes they hide.
 */
export function archStrip(graph: SystemGraph, maxNodes = 8, maxPerColumn = 3): StripColumn[] {
  if (graph.nodes.length === 0 || maxNodes <= 0) return [];
  const layout = layoutGraph(
    graph.nodes.map((n) => ({ id: n.id, label: n.label })),
    graph.edges,
  );
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const layers = new Map<number, { id: string; order: number }[]>();
  for (const p of layout.nodes) {
    const list = layers.get(p.layer) ?? [];
    list.push({ id: p.id, order: p.order });
    layers.set(p.layer, list);
  }
  const keys = [...layers.keys()].sort((a, b) => a - b).slice(0, maxNodes);

  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  // Candidates per layer, best first: most connected, then kind priority, then layout order.
  const ranked = keys.map((k) =>
    [...layers.get(k)!].sort((a, b) => {
      const da = degree.get(a.id) ?? 0;
      const db = degree.get(b.id) ?? 0;
      const ka = KIND_PRIORITY[byId.get(a.id)!.kind];
      const kb = KIND_PRIORITY[byId.get(b.id)!.kind];
      return db - da || ka - kb || a.order - b.order;
    }),
  );
  const take = ranked.map(() => 0);
  let budget = maxNodes;
  for (let round = 0; round < maxPerColumn && budget > 0; round++) {
    for (let c = 0; c < ranked.length && budget > 0; c++) {
      if (take[c] < ranked[c].length && take[c] === round) {
        take[c]++;
        budget--;
      }
    }
  }

  return ranked.map((cands, c) => {
    const chosen = cands.slice(0, take[c]).sort((a, b) => a.order - b.order);
    return {
      nodes: chosen.map(({ id }) => {
        const n = byId.get(id)!;
        return { id, label: n.label, kind: n.kind };
      }),
      hidden: cands.length - take[c],
    };
  });
}
