/**
 * Layered left-to-right layout for small system graphs (Sugiyama-style, simplified):
 *   1. break cycles by reversing DFS back-edges,
 *   2. assign layers by longest path from sources,
 *   3. order nodes inside each layer with barycenter sweeps,
 *   4. place boxes on a grid and route edges as cubic Béziers.
 * Pure and deterministic, so the same graph always draws the same way (SSR-safe).
 */

export interface LayoutInputNode {
  id: string;
  /** Text lines used to size the box. */
  label: string;
  sublabel?: string;
}

export interface LayoutInputEdge {
  from: string;
  to: string;
}

export interface LayoutOptions {
  /** Horizontal gap between layers (px). */
  colGap?: number;
  /** Vertical gap between boxes in a layer (px). */
  rowGap?: number;
  /** Approx. glyph width for the label font (px). */
  charWidth?: number;
  /** Box height (px). */
  nodeHeight?: number;
  /** Min / max box width (px). */
  minWidth?: number;
  maxWidth?: number;
  /** Outer padding (px). */
  padding?: number;
}

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  order: number;
}

export interface RoutedEdge {
  from: string;
  to: string;
  /** SVG path data. */
  d: string;
  /** Midpoint, for labels. */
  mid: { x: number; y: number };
  /** True when the edge points backwards (against the layering). */
  back: boolean;
  /** Index into the input edges array. */
  index: number;
}

export interface GraphLayout {
  nodes: PlacedNode[];
  edges: RoutedEdge[];
  width: number;
  height: number;
}

export function layoutGraph(nodesIn: LayoutInputNode[], edgesIn: LayoutInputEdge[], opts: LayoutOptions = {}): GraphLayout {
  const colGap = opts.colGap ?? 72;
  const rowGap = opts.rowGap ?? 22;
  const charWidth = opts.charWidth ?? 7.4;
  const nodeHeight = opts.nodeHeight ?? 46;
  const minWidth = opts.minWidth ?? 104;
  const maxWidth = opts.maxWidth ?? 196;
  const padding = opts.padding ?? 12;

  const ids = nodesIn.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const edges = edgesIn.filter((e) => index.has(e.from) && index.has(e.to) && e.from !== e.to);

  // 1. Cycle breaking: DFS in input order, reverse back-edges.
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  edges.forEach((e) => out.get(e.from)!.push(e.to));
  const state = new Map<string, 0 | 1 | 2>(ids.map((id) => [id, 0]));
  const backKeys = new Set<string>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      const s = state.get(v);
      if (s === 1) backKeys.add(`${u}->${v}`);
      else if (s === 0) visit(v);
    }
    state.set(u, 2);
  };
  // Start from nodes with no incoming edges first, so the natural direction is kept.
  const indeg = new Map(ids.map((id) => [id, 0]));
  edges.forEach((e) => indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1));
  [...ids.filter((id) => indeg.get(id) === 0), ...ids].forEach((id) => state.get(id) === 0 && visit(id));

  const dag = edges.map((e) => (backKeys.has(`${e.from}->${e.to}`) ? { from: e.to, to: e.from, back: true } : { ...e, back: false }));

  // 2. Longest-path layering.
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const e of dag) {
      const want = layer.get(e.from)! + 1;
      if (layer.get(e.to)! < want) {
        layer.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Pull sinks-only-from-one-source nodes (like databases) next to their source.
  for (const id of ids) {
    const outs = dag.filter((e) => e.from === id);
    const ins = dag.filter((e) => e.to === id);
    if (outs.length === 0 && ins.length === 1) layer.set(id, layer.get(ins[0].from)! + 1);
  }

  const layerCount = Math.max(...ids.map((id) => layer.get(id)!)) + 1;
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  ids.forEach((id) => layers[layer.get(id)!].push(id));

  // 3. Barycenter ordering, a few down/up sweeps.
  const pos = new Map<string, number>();
  const setPos = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  setPos();
  const neighbours = (id: string, dir: "in" | "out") =>
    dag.filter((e) => (dir === "in" ? e.to === id : e.from === id)).map((e) => (dir === "in" ? e.from : e.to));
  for (let sweep = 0; sweep < 6; sweep++) {
    const down = sweep % 2 === 0;
    const range = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const l of range) {
      const bary = new Map<string, number>();
      l.forEach((id) => {
        const ns = neighbours(id, down ? "in" : "out");
        bary.set(id, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!);
      });
      l.sort((a, b) => bary.get(a)! - bary.get(b)! || index.get(a)! - index.get(b)!);
      l.forEach((id, i) => pos.set(id, i));
    }
  }

  // 4. Geometry.
  const width = (n: LayoutInputNode) =>
    Math.round(Math.min(maxWidth, Math.max(minWidth, Math.max(n.label.length, (n.sublabel ?? "").length * 0.9) * charWidth + 24)));
  const byId = new Map(nodesIn.map((n) => [n.id, n]));
  const colWidths = layers.map((l) => Math.max(...l.map((id) => width(byId.get(id)!))));
  const tallest = Math.max(...layers.map((l) => l.length));
  const innerHeight = tallest * nodeHeight + (tallest - 1) * rowGap;

  const placed: PlacedNode[] = [];
  let x = padding;
  layers.forEach((l, li) => {
    const colH = l.length * nodeHeight + (l.length - 1) * rowGap;
    let y = padding + (innerHeight - colH) / 2;
    l.forEach((id, oi) => {
      const w = width(byId.get(id)!);
      placed.push({ id, x: x + (colWidths[li] - w) / 2, y, w, h: nodeHeight, layer: li, order: oi });
      y += nodeHeight + rowGap;
    });
    x += colWidths[li] + colGap;
  });
  const totalW = x - colGap + padding;
  const totalH = innerHeight + padding * 2;
  const P = new Map(placed.map((p) => [p.id, p]));

  const routed: RoutedEdge[] = edges.map((e, i) => {
    const a = P.get(e.from)!;
    const b = P.get(e.to)!;
    const back = backKeys.has(`${e.from}->${e.to}`);
    if (a.layer === b.layer) {
      // Same column: arc out to the right.
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x + b.w, y2 = b.y + b.h / 2;
      const bulge = 28 + Math.abs(y2 - y1) * 0.15;
      return { from: e.from, to: e.to, back, index: i, d: `M${x1},${y1} C${x1 + bulge},${y1} ${x2 + bulge},${y2} ${x2},${y2}`, mid: { x: Math.max(x1, x2) + bulge * 0.75, y: (y1 + y2) / 2 } };
    }
    if (!back && a.layer < b.layer) {
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
      const c = Math.max(24, (x2 - x1) * 0.5);
      return { from: e.from, to: e.to, back, index: i, d: `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
    }
    // Backward edge: leave from the bottom of the source, loop under, enter the bottom of the target.
    const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y + b.h;
    const dip = Math.min(totalH - 2, Math.max(y1, y2) + 26);
    return { from: e.from, to: e.to, back: true, index: i, d: `M${x1},${y1} C${x1},${dip} ${x2},${dip} ${x2},${y2}`, mid: { x: (x1 + x2) / 2, y: dip - 6 } };
  });

  return { nodes: placed, edges: routed, width: Math.ceil(totalW), height: Math.ceil(totalH + 20) };
}
