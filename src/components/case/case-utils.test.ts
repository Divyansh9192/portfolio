import { describe, expect, it } from "vitest";
import { evidenceUrl, projects } from "@/content";
import type { SystemGraph } from "@/content/types";
import {
  CASE_SECTIONS,
  adjacentProjects,
  archStrip,
  edgesTouching,
  parseEvidence,
  pickActiveSection,
  protocolSummary,
  repoShortName,
  sectionById,
} from "./case-utils";

describe("CASE_SECTIONS", () => {
  it("has unique ids, numbered 1..n in order", () => {
    const ids = CASE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CASE_SECTIONS.map((s) => s.n)).toEqual(CASE_SECTIONS.map((_, i) => i + 1));
    expect(ids).toEqual(["problem", "constraints", "architecture", "decisions", "lab", "result", "next", "evidence"]);
  });

  it("sectionById throws on unknown ids so typos fail loudly at build", () => {
    expect(sectionById("lab").label).toBe("Try it");
    expect(() => sectionById("nope")).toThrow();
  });
});

describe("pickActiveSection", () => {
  const order = ["a", "b", "c"];
  it("prefers the first visible section in document order", () => {
    expect(pickActiveSection(order, new Set(["c", "b"]), null, false)).toBe("b");
  });
  it("returns null above the first section and keeps the previous value otherwise", () => {
    expect(pickActiveSection(order, new Set(), "b", true)).toBeNull();
    expect(pickActiveSection(order, new Set(), "b", false)).toBe("b");
  });
});

describe("parseEvidence", () => {
  it("splits a ranged path", () => {
    expect(parseEvidence("backend/app/agents/research/subgraph.py:51-67")).toEqual({
      path: "backend/app/agents/research/subgraph.py",
      dir: "backend/app/agents/research/",
      file: "subgraph.py",
      lines: "51-67",
      display: "backend/app/agents/research/subgraph.py:51-67",
    });
  });
  it("handles a single line and root-level files", () => {
    expect(parseEvidence("docker-compose.yml:3")).toMatchObject({ dir: "", file: "docker-compose.yml", lines: "3" });
  });
  it("handles evidence without a line reference", () => {
    expect(parseEvidence("src/load_model.py")).toMatchObject({ lines: null, display: "src/load_model.py" });
  });
  it("parses every fact in the content and agrees with evidenceUrl", () => {
    for (const p of projects) {
      for (const f of p.facts) {
        const e = parseEvidence(f.evidence);
        expect(e.path.length).toBeGreaterThan(0);
        expect(e.lines).not.toBeNull();
        expect(evidenceUrl(p.links.repo, p.repoBranch, f.evidence)).toContain(`/blob/${p.repoBranch}/${e.path}#L`);
      }
    }
  });
});

describe("repoShortName", () => {
  it("extracts owner/repo", () => {
    expect(repoShortName("https://github.com/Divyansh9192/Orchrez")).toBe("Divyansh9192/Orchrez");
    expect(repoShortName("https://github.com/a/b.git")).toBe("a/b");
  });
});

describe("adjacentProjects", () => {
  const list = [{ slug: "a" }, { slug: "b" }, { slug: "c" }];
  it("finds neighbours without wrapping", () => {
    expect(adjacentProjects(list, "a")).toEqual({ prev: undefined, next: { slug: "b" } });
    expect(adjacentProjects(list, "b")).toEqual({ prev: { slug: "a" }, next: { slug: "c" } });
    expect(adjacentProjects(list, "c")).toEqual({ prev: { slug: "b" }, next: undefined });
    expect(adjacentProjects(list, "zzz")).toEqual({});
  });
});

describe("protocolSummary", () => {
  it("pairs each protocol class with a word", () => {
    expect(protocolSummary("kafka")).toEqual({ name: "Kafka", cls: "async", clsLabel: "message" });
    expect(protocolSummary("sql")).toEqual({ name: "SQL", cls: "data", clsLabel: "data" });
    expect(protocolSummary("feign")).toEqual({ name: "Feign", cls: "sync", clsLabel: "call" });
  });
});

describe("edgesTouching", () => {
  it("lists edge indices in and out of a node", () => {
    const g: SystemGraph = {
      nodes: [],
      edges: [
        { from: "a", to: "b", protocol: "http", label: "" },
        { from: "b", to: "c", protocol: "http", label: "" },
        { from: "c", to: "a", protocol: "http", label: "" },
      ],
    };
    expect(edgesTouching(g, "b")).toEqual([0, 1]);
    expect(edgesTouching(g, "z")).toEqual([]);
  });
});

describe("archStrip", () => {
  it("returns nothing for an empty graph", () => {
    expect(archStrip({ nodes: [], edges: [] })).toEqual([]);
  });

  it("follows the layered flow of a chain", () => {
    const g: SystemGraph = {
      nodes: [
        { id: "a", label: "A", kind: "client", tech: "" },
        { id: "b", label: "B", kind: "service", tech: "" },
        { id: "c", label: "C", kind: "db", tech: "" },
      ],
      edges: [
        { from: "a", to: "b", protocol: "http", label: "" },
        { from: "b", to: "c", protocol: "sql", label: "" },
      ],
    };
    expect(archStrip(g).map((c) => c.nodes.map((n) => n.id))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("caps boxes per column and in total, keeps every layer, and counts what it hid", () => {
    const g: SystemGraph = {
      nodes: [
        { id: "src", label: "src", kind: "client", tech: "" },
        ...["s1", "s2", "s3", "s4", "s5"].map((id) => ({ id, label: id, kind: "service" as const, tech: "" })),
        { id: "db", label: "db", kind: "db", tech: "" },
      ],
      edges: [
        ...["s1", "s2", "s3", "s4", "s5"].map((id) => ({ from: "src", to: id, protocol: "http" as const, label: "" })),
        { from: "s1", to: "db", protocol: "sql", label: "" },
      ],
    };
    const strip = archStrip(g, 4, 3);
    expect(strip).toHaveLength(3);
    expect(strip.reduce((n, c) => n + c.nodes.length, 0)).toBe(4);
    expect(strip[1].nodes.length).toBe(2);
    expect(strip[1].hidden).toBe(3);
    expect(strip[2].nodes.map((n) => n.id)).toEqual(["db"]);
  });

  it("is deterministic and within budget for every real project", () => {
    for (const p of projects) {
      const a = archStrip(p.system, 8, 3);
      const b = archStrip(p.system, 8, 3);
      expect(a).toEqual(b);
      const shown = a.reduce((n, c) => n + c.nodes.length, 0);
      const hidden = a.reduce((n, c) => n + c.hidden, 0);
      expect(shown).toBeLessThanOrEqual(8);
      expect(shown + hidden).toBe(p.system.nodes.length);
      for (const col of a) expect(col.nodes.length).toBeGreaterThan(0);
    }
  });
});
