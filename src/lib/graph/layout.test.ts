import { describe, expect, it } from "vitest";
import { layoutGraph } from "./layout";
import { projects } from "@/content";

describe("layoutGraph", () => {
  it("places a chain left to right", () => {
    const g = layoutGraph(
      [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    );
    const [a, b, c] = ["a", "b", "c"].map((id) => g.nodes.find((n) => n.id === id)!);
    expect(a.layer).toBe(0);
    expect(b.layer).toBe(1);
    expect(c.layer).toBe(2);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
  });

  it("survives cycles and marks back edges", () => {
    const g = layoutGraph(
      [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      [{ from: "a", to: "b" }, { from: "b", to: "a" }],
    );
    expect(g.nodes).toHaveLength(2);
    expect(g.edges.filter((e) => e.back)).toHaveLength(1);
  });

  it("ignores edges to unknown nodes and self-loops", () => {
    const g = layoutGraph([{ id: "a", label: "A" }], [{ from: "a", to: "zz" }, { from: "a", to: "a" }]);
    expect(g.edges).toHaveLength(0);
  });

  it("lays out every project without overlapping boxes", () => {
    for (const p of projects) {
      const g = layoutGraph(p.system.nodes.map((n) => ({ id: n.id, label: n.label, sublabel: n.tech })), p.system.edges);
      expect(g.nodes).toHaveLength(p.system.nodes.length);
      for (const n of g.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w).toBeLessThanOrEqual(g.width);
        expect(n.y + n.h).toBeLessThanOrEqual(g.height);
      }
      for (let i = 0; i < g.nodes.length; i++)
        for (let j = i + 1; j < g.nodes.length; j++) {
          const a = g.nodes[i], b = g.nodes[j];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${p.slug}: ${a.id} overlaps ${b.id}`).toBe(false);
        }
    }
  });

  it("arcs a layer-skipping edge over the boxes in its way", () => {
    // a → b → c → d in one row, plus a → c and a → d, which would otherwise cross b (and c).
    const g = layoutGraph(
      ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() })),
      [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }, { from: "a", to: "c" }, { from: "a", to: "d" }],
    );
    const node = (id: string) => g.nodes.find((n) => n.id === id)!;
    for (const e of g.edges.filter((x) => x.from === "a" && x.to !== "b")) {
      const start = e.d.match(/^M([\d.]+),([\d.]+)/)!;
      expect(Number(start[2]), `${e.from}->${e.to} leaves the top`).toBe(node("a").y);
      expect(e.mid.y).toBeLessThan(node("b").y);
    }
    expect(Math.min(...g.nodes.map((n) => n.y))).toBeGreaterThan(0);
  });

  it("never routes a detoured edge through a box, and crosses fewer boxes overall", () => {
    const crossings = (g: ReturnType<typeof layoutGraph>, only?: (e: (typeof g.edges)[number]) => boolean) => {
      let hits = 0;
      for (const e of g.edges.filter(only ?? (() => true))) {
        const n = e.d.match(/-?[\d.]+/g)!.map(Number);
        if (n.length !== 8) continue;
        const [x0, y0, x1, y1, x2, y2, x3, y3] = n;
        const crossed = new Set<string>();
        for (let k = 1; k < 60; k++) {
          const t = k / 60, u = 1 - t;
          const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
          const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
          for (const b of g.nodes) {
            if (b.id === e.from || b.id === e.to) continue;
            if (x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1) crossed.add(b.id);
          }
        }
        hits += crossed.size;
      }
      return hits;
    };
    for (const p of projects) {
      const g = layoutGraph(p.system.nodes.map((n) => ({ id: n.id, label: n.label, sublabel: n.tech })), p.system.edges);
      // Detoured edges start at a box's top or bottom edge (the side route starts at its right edge).
      const detoured = (e: (typeof g.edges)[number]) => {
        const a = g.nodes.find((n) => n.id === e.from)!;
        const y0 = Number(e.d.match(/^M[\d.]+,([\d.]+)/)![1]);
        return !e.back && (y0 === a.y || y0 === a.y + a.h);
      };
      expect(crossings(g, detoured), `${p.slug}: detoured edges cross boxes`).toBe(0);
      for (const n of g.nodes) expect(n.y, `${p.slug}: ${n.id} inside the drawing`).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic", () => {
    const p = projects[0];
    const run = () => layoutGraph(p.system.nodes.map((n) => ({ id: n.id, label: n.label })), p.system.edges);
    expect(run()).toEqual(run());
  });
});
