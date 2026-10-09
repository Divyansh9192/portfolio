/**
 * three.js renderer for the live topology. Client-only: LiveTopology loads this module with a
 * dynamic import() after mount, so three.js never sits in the initial bundle.
 *
 * Everything is procedural (no textures, no models) and batched into ~14 draw calls:
 * ground grid, cluster bases (fill + outline), node bodies, node outlines (solid + dashed for
 * external services), edges per class (sync / async / data / link), arrowheads, packets, health LED.
 * Colours come from CSS custom properties and are re-read whenever data-theme changes.
 */

import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DynamicDrawUsage,
  Fog,
  InstancedMesh,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import type { Health } from "@/lib/health";
import { flowU, probeU, queueFillTime, queueU, samplePolyline, staticU, type FlowClass, type Vec3 } from "@/lib/topology/motion";
import { ENTRY_ID, neighbours, placeTopology, type EdgeClass, type PlacedEdge, type PlacedNode, type TopologyModel, type TopologyScene } from "@/lib/topology/scene";

export type ActiveSource = "pointer" | "touch" | "keyboard";

export interface ActiveState {
  node: string | null;
  cluster: string | null;
  source: ActiveSource | null;
}

export interface EngineLabels {
  /** Cluster label elements by cluster id. Positioned with transforms, shown once placed. */
  clusters: Map<string, HTMLElement>;
  tooltip: HTMLElement | null;
  badge: HTMLElement | null;
}

export interface EngineOptions {
  /** Positioned element the canvas is appended to (fills it). */
  host: HTMLElement;
  model: TopologyModel;
  ariaLabel: string;
  labels: EngineLabels;
  motion: boolean;
  health: Health;
  onActiveChange: (state: ActiveState) => void;
  onNavigate: (href: string, newTab: boolean) => void;
  onFailure: (reason: string) => void;
}

export interface TopologyEngine {
  setMotion(ok: boolean): void;
  setHealth(h: Health): void;
  /** A health poll just went out: send one packet along the probe edge. */
  pulseProbe(): void;
  setKeyboardFocus(nodeId: string | null): void;
  setClusterFocus(clusterId: string | null): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

const TOKENS = ["bg", "surface", "surface-2", "line", "line-strong", "text", "text-2", "text-3", "sync", "async", "ok", "warn", "crit"] as const;
type Token = (typeof TOKENS)[number];
type Palette = Record<Token, Color> & { dark: boolean };

function makeColorParser() {
  const ctx = document.createElement("canvas").getContext("2d");
  return (value: string, out: Color): boolean => {
    const v = value.trim();
    if (!v || !ctx) return false;
    // Canvas normalises any CSS colour to "#rrggbb" or "rgba(r, g, b, a)".
    ctx.fillStyle = "transparent";
    ctx.fillStyle = v;
    const norm = String(ctx.fillStyle);
    if (norm.startsWith("#") && norm.length === 7) {
      out.setRGB(parseInt(norm.slice(1, 3), 16) / 255, parseInt(norm.slice(3, 5), 16) / 255, parseInt(norm.slice(5, 7), 16) / 255, SRGBColorSpace);
      return true;
    }
    const m = norm.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    if (!m) return false;
    out.setRGB(Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, SRGBColorSpace);
    return true;
  };
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

type P2 = [number, number];

/** Rounded-rectangle perimeter around the origin (x, z), counter-clockwise seen from above. */
function roundedRect(w: number, d: number, r: number, seg: number): P2[] {
  const rr = Math.max(0.001, Math.min(r, w / 2, d / 2));
  const cx = w / 2 - rr;
  const cz = d / 2 - rr;
  const centres: P2[] = [
    [cx, -cz],
    [-cx, -cz],
    [-cx, cz],
    [cx, cz],
  ];
  const out: P2[] = [];
  centres.forEach(([x, z], c) => {
    for (let i = 0; i <= seg; i++) {
      const a = -Math.PI / 2 - (c * Math.PI) / 2 - (i / seg) * (Math.PI / 2);
      const p: P2 = [x + rr * Math.cos(a), z + rr * Math.sin(a)];
      const prev = out[out.length - 1];
      if (!prev || Math.hypot(prev[0] - p[0], prev[1] - p[1]) > 1e-6) out.push(p);
    }
  });
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) out.pop();
  return out;
}

/** Push a triangle, flipping the winding if needed so its face normal points along (nx, ny, nz). */
function pushTri(pos: number[], a: Vec3, b: Vec3, c: Vec3, nx: number, ny: number, nz: number) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  if (cx * nx + cy * ny + cz * nz < 0) pos.push(...a, ...c, ...b);
  else pos.push(...a, ...b, ...c);
}

function pushLoop(pos: number[], dist: number[] | null, pts: P2[], ox: number, y: number, oz: number, scale = 1) {
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    pos.push(ox + a[0] * scale, y, oz + a[1] * scale, ox + b[0] * scale, y, oz + b[1] * scale);
    if (dist) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * scale;
      dist.push(acc, acc + len);
      acc += len;
    }
  }
}

function geometry(pos: number[], extra?: { colors?: boolean; dist?: number[] }): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  if (extra?.colors) g.setAttribute("color", new BufferAttribute(new Float32Array(pos.length), 3));
  if (extra?.dist) g.setAttribute("lineDistance", new BufferAttribute(new Float32Array(extra.dist), 1));
  return g;
}

const LIGHT = (() => {
  const l = Math.hypot(-0.55, 0.83);
  return [-0.55 / l, 0.83 / l] as const;
})();

/* ------------------------------------------------------------------ */
/* Built scene                                                         */
/* ------------------------------------------------------------------ */

interface Range {
  start: number;
  count: number;
}

interface NodeMeta {
  node: PlacedNode;
  body: Range;
  lines: Range;
  dashed: boolean;
  box: Box3;
}

interface EdgeMeta {
  edge: PlacedEdge;
  cls: EdgeClass;
  range: Range;
  arrow: number;
  slot: number;
  flow: { cls: FlowClass; length: number; count: number; phase: number; period: number } | null;
}

interface Built {
  scene: TopologyScene;
  root: Object3D[];
  geometries: BufferGeometry[];
  nodes: NodeMeta[];
  nodeIndex: Map<string, number>;
  edges: EdgeMeta[];
  bodyColors: BufferAttribute;
  bodyShade: Float32Array;
  lineColors: BufferAttribute;
  lineRole: Uint8Array;
  dashColors: BufferAttribute;
  dashRole: Uint8Array;
  edgeColors: Record<EdgeClass, BufferAttribute>;
  baseColors: BufferAttribute;
  baseLineColors: BufferAttribute;
  gridColors: BufferAttribute;
  gridFade: Float32Array;
  arrows: InstancedMesh | null;
  packets: InstancedMesh | null;
  led: Mesh | null;
  halo: Mesh | null;
  packetSize: number;
}

const VIEW = {
  2: { az: -12, el: 48, fov: 28 },
  1: { az: -8, el: 42, fov: 32 },
} as const;
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export function createTopologyEngine(opts: EngineOptions): TopologyEngine {
  const { host, model, labels } = opts;
  const coarse = window.matchMedia("(pointer: coarse)").matches;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", opts.ariaLabel);
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block", touchAction: "manipulation" });

  // Throws when WebGL is unavailable; the caller shows the 2D fallback.
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: coarse ? "low-power" : "default" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  host.appendChild(canvas);

  const three = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.5, 600);
  const fog = new Fog(new Color(), 40, 120);
  three.fog = fog;

  const parseColor = makeColorParser();
  const pal = {} as Palette;
  TOKENS.forEach((t) => (pal[t] = new Color()));
  pal.dark = true;
  let realOk: Color | null = null;

  const mats = {
    body: new MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    base: new MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
    lines: new LineBasicMaterial({ vertexColors: true }),
    dashed: new LineDashedMaterial({ vertexColors: true, dashSize: 0.12, gapSize: 0.09 }),
    baseLines: new LineBasicMaterial({ vertexColors: true }),
    grid: new LineBasicMaterial({ vertexColors: true }),
    sync: new LineBasicMaterial({ vertexColors: true }),
    async: new LineDashedMaterial({ vertexColors: true, dashSize: 0.22, gapSize: 0.16 }),
    data: new LineDashedMaterial({ vertexColors: true, dashSize: 0.045, gapSize: 0.12 }),
    link: new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 }),
    arrow: new MeshBasicMaterial(),
    packet: new MeshBasicMaterial(),
    led: new MeshBasicMaterial(),
    halo: new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  };
  const materials: Material[] = Object.values(mats);

  /* ---------------- state ---------------- */
  let disposed = false;
  let motion = opts.motion;
  let health: Health = opts.health;
  let incident = document.documentElement.dataset.incident === "on";
  let incidentStart = 0;
  let probeAt = -Infinity;
  let inView = true;
  let pageVisible = document.visibilityState !== "hidden";
  let width = 0;
  let height = 0;
  let columns: 1 | 2 = 2;
  let built: Built | null = null;

  const target = new Vector3();
  let camDist = 60;
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  let clock = 0;

  let pointerNode: string | null = null;
  let pointerCluster: string | null = null;
  let touchNode: string | null = null;
  let touchCluster: string | null = null;
  let keyNode: string | null = null;
  let keyCluster: string | null = null;
  let active: ActiveState = { node: null, cluster: null, source: null };
  let tooltipSize = { w: 0, h: 0 };

  /* ---------------- palette ---------------- */
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    for (const t of TOKENS) parseColor(cs.getPropertyValue(`--${t}`), pal[t]);
    // Incident mode re-points --ok at --crit site-wide. The LED reports real health, so keep the real ok colour.
    if (incident && realOk) pal.ok.copy(realOk);
    else if (!incident) realOk = pal.ok.clone();
    const c = pal.bg.clone().convertLinearToSRGB();
    pal.dark = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.5;
  }

  const derived = {
    top: new Color(),
    sideLit: new Color(),
    sideShade: new Color(),
    baseFill: new Color(),
    link: new Color(),
  };
  function derive() {
    const { dark } = pal;
    derived.top.copy(dark ? pal["surface-2"] : pal.surface).lerp(pal.text, dark ? 0.09 : 0);
    derived.sideLit.copy(pal["surface-2"]).lerp(dark ? pal.text : pal["text-3"], dark ? 0.03 : 0.1);
    derived.sideShade.copy(pal["surface-2"]).lerp(dark ? pal.bg : pal["text-3"], dark ? 0.55 : 0.3);
    derived.baseFill.copy(pal.bg).lerp(pal.surface, dark ? 0.85 : 0.9);
    derived.link.copy(pal["line-strong"]);
    fog.color.copy(pal.bg);
  }

  /* ---------------- build ---------------- */
  function disposeBuilt() {
    if (!built) return;
    built.root.forEach((o) => three.remove(o));
    built.geometries.forEach((g) => g.dispose());
    built.arrows?.dispose();
    built.packets?.dispose();
    built = null;
  }

  function build(cols: 1 | 2) {
    disposeBuilt();
    const scene = placeTopology(model, { columns: cols });
    const geometries: BufferGeometry[] = [];
    const root: Object3D[] = [];
    const track = <T extends BufferGeometry>(g: T) => (geometries.push(g), g);
    const add = <T extends Object3D>(o: T) => (root.push(o), three.add(o), o);

    // Ground grid: full strength under the clusters, fading to the background around them.
    const gridPos: number[] = [];
    const gridFade: number[] = [];
    {
      const step = 2;
      const b = scene.bounds;
      const margin = 9;
      const hw = (b.x1 - b.x0) / 2;
      const hd = (b.z1 - b.z0) / 2;
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const x0 = Math.floor((b.x0 - margin) / step) * step;
      const x1 = Math.ceil((b.x1 + margin) / step) * step;
      const z0 = Math.floor((b.z0 - margin) / step) * step;
      const z1 = Math.ceil((b.z1 + margin) / step) * step;
      const fade = (x: number, z: number) => {
        const q = Math.min(1, Math.hypot(Math.max(0, Math.abs(x - cx) - hw), Math.max(0, Math.abs(z - cz) - hd)) / margin);
        return q * q * (3 - 2 * q);
      };
      const seg = (ax: number, az: number, bx: number, bz: number) => {
        gridPos.push(ax, -0.02, az, bx, -0.02, bz);
        gridFade.push(fade(ax, az), fade(bx, bz));
      };
      for (let x = x0; x <= x1; x += step) for (let z = z0; z < z1; z += 1) seg(x, z, x, z + 1);
      for (let z = z0; z <= z1; z += step) for (let x = x0; x < x1; x += 1) seg(x, z, x + 1, z);
    }
    const gridGeo = track(geometry(gridPos, { colors: true }));
    add(new LineSegments(gridGeo, mats.grid));

    // Cluster bases.
    const basePos: number[] = [];
    const baseLinePos: number[] = [];
    for (const c of scene.clusters) {
      const a: Vec3 = [c.x0, 0, c.z0];
      const b: Vec3 = [c.x1, 0, c.z0];
      const cc: Vec3 = [c.x1, 0, c.z1];
      const d: Vec3 = [c.x0, 0, c.z1];
      pushTri(basePos, a, b, cc, 0, 1, 0);
      pushTri(basePos, a, cc, d, 0, 1, 0);
      baseLinePos.push(...a, ...b, ...b, ...cc, ...cc, ...d, ...d, ...a);
    }
    const baseGeo = track(geometry(basePos, { colors: true }));
    const baseLineGeo = track(geometry(baseLinePos, { colors: true }));
    add(new Mesh(baseGeo, mats.base));
    add(new LineSegments(baseLineGeo, mats.baseLines));

    // Nodes: bodies (merged), outlines (merged), dashed outlines for external services.
    const bodyPos: number[] = [];
    const shade: number[] = [];
    const linePos: number[] = [];
    const lineRole: number[] = [];
    const dashPos: number[] = [];
    const dashDist: number[] = [];
    const dashRole: number[] = [];
    const nodes: NodeMeta[] = [];
    for (const n of scene.nodes) {
      const stadium = n.shape === "stadium";
      const r = stadium ? n.d / 2 : Math.min(0.14, n.d * 0.22);
      const perim = roundedRect(n.w, n.d, r, stadium ? 10 : 3);
      const bodyStart = bodyPos.length / 3;
      const top = n.h;
      for (let i = 0; i < perim.length; i++) {
        const p = perim[i];
        const q = perim[(i + 1) % perim.length];
        pushTri(bodyPos, [n.x, top, n.z], [n.x + p[0], top, n.z + p[1]], [n.x + q[0], top, n.z + q[1]], 0, 1, 0);
        shade.push(-1, -1, -1);
        const ex = q[0] - p[0];
        const ez = q[1] - p[1];
        const len = Math.hypot(ex, ez);
        if (len < 1e-6) continue;
        let nx = ez / len;
        let nz = -ex / len;
        if (nx * (p[0] + q[0]) + nz * (p[1] + q[1]) < 0) {
          nx = -nx;
          nz = -nz;
        }
        const s = 0.5 + 0.5 * (nx * LIGHT[0] + nz * LIGHT[1]);
        const pb: Vec3 = [n.x + p[0], 0, n.z + p[1]];
        const qb: Vec3 = [n.x + q[0], 0, n.z + q[1]];
        const pt: Vec3 = [n.x + p[0], top, n.z + p[1]];
        const qt: Vec3 = [n.x + q[0], top, n.z + q[1]];
        pushTri(bodyPos, pb, qb, qt, nx, 0, nz);
        pushTri(bodyPos, pb, qt, pt, nx, 0, nz);
        shade.push(s, s, s, s, s, s);
      }
      const body = { start: bodyStart, count: bodyPos.length / 3 - bodyStart };

      const external = n.kind === "external";
      const target = external ? dashPos : linePos;
      const roles = external ? dashRole : lineRole;
      const lineStart = target.length / 3;
      const before = target.length;
      pushLoop(target, external ? dashDist : null, perim, n.x, top + 0.003, n.z);
      roles.push(...new Array((target.length - before) / 3).fill(0));
      const b2 = target.length;
      pushLoop(target, external ? dashDist : null, perim, n.x, 0.004, n.z);
      roles.push(...new Array((target.length - b2) / 3).fill(1));
      if (!external) {
        const b3 = target.length;
        if (n.kind === "broker") {
          // Double ring: an inset outline on the top face.
          pushLoop(target, null, roundedRect(n.w - 0.26, n.d - 0.26, Math.max(0.02, r - 0.13), 3), n.x, top + 0.003, n.z);
        }
        if (n.kind === "db") pushLoop(target, null, perim, n.x, top * 0.5, n.z, 1.004);
        if (!stadium) {
          for (const p of [perim[Math.floor(perim.length * 0.125)], perim[Math.floor(perim.length * 0.375)], perim[Math.floor(perim.length * 0.625)], perim[Math.floor(perim.length * 0.875)]]) {
            target.push(n.x + p[0], 0, n.z + p[1], n.x + p[0], top, n.z + p[1]);
          }
        }
        roles.push(...new Array((target.length - b3) / 3).fill(2));
      }
      const lines = { start: lineStart, count: target.length / 3 - lineStart };
      const box = new Box3(new Vector3(n.x - n.w / 2, 0, n.z - n.d / 2), new Vector3(n.x + n.w / 2, n.h, n.z + n.d / 2));
      nodes.push({ node: n, body, lines, dashed: external, box });
    }
    const bodyGeo = track(geometry(bodyPos, { colors: true }));
    const lineGeo = track(geometry(linePos, { colors: true }));
    const dashGeo = track(geometry(dashPos, { colors: true, dist: dashDist }));
    add(new Mesh(bodyGeo, mats.body));
    add(new LineSegments(lineGeo, mats.lines));
    if (dashPos.length) add(new LineSegments(dashGeo, mats.dashed));

    // Edges, one merged LineSegments per class.
    const classPos: Record<EdgeClass, number[]> = { sync: [], async: [], data: [], link: [] };
    const classDist: Record<EdgeClass, number[]> = { sync: [], async: [], data: [], link: [] };
    const edges: EdgeMeta[] = [];
    let arrowCount = 0;
    let slot = 0;
    for (const e of scene.edges) {
      const pos = classPos[e.cls];
      const dist = classDist[e.cls];
      const start = pos.length / 3;
      for (let i = 0; i < e.points.length - 1; i++) {
        pos.push(...e.points[i], ...e.points[i + 1]);
        dist.push(e.dist[i], e.dist[i + 1]);
      }
      const total = e.particles + e.reserve;
      edges.push({
        edge: e,
        cls: e.cls,
        range: { start, count: pos.length / 3 - start },
        arrow: e.cls === "link" ? -1 : arrowCount++,
        slot,
        flow: e.cls === "link" ? null : { cls: e.cls, length: e.length, count: e.particles, phase: e.phase, period: e.period },
      });
      slot += total;
    }
    const edgeColors = {} as Record<EdgeClass, BufferAttribute>;
    (["link", "data", "async", "sync"] as const).forEach((cls) => {
      const g = track(geometry(classPos[cls], { colors: true, dist: classDist[cls] }));
      edgeColors[cls] = g.getAttribute("color") as BufferAttribute;
      if (classPos[cls].length) add(new LineSegments(g, mats[cls]));
    });

    // Arrowheads at each edge's target end.
    let arrows: InstancedMesh | null = null;
    if (arrowCount) {
      const cone = track(new ConeGeometry(0.075, 0.24, 8));
      arrows = add(new InstancedMesh(cone, mats.arrow, arrowCount));
      const m = new Matrix4();
      const q = new Quaternion();
      const up = new Vector3(0, 1, 0);
      const dir = new Vector3();
      const at = new Vector3();
      for (const em of edges) {
        if (em.arrow < 0) continue;
        const pts = em.edge.points;
        const a = pts[pts.length - 2];
        const b = pts[pts.length - 1];
        dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
        q.setFromUnitVectors(up, dir);
        at.set(b[0], b[1], b[2]).addScaledVector(dir, -0.12);
        m.compose(at, q, new Vector3(1, 1, 1));
        arrows.setMatrixAt(em.arrow, m);
        arrows.setColorAt(em.arrow, pal.text);
      }
      arrows.instanceMatrix.needsUpdate = true;
    }

    // Packets.
    let packets: InstancedMesh | null = null;
    const packetSize = cols === 2 ? 0.21 : 0.28;
    if (slot) {
      const cube = track(new BoxGeometry(1, 1, 1));
      packets = add(new InstancedMesh(cube, mats.packet, slot));
      packets.instanceMatrix.setUsage(DynamicDrawUsage);
      packets.frustumCulled = false;
      for (let i = 0; i < slot; i++) packets.setColorAt(i, pal.text);
    }

    // Health LED on the live node.
    let led: Mesh | null = null;
    let halo: Mesh | null = null;
    const liveIdx = scene.nodes.findIndex((n) => n.id === scene.liveNodeId);
    if (liveIdx >= 0) {
      const n = scene.nodes[liveIdx];
      const x = n.x + n.w / 2 - 0.26;
      const z = n.z + n.d / 2 - 0.26;
      led = add(new Mesh(track(new CircleGeometry(0.16, 20)), mats.led));
      led.rotation.x = -Math.PI / 2;
      led.position.set(x, n.h + 0.008, z);
      halo = add(new Mesh(track(new RingGeometry(0.18, 0.23, 28)), mats.halo));
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(x, n.h + 0.01, z);
    }

    built = {
      scene,
      root,
      geometries,
      nodes,
      nodeIndex: new Map(nodes.map((m, i) => [m.node.id, i])),
      edges,
      bodyColors: bodyGeo.getAttribute("color") as BufferAttribute,
      bodyShade: new Float32Array(shade),
      lineColors: lineGeo.getAttribute("color") as BufferAttribute,
      lineRole: new Uint8Array(lineRole),
      dashColors: dashGeo.getAttribute("color") as BufferAttribute,
      dashRole: new Uint8Array(dashRole),
      edgeColors,
      baseColors: baseGeo.getAttribute("color") as BufferAttribute,
      baseLineColors: baseLineGeo.getAttribute("color") as BufferAttribute,
      gridColors: gridGeo.getAttribute("color") as BufferAttribute,
      gridFade: new Float32Array(gridFade),
      arrows,
      packets,
      led,
      halo,
      packetSize,
    };
    recolorGrid();
    recolor();
  }

  /* ---------------- colour ---------------- */
  const tmp = new Color();
  const tmp2 = new Color();
  function fill(attr: BufferAttribute, start: number, count: number, c: Color) {
    const arr = attr.array as Float32Array;
    for (let i = start; i < start + count; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
  }

  function edgeBaseColor(em: EdgeMeta, out: Color): Color {
    if (incident && em.edge.id === model.incident.slowEdgeId) return out.copy(pal.crit);
    switch (em.cls) {
      case "sync":
        return out.copy(pal.sync);
      case "async":
        return out.copy(pal.async);
      case "data":
        return out.copy(pal["text-3"]);
      default:
        return out.copy(derived.link);
    }
  }

  function highlightSets(): { nodes: Set<string>; edges: Set<string> } | null {
    if (!built) return null;
    if (active.node) {
      const ns = neighbours(model.edges, active.node);
      ns.add(active.node);
      const es = new Set(model.edges.filter((e) => e.from === active.node || e.to === active.node).map((e) => e.id));
      return { nodes: ns, edges: es };
    }
    if (active.cluster) {
      const id = active.cluster;
      const ns = new Set(model.nodes.filter((n) => n.clusterId === id).map((n) => n.id));
      const es = new Set(model.edges.filter((e) => (e.kind === "internal" && e.clusterId === id) || (e.kind === "link" && e.to === id) || (e.kind === "cross" && ns.has(e.to))).map((e) => e.id));
      if (id !== ENTRY_ID) {
        // Show where the cluster connects to this site.
        const site = `${ENTRY_ID}/site`;
        if ([...es].some((eid) => model.edges.find((e) => e.id === eid)?.from === site)) ns.add(site);
      }
      return { nodes: ns, edges: es };
    }
    return null;
  }

  /** Grid colours only change with the theme. */
  function recolorGrid() {
    if (!built) return;
    const arr = built.gridColors.array as Float32Array;
    for (let v = 0; v < built.gridFade.length; v++) {
      tmp.copy(pal.line).lerp(pal.bg, built.gridFade[v]);
      arr[v * 3] = tmp.r;
      arr[v * 3 + 1] = tmp.g;
      arr[v * 3 + 2] = tmp.b;
    }
    built.gridColors.needsUpdate = true;
  }

  function recolor() {
    if (!built) return;
    const b = built;
    const hl = highlightSets();
    const DIM_NODE = 0.62;
    const DIM_EDGE = 0.82;

    // Bases.
    b.scene.clusters.forEach((c, i) => {
      const on = active.cluster === c.id;
      tmp.copy(derived.baseFill);
      if (hl && !on && !(active.node && model.nodes.find((n) => n.id === active.node)?.clusterId === c.id)) tmp.lerp(pal.bg, 0.4);
      fill(b.baseColors, i * 6, 6, tmp);
      tmp.copy(on ? pal["text-3"] : pal["line-strong"]);
      fill(b.baseLineColors, i * 8, 8, tmp);
    });
    b.baseColors.needsUpdate = true;
    b.baseLineColors.needsUpdate = true;

    // Nodes.
    const bodyArr = b.bodyColors.array as Float32Array;
    for (const m of b.nodes) {
      const id = m.node.id;
      const dim = hl ? !hl.nodes.has(id) : false;
      const isActive = active.node === id;
      const ghost = m.node.kind === "external";
      for (let v = m.body.start; v < m.body.start + m.body.count; v++) {
        const s = b.bodyShade[v];
        if (s < 0) {
          tmp.copy(derived.top);
          if (isActive) tmp.lerp(pal.text, pal.dark ? 0.12 : 0.06);
        } else tmp.copy(derived.sideShade).lerp(derived.sideLit, s);
        if (ghost) tmp.lerp(pal.bg, 0.45);
        if (dim) tmp.lerp(pal.bg, DIM_NODE);
        bodyArr[v * 3] = tmp.r;
        bodyArr[v * 3 + 1] = tmp.g;
        bodyArr[v * 3 + 2] = tmp.b;
      }
      const attr = m.dashed ? b.dashColors : b.lineColors;
      const roles = m.dashed ? b.dashRole : b.lineRole;
      const arr = attr.array as Float32Array;
      for (let v = m.lines.start; v < m.lines.start + m.lines.count; v++) {
        const role = roles[v];
        if (isActive && role !== 1) tmp.copy(pal.text);
        else if (role === 1) tmp.copy(pal.line);
        else tmp.copy(m.dashed ? pal["text-3"] : pal["line-strong"]);
        if (dim) tmp.lerp(pal.bg, DIM_NODE);
        arr[v * 3] = tmp.r;
        arr[v * 3 + 1] = tmp.g;
        arr[v * 3 + 2] = tmp.b;
      }
    }
    b.bodyColors.needsUpdate = true;
    b.lineColors.needsUpdate = true;
    b.dashColors.needsUpdate = true;

    // Edges, arrows, packets.
    for (const em of b.edges) {
      const dim = hl ? !hl.edges.has(em.edge.id) : false;
      edgeBaseColor(em, tmp);
      if (dim) tmp.lerp(pal.bg, DIM_EDGE);
      fill(b.edgeColors[em.cls], em.range.start, em.range.count, tmp);
      if (b.arrows && em.arrow >= 0) b.arrows.setColorAt(em.arrow, tmp);
      if (b.packets) {
        edgeBaseColor(em, tmp2);
        if (dim) tmp2.lerp(pal.bg, 0.7);
        for (let k = 0; k < em.edge.particles + em.edge.reserve; k++) b.packets.setColorAt(em.slot + k, tmp2);
      }
    }
    (Object.keys(b.edgeColors) as EdgeClass[]).forEach((k) => (b.edgeColors[k].needsUpdate = true));
    if (b.arrows?.instanceColor) b.arrows.instanceColor.needsUpdate = true;
    if (b.packets?.instanceColor) b.packets.instanceColor.needsUpdate = true;

    // LED: unknown (or no answer yet) is neutral grey, never "probably fine".
    const ledColor = health === "ok" ? pal.ok : health === "warn" ? pal.warn : health === "crit" ? pal.crit : pal["text-3"];
    mats.led.color.copy(ledColor);
    mats.halo.color.copy(ledColor);
  }

  /* ---------------- camera ---------------- */
  const tmpV = new Vector3();
  function place(dist: number, az: number, el: number) {
    camera.position.set(target.x + dist * Math.sin(az) * Math.cos(el), target.y + dist * Math.sin(el), target.z + dist * Math.cos(az) * Math.cos(el));
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  function fitCamera() {
    if (!built || !width || !height) return;
    const v = VIEW[columns];
    camera.fov = v.fov;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Fit the real content (cluster bases plus some height), not the bounding box: its empty
    // front corners would otherwise shrink the scene.
    const pts: Vec3[] = [];
    for (const c of built.scene.clusters) for (const x of [c.x0, c.x1]) for (const z of [c.z0, c.z1]) for (const y of [0, 1]) pts.push([x, y, z]);
    // Leave room for the HTML labels that hang below each base.
    const LIM = { x: 0.95, top: 0.9, bottom: columns === 2 ? -0.8 : -0.86 };
    const extent = () => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        tmpV.set(p[0], p[1], p[2]).project(camera);
        minX = Math.min(minX, tmpV.x);
        maxX = Math.max(maxX, tmpV.x);
        minY = Math.min(minY, tmpV.y);
        maxY = Math.max(maxY, tmpV.y);
      }
      return { minX, maxX, minY, maxY };
    };
    const solve = () => {
      let lo = 4;
      let hi = 600;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        place(mid, v.az * DEG, v.el * DEG);
        const e = extent();
        const fits = e.minX >= -LIM.x && e.maxX <= LIM.x && e.maxY <= LIM.top && e.minY >= LIM.bottom;
        if (fits) hi = mid;
        else lo = mid;
      }
      return hi;
    };
    target.set(0, 0, 0);
    camDist = solve();
    place(camDist, v.az * DEG, v.el * DEG);
    const e = extent();
    const halfH = camDist * Math.tan((camera.fov * DEG) / 2);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(up, ((e.maxY + e.minY) / 2 - (LIM.top + LIM.bottom) / 2) * halfH);
    target.addScaledVector(right, ((e.maxX + e.minX) / 2) * halfH * camera.aspect);
    camDist = solve();
    fog.near = camDist * 0.85;
    fog.far = camDist * 2.3;
  }

  function updateCamera(dt: number) {
    const v = VIEW[columns];
    let az = v.az * DEG;
    let el = v.el * DEG;
    if (motion) {
      const k = Math.min(1, dt * 3);
      parallax.x += (parallax.tx - parallax.x) * k;
      parallax.y += (parallax.ty - parallax.y) * k;
      az += parallax.x * 3 * DEG + Math.sin((clock / 48) * Math.PI * 2) * 1.2 * DEG;
      el += parallax.y * 2 * DEG;
    }
    place(camDist, az, el);
  }

  /* ---------------- packets ---------------- */
  const P: Vec3 = [0, 0, 0];
  function updatePackets() {
    if (!built?.packets) return;
    const arr = built.packets.instanceMatrix.array as Float32Array;
    const s = built.packetSize;
    const tau = clock - incidentStart;
    for (const em of built.edges) {
      const e = em.edge;
      const total = e.particles + e.reserve;
      const lag = incident && e.id === model.incident.lagEdgeId;
      const slow = incident && e.id === model.incident.slowEdgeId;
      for (let k = 0; k < total; k++) {
        let u = -1;
        if (lag) u = queueU(total, k, motion ? tau : queueFillTime(total, e.length), e.length);
        else if (k >= e.particles || !em.flow) u = -1;
        else if (!motion) u = e.probe ? -1 : staticU(e.particles, k);
        else if (e.probe) u = k === 0 ? probeU(e.length, clock - probeAt) : -1;
        else u = flowU(em.flow, k, clock, slow ? 0.3 : 1);
        const o = (em.slot + k) * 16;
        if (u < 0) {
          arr.fill(0, o, o + 16);
          continue;
        }
        samplePolyline(e.points, e.dist, u, P);
        arr[o] = s;
        arr[o + 1] = 0;
        arr[o + 2] = 0;
        arr[o + 3] = 0;
        arr[o + 4] = 0;
        arr[o + 5] = s;
        arr[o + 6] = 0;
        arr[o + 7] = 0;
        arr[o + 8] = 0;
        arr[o + 9] = 0;
        arr[o + 10] = s;
        arr[o + 11] = 0;
        arr[o + 12] = P[0];
        arr[o + 13] = P[1];
        arr[o + 14] = P[2];
        arr[o + 15] = 1;
      }
    }
    built.packets.instanceMatrix.needsUpdate = true;
  }

  function updateHalo() {
    if (!built?.halo) return;
    const pulse = motion && health === "ok";
    built.halo.visible = pulse;
    if (!pulse) return;
    const ph = (clock % 2.4) / 2.4;
    built.halo.scale.setScalar(1 + ph * 1.6);
    mats.halo.opacity = 0.55 * (1 - ph);
  }

  /* ---------------- labels ---------------- */
  const lastTransform = new WeakMap<HTMLElement, string>();
  function setLabel(el: HTMLElement | null, anchor: Vec3 | null, align: "left-top" | "center-top" | "center-bottom", dy: number) {
    if (!el) return;
    if (!anchor) {
      if (el.style.visibility !== "hidden") el.style.visibility = "hidden";
      return;
    }
    tmpV.set(anchor[0], anchor[1], anchor[2]).project(camera);
    const x = ((tmpV.x + 1) / 2) * width;
    const y = ((1 - tmpV.y) / 2) * height + dy;
    const off = tmpV.z > 1 || x < -40 || x > width + 40 || y < -40 || y > height + 40;
    if (off) {
      if (el.style.visibility !== "hidden") el.style.visibility = "hidden";
      return;
    }
    const shift = align === "left-top" ? "" : align === "center-top" ? " translate(-50%,0)" : " translate(-50%,-100%)";
    const t = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)${shift}`;
    if (lastTransform.get(el) !== t) {
      el.style.transform = t;
      lastTransform.set(el, t);
    }
    if (el.style.visibility !== "visible") el.style.visibility = "visible";
  }

  function positionLabels() {
    if (!built) return;
    for (const c of built.scene.clusters) {
      const el = labels.clusters.get(c.id) ?? null;
      if (c.id === ENTRY_ID) setLabel(el, [(c.x0 + c.x1) / 2, 0, c.z1], "center-top", 6);
      else setLabel(el, [c.x0, 0, c.z1], "left-top", 4);
    }
    // Tooltip over the active node, clamped inside the frame, flipped below when there is no room.
    const tip = labels.tooltip;
    const idx = active.node ? built.nodeIndex.get(active.node) : undefined;
    if (tip) {
      if (idx === undefined) setLabel(tip, null, "center-bottom", 0);
      else {
        const n = built.nodes[idx].node;
        tmpV.set(n.x, n.h, n.z).project(camera);
        let x = ((tmpV.x + 1) / 2) * width;
        let y = ((1 - tmpV.y) / 2) * height - 14 - tooltipSize.h;
        if (y < 6) {
          tmpV.set(n.x, 0, n.z + n.d / 2).project(camera);
          y = ((1 - tmpV.y) / 2) * height + 14;
        }
        x = Math.min(Math.max(x - tooltipSize.w / 2, 8), Math.max(8, width - tooltipSize.w - 8));
        y = Math.min(Math.max(y, 6), Math.max(6, height - tooltipSize.h - 6));
        const t = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
        if (lastTransform.get(tip) !== t) {
          tip.style.transform = t;
          lastTransform.set(tip, t);
        }
        if (tip.style.visibility !== "visible") tip.style.visibility = "visible";
      }
    }
    // Incident badge over the lagging Kafka edge.
    const lag = incident && model.incident.lagEdgeId ? built.edges.find((e) => e.edge.id === model.incident.lagEdgeId) : undefined;
    if (lag) {
      const pts = lag.edge.points;
      const mid = pts[Math.floor(pts.length / 2)];
      setLabel(labels.badge, [mid[0], mid[1] + 0.5, mid[2]], "center-bottom", -6);
    } else setLabel(labels.badge, null, "center-bottom", 0);
  }

  /* ---------------- render loop ---------------- */
  let raf = 0;
  let pending = 0;
  let running = false;
  let last = 0;
  const minFrame = coarse ? 1000 / 30 - 2 : 0;

  function frame(dt: number) {
    updateCamera(dt);
    updatePackets();
    updateHalo();
    renderer.render(three, camera);
    positionLabels();
  }

  const shouldRun = () => !disposed && motion && inView && pageVisible && width > 0;

  function tick(now: number) {
    if (!shouldRun()) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(tick);
    if (minFrame && now - last < minFrame) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    clock += dt;
    frame(dt);
  }

  function startLoop() {
    if (running || !shouldRun()) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function requestRender() {
    if (disposed || running || pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (!disposed && width > 0) frame(0);
    });
  }

  function sync() {
    startLoop();
    requestRender();
  }

  /* ---------------- interaction ---------------- */
  function emitActive() {
    const node = keyNode ?? touchNode ?? pointerNode;
    const cluster = node ? null : (keyCluster ?? touchCluster ?? pointerCluster);
    const source: ActiveSource | null = keyNode || (!node && keyCluster) ? "keyboard" : touchNode || (!node && touchCluster) ? "touch" : node || cluster ? "pointer" : null;
    if (node === active.node && cluster === active.cluster && source === active.source) return;
    active = { node, cluster, source };
    recolor();
    opts.onActiveChange(active);
    requestRender();
  }

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const hitPoint = new Vector3();
  function pick(clientX: number, clientY: number): { node: string | null; cluster: string | null } {
    if (!built) return { node: null, cluster: null };
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    let best: string | null = null;
    let bestD = Infinity;
    for (const m of built.nodes) {
      const hit = raycaster.ray.intersectBox(m.box, hitPoint);
      if (hit) {
        const d = hit.distanceTo(raycaster.ray.origin);
        if (d < bestD) {
          bestD = d;
          best = m.node.id;
        }
      }
    }
    if (best) return { node: best, cluster: built.nodes[built.nodeIndex.get(best)!].node.clusterId };
    if (raycaster.ray.intersectPlane(ground, hitPoint)) {
      const c = built.scene.clusters.find((k) => hitPoint.x >= k.x0 && hitPoint.x <= k.x1 && hitPoint.z >= k.z0 && hitPoint.z <= k.z1);
      if (c) return { node: null, cluster: c.id };
    }
    return { node: null, cluster: null };
  }

  const hrefOf = (hit: { node: string | null; cluster: string | null }) => (hit.cluster ? (model.clusters.find((c) => c.id === hit.cluster)?.href ?? null) : null);

  let down: { x: number; y: number; t: number; type: string } | null = null;

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    const rect = canvas.getBoundingClientRect();
    parallax.tx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
    parallax.ty = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
    const hit = pick(e.clientX, e.clientY);
    canvas.style.cursor = hrefOf(hit) ? "pointer" : "default";
    if (hit.node !== pointerNode || hit.cluster !== pointerCluster) {
      pointerNode = hit.node;
      pointerCluster = hit.node ? null : hit.cluster;
      emitActive();
    }
  }

  function onPointerLeave(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    parallax.tx = 0;
    parallax.ty = 0;
    if (pointerNode || pointerCluster) {
      pointerNode = null;
      pointerCluster = null;
      emitActive();
    }
  }

  function onPointerDown(e: PointerEvent) {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType };
  }

  function onPointerUp(e: PointerEvent) {
    const d = down;
    down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 700) return;
    const hit = pick(e.clientX, e.clientY);
    const href = hrefOf(hit);
    if (d.type === "touch") {
      // First tap selects (tooltip), a second tap on the same thing opens the case study.
      const same = hit.node ? hit.node === touchNode : hit.cluster !== null && hit.cluster === touchCluster && !touchNode;
      if (same && href) {
        opts.onNavigate(href, false);
        return;
      }
      touchNode = hit.node;
      touchCluster = hit.node ? null : hit.cluster;
      emitActive();
      return;
    }
    if (href && (e.button === 0 || e.button === 1)) opts.onNavigate(href, e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && (touchNode || touchCluster)) {
      touchNode = null;
      touchCluster = null;
      emitActive();
    }
  }

  function onContextLost(e: Event) {
    e.preventDefault();
    opts.onFailure("WebGL context lost");
  }

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("webglcontextlost", onContextLost);
  window.addEventListener("keydown", onKeyDown);

  /* ---------------- observers ---------------- */
  function resize(w: number, h: number) {
    if (w === width && h === height) return;
    width = w;
    height = h;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const cols: 1 | 2 = w / h >= 1.15 ? 2 : 1;
    if (!built || cols !== columns) {
      columns = cols;
      build(cols);
    }
    fitCamera();
    sync();
  }

  const ro = new ResizeObserver((entries) => {
    const r = entries[entries.length - 1]?.contentRect;
    if (r) resize(Math.round(r.width), Math.round(r.height));
  });
  ro.observe(host);

  const tipRo = labels.tooltip
    ? new ResizeObserver((entries) => {
        const r = entries[entries.length - 1]?.contentRect;
        if (!r || !labels.tooltip) return;
        tooltipSize = { w: labels.tooltip.offsetWidth, h: labels.tooltip.offsetHeight };
        requestRender();
      })
    : null;
  if (labels.tooltip) tipRo?.observe(labels.tooltip);

  const io = new IntersectionObserver(
    (entries) => {
      inView = entries[entries.length - 1]?.isIntersecting ?? true;
      sync();
    },
    { rootMargin: "120px" },
  );
  io.observe(host);

  function onVisibility() {
    pageVisible = document.visibilityState !== "hidden";
    sync();
  }
  document.addEventListener("visibilitychange", onVisibility);

  const mo = new MutationObserver(() => {
    const nowIncident = document.documentElement.dataset.incident === "on";
    if (nowIncident !== incident) {
      incident = nowIncident;
      incidentStart = clock;
    }
    readPalette();
    derive();
    recolorGrid();
    recolor();
    requestRender();
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-incident"] });

  /* ---------------- init ---------------- */
  readPalette();
  derive();
  const rect = host.getBoundingClientRect();
  resize(Math.round(rect.width), Math.round(rect.height));

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    cancelAnimationFrame(pending);
    ro.disconnect();
    tipRo?.disconnect();
    io.disconnect();
    mo.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    disposeBuilt();
    materials.forEach((m) => m.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    labels.clusters.forEach((el) => (el.style.visibility = "hidden"));
    if (labels.tooltip) labels.tooltip.style.visibility = "hidden";
    if (labels.badge) labels.badge.style.visibility = "hidden";
  }

  return {
    setMotion(ok) {
      if (ok === motion) return;
      motion = ok;
      if (!ok) {
        parallax.x = parallax.y = parallax.tx = parallax.ty = 0;
        cancelAnimationFrame(raf);
        running = false;
      }
      sync();
    },
    setHealth(h) {
      if (h === health) return;
      health = h;
      recolor();
      requestRender();
    },
    pulseProbe() {
      probeAt = clock;
    },
    setKeyboardFocus(id) {
      keyNode = id;
      if (id) {
        touchNode = null;
        touchCluster = null;
      }
      emitActive();
    },
    setClusterFocus(id) {
      keyCluster = id;
      emitActive();
    },
    dispose,
  };
}
