/**
 * Scene graph for the 3D live topology: pure, deterministic, framework-free.
 *
 * 1. `buildTopologyModel` turns content (`projects[].system`) into clusters, nodes and edges,
 *    plus a small "entry" cluster for the request that served this page
 *    (You → proxy.ts → this site, facts from docs/ARCHITECTURE.md).
 * 2. `placeTopology` lays each cluster out with the same layered layout the 2D diagrams use
 *    (src/lib/graph/layout.ts), maps layout x → world X and layout y → world Z, arranges the
 *    clusters on the ground plane, routes edges as lifted 3D curves and allocates packets.
 *
 * World units: 1 unit = 40 layout px. Y is up, the ground is y = 0, +Z points at the camera.
 */

import { layoutGraph } from "@/lib/graph/layout";
import { protocolClass, type NodeKind, type Project, type ProjectSlug, type Protocol, type ProtocolClass, type SystemGraph } from "@/content/types";
import { hashSeed, mulberry32, type Vec3 } from "./motion";

export type { Vec3 } from "./motion";

/** Edge styling class. "link" is the faint fan-out from this site to each case study (no packets). */
export type EdgeClass = ProtocolClass | "link";
export type NodeShape = "box" | "stadium";
/** internal: inside one system. cross: between clusters (the health probe). link: site → cluster base. */
export type EdgeKind = "internal" | "cross" | "link";

export const ENTRY_ID = "entry";

/**
 * The request that served this page. Facts from docs/ARCHITECTURE.md: proxy.ts stamps
 * x-request-id and Server-Timing; /api/health probes each live app, cached for 60 s.
 */
export const ENTRY_GRAPH: SystemGraph = {
  nodes: [
    { id: "you", label: "You", kind: "client", tech: "Your browser", note: "This page load started here" },
    { id: "proxy", label: "proxy.ts", kind: "gateway", tech: "Next.js proxy", note: "Adds x-request-id and Server-Timing to every response" },
    { id: "site", label: "this site", kind: "ui", tech: "Next.js 16, App Router", note: "Renders the case studies. /api/health checks live apps, cached 60 s" },
  ],
  edges: [
    { from: "you", to: "proxy", protocol: "http", label: "GET / (this page)" },
    { from: "proxy", to: "site", protocol: "other", label: "request + x-request-id" },
  ],
};

export interface TopoCluster {
  id: string;
  slug: ProjectSlug | null;
  name: string;
  tagline: string;
  /** Case-study route, null for the entry cluster. */
  href: string | null;
  status: Project["status"] | null;
  liveUrl: string | null;
  nodeIds: string[];
}

export interface TopoNode {
  /** Globally unique: `${clusterId}/${localId}`. */
  id: string;
  clusterId: string;
  localId: string;
  label: string;
  kind: NodeKind;
  tech: string;
  note?: string;
  href: string | null;
  /** True for the node that represents a live deployment (its health LED is driven by /api/health). */
  live: boolean;
}

export interface TopoEdge {
  id: string;
  /** Cluster of the source node. */
  clusterId: string;
  kind: EdgeKind;
  from: string;
  /** Node id, or for `link` edges the target cluster id. */
  to: string;
  protocol: Protocol | "link";
  cls: EdgeClass;
  label: string;
  /** Packets on this edge appear only when the client polls /api/health. */
  probe: boolean;
}

export interface IncidentRefs {
  clusterId: string | null;
  /** The synchronous call that turns red (LinkedIn: notification-service → connections-service, Feign). */
  slowEdgeId: string | null;
  /** The Kafka edge whose packets pile up (LinkedIn: Kafka → notification-service). */
  lagEdgeId: string | null;
}

export interface TopologyModel {
  clusters: TopoCluster[];
  nodes: TopoNode[];
  edges: TopoEdge[];
  liveNodeId: string | null;
  liveSlug: ProjectSlug | null;
  incident: IncidentRefs;
}

const nid = (clusterId: string, localId: string) => `${clusterId}/${localId}`;

/** The node that stands for a project's live deployment: matches the live host, else the first UI node. */
export function findLiveNode(project: Pick<Project, "links" | "system">): string | null {
  const live = project.links.live;
  if (!live) return null;
  let host = "";
  try {
    host = new URL(live).host;
  } catch {
    host = "";
  }
  const nodes = project.system.nodes;
  const byHost = host ? nodes.find((n) => `${n.note ?? ""} ${n.tech}`.includes(host)) : undefined;
  return (byHost ?? nodes.find((n) => n.kind === "ui") ?? nodes[0])?.id ?? null;
}

function edgesOf(clusterId: string, graph: SystemGraph): TopoEdge[] {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return graph.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e, i) => ({
      id: `${clusterId}/${e.from}->${e.to}#${i}`,
      clusterId,
      kind: "internal" as const,
      from: nid(clusterId, e.from),
      to: nid(clusterId, e.to),
      protocol: e.protocol,
      cls: protocolClass[e.protocol],
      label: e.label,
      probe: false,
    }));
}

/** Locate the LinkedIn-clone incident edges by content ids, degrading to null when they are missing. */
export function findIncidentEdges(clusters: readonly TopoCluster[], nodes: readonly TopoNode[], edges: readonly TopoEdge[]): IncidentRefs {
  const cluster = clusters.find((c) => c.slug === "linkedin-clone");
  if (!cluster) return { clusterId: null, slowEdgeId: null, lagEdgeId: null };
  const inCluster = edges.filter((e) => e.clusterId === cluster.id && e.kind === "internal");
  const local = (id: string) => nodes.find((n) => n.id === id);
  const slow =
    inCluster.find((e) => e.protocol === "feign" && local(e.from)?.localId === "notifications" && local(e.to)?.localId === "connections") ??
    inCluster.find((e) => e.protocol === "feign") ??
    null;
  const consumer = slow ? slow.from : nid(cluster.id, "notifications");
  const lag =
    inCluster.find((e) => e.protocol === "kafka" && e.to === consumer) ??
    inCluster.find((e) => e.protocol === "kafka" && local(e.from)?.kind === "broker" && local(e.to)?.kind === "worker") ??
    null;
  return { clusterId: cluster.id, slowEdgeId: slow?.id ?? null, lagEdgeId: lag?.id ?? null };
}

export function buildTopologyModel(projects: readonly Project[]): TopologyModel {
  const clusters: TopoCluster[] = [];
  const nodes: TopoNode[] = [];
  const edges: TopoEdge[] = [];

  const entryNodes = ENTRY_GRAPH.nodes.map<TopoNode>((n) => ({
    id: nid(ENTRY_ID, n.id),
    clusterId: ENTRY_ID,
    localId: n.id,
    label: n.label,
    kind: n.kind,
    tech: n.tech,
    note: n.note,
    href: null,
    live: false,
  }));
  clusters.push({
    id: ENTRY_ID,
    slug: null,
    name: "Your request",
    tagline: "You → proxy.ts → this site",
    href: null,
    status: null,
    liveUrl: null,
    nodeIds: entryNodes.map((n) => n.id),
  });
  nodes.push(...entryNodes);
  edges.push(...edgesOf(ENTRY_ID, ENTRY_GRAPH));

  let liveNodeId: string | null = null;
  let liveSlug: ProjectSlug | null = null;
  const site = nid(ENTRY_ID, "site");

  for (const p of projects) {
    const href = `/work/${p.slug}`;
    const liveLocal = findLiveNode(p);
    const pNodes = p.system.nodes.map<TopoNode>((n) => ({
      id: nid(p.slug, n.id),
      clusterId: p.slug,
      localId: n.id,
      label: n.label,
      kind: n.kind,
      tech: n.tech,
      note: n.note,
      href,
      live: n.id === liveLocal,
    }));
    clusters.push({
      id: p.slug,
      slug: p.slug,
      name: p.name,
      tagline: p.tagline,
      href,
      status: p.status,
      liveUrl: p.links.live ?? null,
      nodeIds: pNodes.map((n) => n.id),
    });
    nodes.push(...pNodes);
    edges.push(...edgesOf(p.slug, p.system));
    edges.push({ id: `${ENTRY_ID}/site=>${p.slug}`, clusterId: ENTRY_ID, kind: "link", from: site, to: p.slug, protocol: "link", cls: "link", label: "case study", probe: false });
    if (liveLocal && !liveNodeId) {
      liveNodeId = nid(p.slug, liveLocal);
      liveSlug = p.slug;
      edges.push({
        id: `${ENTRY_ID}/site->${liveNodeId}#probe`,
        clusterId: ENTRY_ID,
        kind: "cross",
        from: site,
        to: liveNodeId,
        protocol: "http",
        cls: "sync",
        label: "GET (health probe, cached 60 s)",
        probe: true,
      });
    }
  }

  return { clusters, nodes, edges, liveNodeId, liveSlug, incident: findIncidentEdges(clusters, nodes, edges) };
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

/** World units per layout pixel. */
export const UNIT = 1 / 40;

/** Layout options: compact boxes, labels only (the 3D view shows labels on hover). */
export const LAYOUT_OPTS = { colGap: 56, rowGap: 30, nodeHeight: 40, minWidth: 80, maxWidth: 150, charWidth: 6.6, padding: 0 } as const;

/** Body shape and height by node kind: stores are taller stadiums, externals are thin. */
export const KIND_BODY: Record<NodeKind, { shape: NodeShape; h: number }> = {
  client: { shape: "box", h: 0.32 },
  ui: { shape: "box", h: 0.36 },
  gateway: { shape: "box", h: 0.5 },
  service: { shape: "box", h: 0.46 },
  worker: { shape: "box", h: 0.46 },
  broker: { shape: "box", h: 0.56 },
  db: { shape: "stadium", h: 0.86 },
  cache: { shape: "stadium", h: 0.56 },
  index: { shape: "stadium", h: 0.66 },
  model: { shape: "box", h: 0.72 },
  external: { shape: "box", h: 0.28 },
};

/** Margin between a cluster's nodes and its base outline. */
export const BASE_MARGIN = 1;
/** Gaps between clusters. Rows leave room for the HTML label under each base (taller on one-column phones). */
export const GAPS = { column: 4, row: 5, rowSingle: 6.5, entry: 4.5 } as const;
export const EDGE_SEGMENTS = 24;
export const DEFAULT_PARTICLE_BUDGET = 180;
/** Extra packets reserved on the lag edge for the incident backlog. */
export const LAG_RESERVE = 8;

export interface PlacedNode extends TopoNode {
  /** Centre of the footprint. */
  x: number;
  z: number;
  /** Footprint along X (w) and Z (d), and height. */
  w: number;
  d: number;
  h: number;
  shape: NodeShape;
  layer: number;
  order: number;
}

export interface PlacedEdge extends TopoEdge {
  points: Vec3[];
  /** Cumulative arc length per point. */
  dist: number[];
  length: number;
  /** Drawn against the layering (top-to-top arc). */
  back: boolean;
  /** Packets in normal operation. */
  particles: number;
  /** Extra packets used only in incident mode. */
  reserve: number;
  phase: number;
  period: number;
}

export interface PlacedCluster extends TopoCluster {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface TopologyScene {
  columns: 1 | 2;
  clusters: PlacedCluster[];
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  bounds: { x0: number; x1: number; z0: number; z1: number; maxH: number };
  particleTotal: number;
  incident: IncidentRefs;
  liveNodeId: string | null;
}

interface LocalLayout {
  w: number;
  d: number;
  nodes: Map<string, { x: number; z: number; w: number; d: number; layer: number; order: number }>;
  back: Set<string>;
}

function layoutCluster(model: TopologyModel, cluster: TopoCluster): LocalLayout {
  const cNodes = model.nodes.filter((n) => n.clusterId === cluster.id);
  const cEdges = model.edges.filter((e) => e.clusterId === cluster.id && e.kind === "internal");
  const g = layoutGraph(
    cNodes.map((n) => ({ id: n.id, label: n.label })),
    cEdges.map((e) => ({ from: e.from, to: e.to })),
    LAYOUT_OPTS,
  );
  let maxX = 0;
  let maxY = 0;
  const nodes = new Map<string, { x: number; z: number; w: number; d: number; layer: number; order: number }>();
  for (const p of g.nodes) {
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
    nodes.set(p.id, { x: (p.x + p.w / 2) * UNIT + BASE_MARGIN, z: (p.y + p.h / 2) * UNIT + BASE_MARGIN, w: p.w * UNIT, d: p.h * UNIT, layer: p.layer, order: p.order });
  }
  const back = new Set<string>();
  g.edges.forEach((e) => {
    if (e.back) back.add(cEdges[e.index].id);
  });
  return { w: maxX * UNIT + BASE_MARGIN * 2, d: maxY * UNIT + BASE_MARGIN * 2, nodes, back };
}

/**
 * Arrange project clusters (top-left corners) in rows of `columns`, columns sized to their widest
 * cluster, rows back-aligned so cluster labels line up. The result is centred on x = 0, z starts at 0.
 */
export function arrangeClusters(sizes: readonly { w: number; d: number }[], columns: 1 | 2): { x: number; z: number }[] {
  const cols = Math.max(1, columns);
  const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...sizes.filter((_, i) => i % cols === c).map((s) => s.w)));
  const rows = Math.ceil(sizes.length / cols);
  const rowD = Array.from({ length: rows }, (_, r) => Math.max(0, ...sizes.slice(r * cols, r * cols + cols).map((s) => s.d)));
  const totalW = colW.reduce((a, b) => a + b, 0) + (cols - 1) * GAPS.column;
  const out: { x: number; z: number }[] = [];
  sizes.forEach((s, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const cellX = -totalW / 2 + colW.slice(0, c).reduce((a, b) => a + b, 0) + c * GAPS.column;
    const cellZ = rowD.slice(0, r).reduce((a, b) => a + b, 0) + r * (cols === 1 ? GAPS.rowSingle : GAPS.row);
    // Two columns hug the centre aisle; one column centres.
    const x = cols === 1 ? -s.w / 2 : c === 0 ? cellX + colW[c] - s.w : cellX;
    out.push({ x, z: cellZ });
  });
  return out;
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Side-to-side route, mirroring the 2D cubic Bézier, lifted into an arc. */
function routeForward(a: PlacedNode, b: PlacedNode, skip: number): Vec3[] {
  const x1 = a.x + a.w / 2;
  const z1 = a.z;
  const y1 = a.h * 0.55;
  const x2 = b.x - b.w / 2;
  const z2 = b.z;
  const y2 = b.h * 0.55;
  const c = Math.max(0.6, (x2 - x1) * 0.5);
  const lift = 0.2 + 0.09 * Math.abs(x2 - x1) + (skip > 1 ? 0.5 : 0);
  const pts: Vec3[] = [];
  for (let i = 0; i <= EDGE_SEGMENTS; i++) {
    const t = i / EDGE_SEGMENTS;
    const mt = 1 - t;
    const bx = mt * mt * mt * x1 + 3 * mt * mt * t * (x1 + c) + 3 * mt * t * t * (x2 - c) + t * t * t * x2;
    const bz = mt * mt * mt * z1 + 3 * mt * mt * t * z1 + 3 * mt * t * t * z2 + t * t * t * z2;
    pts.push([bx, y1 + (y2 - y1) * t + lift * 4 * t * mt, bz]);
  }
  return pts;
}

/** Top-to-top arc, used for back edges, same-layer edges and cross-cluster edges. */
function routeArc(from: Vec3, to: Vec3, lift: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= EDGE_SEGMENTS; i++) {
    const t = i / EDGE_SEGMENTS;
    const p = lerp3(from, to, t);
    p[1] += lift * 4 * t * (1 - t);
    pts.push(p);
  }
  return pts;
}

function cumulative(points: Vec3[]): number[] {
  const d = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    d.push(d[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return d;
}

/** Normal-operation packets for one edge, before the budget is applied. */
export function baseParticles(cls: EdgeClass, length: number, probe = false): number {
  if (cls === "link") return 0;
  if (probe) return 1;
  const n = cls === "sync" ? 2 + Math.floor(length / 4) : cls === "async" ? 3 + Math.floor(length / 5) : 1 + Math.floor(length / 6);
  return Math.min(5, Math.max(1, n));
}

/**
 * Packets per edge within `budget` (reserves included). If the base allocation does not fit,
 * every regular edge is scaled down proportionally but keeps at least one packet.
 */
export function allocateParticles(
  edges: readonly { cls: EdgeClass; length: number; probe?: boolean; reserve?: number }[],
  budget = DEFAULT_PARTICLE_BUDGET,
): number[] {
  const base = edges.map((e) => baseParticles(e.cls, e.length, e.probe));
  const fixed = edges.reduce((s, e, i) => s + (e.reserve ?? 0) + (e.probe ? base[i] : 0), 0);
  const flexible = edges.reduce((s, e, i) => s + (e.probe ? 0 : base[i]), 0);
  const room = Math.max(0, budget - fixed);
  if (flexible <= room) return base;
  const scale = room / flexible;
  return base.map((n, i) => (edges[i].probe || n === 0 ? n : Math.max(1, Math.floor(n * scale))));
}

export interface PlaceOptions {
  columns: 1 | 2;
  particleBudget?: number;
}

export function placeTopology(model: TopologyModel, opts: PlaceOptions): TopologyScene {
  const columns = opts.columns;
  const projectClusters = model.clusters.filter((c) => c.id !== ENTRY_ID);
  const entry = model.clusters.find((c) => c.id === ENTRY_ID);
  const layouts = new Map(model.clusters.map((c) => [c.id, layoutCluster(model, c)]));

  const corners = arrangeClusters(projectClusters.map((c) => layouts.get(c.id)!), columns);
  const origin = new Map<string, { x: number; z: number }>();
  projectClusters.forEach((c, i) => origin.set(c.id, corners[i]));
  let projectsZ1 = 0;
  projectClusters.forEach((c, i) => (projectsZ1 = Math.max(projectsZ1, corners[i].z + layouts.get(c.id)!.d)));
  if (entry) {
    const L = layouts.get(entry.id)!;
    origin.set(entry.id, { x: -L.w / 2, z: projectClusters.length ? projectsZ1 + GAPS.entry : 0 });
  }

  // Centre the whole scene on z = 0.
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const c of model.clusters) {
    const o = origin.get(c.id)!;
    zMin = Math.min(zMin, o.z);
    zMax = Math.max(zMax, o.z + layouts.get(c.id)!.d);
  }
  const zShift = -(zMin + zMax) / 2;

  const clusters: PlacedCluster[] = model.clusters.map((c) => {
    const o = origin.get(c.id)!;
    const L = layouts.get(c.id)!;
    return { ...c, x0: o.x, z0: o.z + zShift, x1: o.x + L.w, z1: o.z + zShift + L.d };
  });
  const clusterById = new Map(clusters.map((c) => [c.id, c]));

  const nodes: PlacedNode[] = model.nodes.map((n) => {
    const c = clusterById.get(n.clusterId)!;
    const p = layouts.get(n.clusterId)!.nodes.get(n.id)!;
    const body = KIND_BODY[n.kind];
    return { ...n, x: c.x0 + p.x, z: c.z0 + p.z, w: p.w, d: p.d, h: body.h, shape: body.shape, layer: p.layer, order: p.order };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const routed = model.edges.map((e) => {
    const a = nodeById.get(e.from)!;
    let points: Vec3[];
    let back = false;
    if (e.kind === "link") {
      const c = clusterById.get(e.to)!;
      const end: Vec3 = [(c.x0 + c.x1) / 2, 0, c.z1];
      const start: Vec3 = [a.x, a.h, a.z];
      const dist = Math.hypot(end[0] - start[0], end[2] - start[2]);
      points = routeArc(start, end, Math.min(2.2, 0.6 + 0.06 * dist));
    } else {
      const b = nodeById.get(e.to)!;
      const L = layouts.get(e.clusterId)!;
      back = e.kind === "internal" && (L.back.has(e.id) || a.layer > b.layer);
      if (e.kind === "internal" && !back && a.layer < b.layer) {
        points = routeForward(a, b, b.layer - a.layer);
      } else {
        const start: Vec3 = [a.x, a.h, a.z];
        const end: Vec3 = [b.x, b.h, b.z];
        const dist = Math.hypot(end[0] - start[0], end[2] - start[2]);
        points = routeArc(start, end, e.kind === "cross" ? Math.min(2.6, 1.5 + 0.08 * dist) : Math.min(2.4, 0.8 + 0.12 * dist));
      }
    }
    const dist = cumulative(points);
    return { e, points, dist, length: dist[dist.length - 1], back };
  });

  const reserveFor = (id: string) => (id === model.incident.lagEdgeId ? LAG_RESERVE : 0);
  const counts = allocateParticles(
    routed.map((r) => ({ cls: r.e.cls, length: r.length, probe: r.e.probe, reserve: reserveFor(r.e.id) })),
    opts.particleBudget ?? DEFAULT_PARTICLE_BUDGET,
  );

  const edges: PlacedEdge[] = routed.map((r, i) => {
    const rnd = mulberry32(hashSeed(r.e.id));
    return {
      ...r.e,
      points: r.points,
      dist: r.dist,
      length: r.length,
      back: r.back,
      particles: counts[i],
      reserve: reserveFor(r.e.id),
      phase: rnd(),
      period: 2.6 + rnd() * 1.6,
    };
  });

  const bounds = {
    x0: Math.min(...clusters.map((c) => c.x0)),
    x1: Math.max(...clusters.map((c) => c.x1)),
    z0: Math.min(...clusters.map((c) => c.z0)),
    z1: Math.max(...clusters.map((c) => c.z1)),
    maxH: Math.max(...edges.flatMap((e) => e.points.map((p) => p[1])), ...nodes.map((n) => n.h)),
  };

  return {
    columns,
    clusters,
    nodes,
    edges,
    bounds,
    particleTotal: edges.reduce((s, e) => s + e.particles + e.reserve, 0),
    incident: model.incident,
    liveNodeId: model.liveNodeId,
  };
}

/** Node ids adjacent to `id` (either direction), excluding link edges. */
export function neighbours(edges: readonly TopoEdge[], id: string): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.kind === "link") continue;
    if (e.from === id) out.add(e.to);
    if (e.to === id) out.add(e.from);
  }
  return out;
}
