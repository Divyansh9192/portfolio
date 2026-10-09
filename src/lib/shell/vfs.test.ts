import { describe, expect, it } from "vitest";
import { achievements, education, evidenceUrl, labs, profile, projects, skills } from "@/content";
import { allRoutes, buildVfs, dirForPathname, lookup, parentPath, pathnameOf, resolvePath, routeOf } from "./vfs";

const root = buildVfs({ profile, projects, labs, education, achievements, skills, evidenceUrl });

describe("resolvePath", () => {
  it("resolves relative, absolute, . and ..", () => {
    expect(resolvePath("/work", "orchrez")).toBe("/work/orchrez");
    expect(resolvePath("/work/orchrez", "..")).toBe("/work");
    expect(resolvePath("/work/orchrez", "../../labs")).toBe("/labs");
    expect(resolvePath("/work", "/cv/")).toBe("/cv");
    expect(resolvePath("/work", "./x/./y")).toBe("/work/x/y");
  });
  it("treats ~ as the root and never climbs above it", () => {
    expect(resolvePath("/work", "~")).toBe("/");
    expect(resolvePath("/work", "~/labs")).toBe("/labs");
    expect(resolvePath("/", "../../..")).toBe("/");
  });
  it("parentPath", () => {
    expect(parentPath("/work/orchrez/README.md")).toBe("/work/orchrez");
    expect(parentPath("/about.md")).toBe("/");
  });
});

describe("buildVfs", () => {
  it("has the root layout", () => {
    const names = root.children.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["work", "labs", "cv", "status", "colophon", "about.md", "contact.md", "resume.pdf"]));
    const resume = lookup(root, "/resume.pdf");
    expect(resume?.type).toBe("link");
    expect(resume && routeOf(resume)).toBe(profile.resumePdf);
  });

  it("has a directory per project with the four files", () => {
    for (const p of projects) {
      const d = lookup(root, `/work/${p.slug}`);
      expect(d?.type).toBe("dir");
      expect(d && routeOf(d)).toBe(`/work/${p.slug}`);
      for (const f of ["README.md", "ARCHITECTURE.md", "DECISIONS.md", "FACTS.md"]) {
        const node = lookup(root, `/work/${p.slug}/${f}`);
        expect(node?.type, `${p.slug}/${f}`).toBe("file");
      }
      const readme = lookup(root, `/work/${p.slug}/README.md`);
      expect(readme?.type === "file" && readme.content).toContain(p.summary);
    }
  });

  it("generates ARCHITECTURE.md from nodes and edges", () => {
    const p = projects[0];
    const arch = lookup(root, `/work/${p.slug}/ARCHITECTURE.md`);
    expect(arch?.type).toBe("file");
    if (arch?.type !== "file") return;
    expect(arch.content).toContain(`## Components (${p.system.nodes.length})`);
    expect(arch.content).toContain(`## Connections (${p.system.edges.length})`);
    for (const n of p.system.nodes) expect(arch.content).toContain(n.label);
    expect(arch.route).toBe(`/work/${p.slug}#architecture`);
  });

  it("links every fact to its evidence", () => {
    const withFacts = projects.find((p) => p.facts.length);
    if (!withFacts) return;
    const facts = lookup(root, `/work/${withFacts.slug}/FACTS.md`);
    expect(facts?.type === "file" && facts.content).toContain(evidenceUrl(withFacts.links.repo, withFacts.repoBranch, withFacts.facts[0].evidence));
  });

  it("has a directory per lab", () => {
    for (const l of labs) {
      const d = lookup(root, `/labs/${l.slug}`);
      expect(d?.type === "dir" && d.route).toBe(`/labs/${l.slug}`);
      expect(lookup(root, `/labs/${l.slug}/README.md`)?.type).toBe("file");
    }
  });

  it("never publishes a phone number", () => {
    const text = JSON.stringify(root);
    expect(text).not.toMatch(/\+91|\b\d{10}\b/);
  });
});

describe("URL mapping", () => {
  it("maps pathnames to directories", () => {
    expect(dirForPathname(root, "/")).toBe("/");
    expect(dirForPathname(root, `/work/${projects[0].slug}`)).toBe(`/work/${projects[0].slug}`);
    expect(dirForPathname(root, `/work/${projects[0].slug}/`)).toBe(`/work/${projects[0].slug}`);
    expect(dirForPathname(root, `/labs/${labs[0].slug}`)).toBe(`/labs/${labs[0].slug}`);
    expect(dirForPathname(root, "/cv")).toBe("/cv");
    expect(dirForPathname(root, "/status")).toBe("/status");
    expect(dirForPathname(root, "/colophon")).toBe("/colophon");
  });
  it("falls back to the nearest ancestor for unknown paths", () => {
    expect(dirForPathname(root, "/work/nope")).toBe("/work");
    expect(dirForPathname(root, "/nope/deeper")).toBe("/");
  });
  it("pathnameOf strips hashes and queries", () => {
    expect(pathnameOf("/#work")).toBe("/");
    expect(pathnameOf("/work/x#decisions")).toBe("/work/x");
    expect(pathnameOf("/cv?print=1")).toBe("/cv");
  });
  it("collects routes", () => {
    const routes = allRoutes(root);
    expect(routes).toContain("/cv");
    expect(routes).toContain(`/work/${projects[0].slug}`);
  });
});
