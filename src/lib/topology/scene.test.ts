import { describe, expect, it } from "vitest";
import { projects } from "@/content";
import { protocolClass, type Project } from "@/content/types";
import { layoutGraph } from "@/lib/graph/layout";
import {
  BASE_MARGIN,
  DEFAULT_PARTICLE_BUDGET,
  ENTRY_ID,
  LAG_RESERVE,
  LAYOUT_OPTS,
  UNIT,
  allocateParticles,
  arrangeClusters,
  buildTopologyModel,
  findLiveNode,
  neighbours,
  placeTopology,
} from "./scene";

const model = buildTopologyModel(projects);
const scenes = { 1: placeTopology(model, { columns: 1 }), 2: placeTopology(model, { columns: 2 }) } as const;

describe("buildTopologyModel", () => {
  it("has the entry cluster plus one cluster per project, in content order", () => {
    expect(model.clusters.map((c) => c.id)).toEqual([ENTRY_ID, ...projects.map((p) => p.slug)]);
    expect(model.clusters[0].href).toBeNull();
    for (const p of projects) expect(model.clusters.find((c) => c.id === p.slug)?.href).toBe(`/work/${p.slug}`);
  });

  it("keeps every content node and edge, with globally unique ids", () => {
    const ids = model.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of projects) {
      expect(model.nodes.filter((n) => n.clusterId === p.slug)).toHaveLength(p.system.nodes.length);
      expect(model.edges.filter((e) => e.clusterId === p.slug && e.kind === "internal")).toHaveLength(p.system.edges.length);
    }
    const edgeIds = model.edges.map((e) => e.id);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
  });

  it("classes edges by protocol and resolves every endpoint", () => {
    const nodeIds = new Set(model.nodes.map((n) => n.id));
    const clusterIds = new Set(model.clusters.map((c) => c.id));
    for (const e of model.edges) {
      expect(nodeIds.has(e.from)).toBe(true);
      if (e.kind === "link") {
        expect(clusterIds.has(e.to)).toBe(true);
        expect(e.cls).toBe("link");
      } else {
        expect(nodeIds.has(e.to)).toBe(true);
        expect(e.cls).toBe(protocolClass[e.protocol as keyof typeof protocolClass]);
      }
    }
  });

  it("links this site to every case study and probes the live app", () => {
    const links = model.edges.filter((e) => e.kind === "link");
    expect(links.map((e) => e.to).sort()).toEqual(projects.map((p) => p.slug).sort());
    expect(model.liveSlug).toBe("neonstays");
    expect(model.liveNodeId).toBe("neonstays/web");
    const probe = model.edges.filter((e) => e.probe);
    expect(probe).toHaveLength(1);
    expect(probe[0]).toMatchObject({ from: `${ENTRY_ID}/site`, to: "neonstays/web", cls: "sync" });
    expect(model.nodes.filter((n) => n.live).map((n) => n.id)).toEqual(["neonstays/web"]);
  });

  it("finds the incident edges in the LinkedIn clone", () => {
    const { clusterId, slowEdgeId, lagEdgeId } = model.incident;
    expect(clusterId).toBe("linkedin-clone");
    const slow = model.edges.find((e) => e.id === slowEdgeId)!;
    const lag = model.edges.find((e) => e.id === lagEdgeId)!;
    expect(slow).toMatchObject({ from: "linkedin-clone/notifications", to: "linkedin-clone/connections", protocol: "feign", cls: "sync" });
    expect(lag).toMatchObject({ from: "linkedin-clone/kafka", to: "linkedin-clone/notifications", protocol: "kafka", cls: "async" });
  });

  it("degrades gracefully when the incident ids are missing", () => {
    const noLinkedin = buildTopologyModel(projects.filter((p) => p.slug !== "linkedin-clone"));
    expect(noLinkedin.incident).toEqual({ clusterId: null, slowEdgeId: null, lagEdgeId: null });
    const li = projects.find((p) => p.slug === "linkedin-clone")!;
    const stripped: Project = { ...li, system: { nodes: li.system.nodes, edges: li.system.edges.filter((e) => e.protocol !== "feign" && e.protocol !== "kafka") } };
    const m = buildTopologyModel([stripped]);
    expect(m.incident).toEqual({ clusterId: "linkedin-clone", slowEdgeId: null, lagEdgeId: null });
    expect(() => placeTopology(m, { columns: 2 })).not.toThrow();
  });

  it("finds no live node for projects without a live link", () => {
    const m = buildTopologyModel(projects.filter((p) => !p.links.live));
    expect(m.liveNodeId).toBeNull();
    expect(m.edges.some((e) => e.probe)).toBe(false);
    expect(findLiveNode({ links: { repo: "x", live: "https://example.test" }, system: { nodes: [{ id: "a", label: "A", kind: "service", tech: "t" }], edges: [] } })).toBe("a");
  });
});

describe("placeTopology", () => {
  it("maps each cluster's 2D layout onto the X/Z plane", () => {
    const scene = scenes[2];
    for (const p of projects) {
      const g = layoutGraph(p.system.nodes.map((n) => ({ id: n.id, label: n.label })), p.system.edges, LAYOUT_OPTS);
      const c = scene.clusters.find((k) => k.id === p.slug)!;
      for (const pn of g.nodes) {
        const n = scene.nodes.find((k) => k.id === `${p.slug}/${pn.id}`)!;
        expect(n.layer).toBe(pn.layer);
        expect(n.x).toBeCloseTo(c.x0 + BASE_MARGIN + (pn.x + pn.w / 2) * UNIT, 6);
        expect(n.z).toBeCloseTo(c.z0 + BASE_MARGIN + (pn.y + pn.h / 2) * UNIT, 6);
        expect(n.w).toBeCloseTo(pn.w * UNIT, 6);
      }
    }
  });

  it("keeps nodes inside their base and never overlaps nodes or clusters", () => {
    for (const scene of Object.values(scenes)) {
      for (const n of scene.nodes) {
        const c = scene.clusters.find((k) => k.id === n.clusterId)!;
        expect(n.x - n.w / 2).toBeGreaterThanOrEqual(c.x0);
        expect(n.x + n.w / 2).toBeLessThanOrEqual(c.x1 + 1e-9);
        expect(n.z - n.d / 2).toBeGreaterThanOrEqual(c.z0);
        expect(n.z + n.d / 2).toBeLessThanOrEqual(c.z1 + 1e-9);
      }
      for (let i = 0; i < scene.nodes.length; i++)
        for (let j = i + 1; j < scene.nodes.length; j++) {
          const a = scene.nodes[i];
          const b = scene.nodes[j];
          const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
          expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
        }
      for (let i = 0; i < scene.clusters.length; i++)
        for (let j = i + 1; j < scene.clusters.length; j++) {
          const a = scene.clusters[i];
          const b = scene.clusters[j];
          const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
          expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
        }
    }
  });

  it("puts the entry cluster at the front centre and centres the scene", () => {
    for (const scene of Object.values(scenes)) {
      const entry = scene.clusters.find((c) => c.id === ENTRY_ID)!;
      expect((entry.x0 + entry.x1) / 2).toBeCloseTo(0, 6);
      for (const c of scene.clusters) if (c.id !== ENTRY_ID) expect(entry.z0).toBeGreaterThan(c.z1);
      expect((scene.bounds.z0 + scene.bounds.z1) / 2).toBeCloseTo(0, 6);
    }
  });

  it("uses a 2×2 grid for wide frames and a single column for tall ones", () => {
    const wide = scenes[2];
    const tall = scenes[1];
    expect(wide.bounds.x1 - wide.bounds.x0).toBeGreaterThan(tall.bounds.x1 - tall.bounds.x0);
    expect(tall.bounds.z1 - tall.bounds.z0).toBeGreaterThan(wide.bounds.z1 - wide.bounds.z0);
    const corners = arrangeClusters([{ w: 10, d: 4 }, { w: 6, d: 2 }, { w: 8, d: 3 }, { w: 4, d: 1 }], 2);
    expect(corners[0].z).toBe(corners[1].z);
    expect(corners[2].z).toBe(corners[3].z);
    expect(corners[2].z).toBeGreaterThan(corners[0].z);
    expect(corners[1].x).toBeGreaterThan(corners[0].x + 10);
  });

  it("routes edges from source to target as lifted curves", () => {
    const scene = scenes[2];
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    for (const e of scene.edges) {
      expect(e.points.length).toBeGreaterThan(2);
      expect(e.dist).toHaveLength(e.points.length);
      for (let i = 1; i < e.dist.length; i++) expect(e.dist[i]).toBeGreaterThanOrEqual(e.dist[i - 1]);
      expect(e.length).toBeGreaterThan(0);
      const a = byId.get(e.from)!;
      const first = e.points[0];
      expect(Math.abs(first[0] - a.x)).toBeLessThanOrEqual(a.w / 2 + 1e-9);
      expect(Math.abs(first[2] - a.z)).toBeLessThanOrEqual(a.d / 2 + 1e-9);
      const last = e.points[e.points.length - 1];
      if (e.kind === "link") {
        const c = scene.clusters.find((k) => k.id === e.to)!;
        expect(last[2]).toBeCloseTo(c.z1, 6);
      } else {
        const b = byId.get(e.to)!;
        expect(Math.abs(last[0] - b.x)).toBeLessThanOrEqual(b.w / 2 + 1e-9);
        expect(Math.abs(last[2] - b.z)).toBeLessThanOrEqual(b.d / 2 + 1e-9);
      }
      const peak = Math.max(...e.points.map((p) => p[1]));
      expect(peak).toBeGreaterThan(Math.max(first[1], last[1]));
    }
  });

  it("allocates a small, deterministic packet budget", () => {
    for (const scene of Object.values(scenes)) {
      expect(scene.particleTotal).toBeLessThanOrEqual(DEFAULT_PARTICLE_BUDGET);
      expect(scene.particleTotal).toBeGreaterThan(40);
      for (const e of scene.edges) {
        if (e.kind === "link") expect(e.particles).toBe(0);
        else expect(e.particles).toBeGreaterThanOrEqual(1);
        expect(e.reserve).toBe(e.id === scene.incident.lagEdgeId ? LAG_RESERVE : 0);
      }
      expect(scene.edges.find((e) => e.probe)?.particles).toBe(1);
    }
    expect(placeTopology(model, { columns: 2 })).toEqual(scenes[2]);
  });

  it("scales packets down to fit a tight budget", () => {
    const edges = Array.from({ length: 30 }, (_, i) => ({ cls: (["sync", "async", "data"] as const)[i % 3], length: 12 }));
    const counts = allocateParticles(edges, 40);
    expect(counts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(40);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
    const small = placeTopology(model, { columns: 2, particleBudget: 70 });
    expect(small.particleTotal).toBeLessThanOrEqual(70);
  });

  it("lists neighbours in both directions", () => {
    const n = neighbours(model.edges, "linkedin-clone/notifications");
    expect([...n].sort()).toEqual(["linkedin-clone/connections", "linkedin-clone/kafka", "linkedin-clone/notifdb"]);
  });
});
