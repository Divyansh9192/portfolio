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

  it("is deterministic", () => {
    const p = projects[0];
    const run = () => layoutGraph(p.system.nodes.map((n) => ({ id: n.id, label: n.label })), p.system.edges);
    expect(run()).toEqual(run());
  });
});
