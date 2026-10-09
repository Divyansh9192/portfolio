import { describe, expect, it } from "vitest";
import { labs, profile, projects } from "@/content";
import { parseWidth, renderAnsi, renderAnsiPage, stripAnsi, vlen, wantsColor, wrap } from "./ansi";

const ORIGIN = "https://example.test";

function maxLine(s: string): number {
  return Math.max(...stripAnsi(s).split("\n").map(vlen));
}

describe("wrap", () => {
  it("never exceeds the width and keeps every word", () => {
    const text = "the quick brown fox jumps over the lazy dog ".repeat(10);
    for (const w of [10, 17, 40, 80]) {
      const lines = wrap(text, w);
      expect(Math.max(...lines.map(vlen))).toBeLessThanOrEqual(w);
      expect(lines.join(" ").split(" ")).toEqual(text.trim().split(" "));
    }
  });

  it("breaks long tokens at path punctuation", () => {
    const lines = wrap("see https://github.com/someone/a-really-long-repository-name/blob/main/file.ts", 30);
    expect(Math.max(...lines.map(vlen))).toBeLessThanOrEqual(30);
    expect(lines.join("")).toContain("github.com/someone/");
  });
});

describe("renderAnsi", () => {
  it("renders the home résumé without colour codes when color is false", () => {
    const out = renderAnsi("/", { color: false, origin: ORIGIN });
    expect(out).not.toMatch(/\x1b\[/);
    expect(out.split("\n")[0]).toBe(profile.name);
    expect(out).toContain(profile.role);
    expect(out).toContain(profile.email);
    for (const p of projects) {
      expect(out).toContain(p.name);
      expect(out).toContain(`${ORIGIN}/work/${p.slug}`);
    }
    expect(out).toContain(`curl ${ORIGIN}/resume.json`);
    expect(out).toContain(`curl ${ORIGIN}/llms.txt`);
    expect(out).toContain(`${ORIGIN}/api/mcp`);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("uses only 16-colour SGR codes when color is true", () => {
    const out = renderAnsi("/", { color: true, origin: ORIGIN });
    const codes = out.match(/\x1b\[([0-9;]*)m/g) ?? [];
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) {
      for (const n of c.slice(2, -1).split(";").map(Number)) {
        expect([0, 1, 2, 3, 4, 22, 23, 24, 39, 49].includes(n) || (n >= 30 && n <= 37) || (n >= 90 && n <= 97)).toBe(true);
      }
    }
    expect(stripAnsi(out)).toBe(renderAnsi("/", { color: false, origin: ORIGIN }));
  });

  it("keeps every line within the width for every page and width", () => {
    const paths = ["/", "/cv", "/labs", "/status", "/colophon", "/nope", ...projects.map((p) => `/work/${p.slug}`), ...labs.map((l) => `/labs/${l.slug}`)];
    for (const width of [40, 57, 80, 120]) {
      for (const path of paths) {
        for (const color of [false, true]) {
          expect(maxLine(renderAnsi(path, { color, width, origin: ORIGIN })), `${path} @${width}`).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  it("renders a case study with architecture edges and evidence", () => {
    for (const p of projects) {
      const out = renderAnsi(`/work/${p.slug}`, { color: false, width: 200, origin: ORIGIN });
      expect(out).toContain(p.name);
      expect(out).toContain(p.summary.split(" ").slice(0, 4).join(" "));
      const labels = new Map(p.system.nodes.map((n) => [n.id, n.label]));
      for (const e of p.system.edges) {
        expect(out).toMatch(new RegExp(`${escape(labels.get(e.from) ?? e.from)} +--${e.protocol}--> ${escape(labels.get(e.to) ?? e.to)} : `));
      }
      for (const m of p.metrics) expect(out).toContain(`source: ${m.source}`);
      for (const f of p.facts) expect(out).toContain(f.evidence);
    }
  });

  it("treats /cv like / and normalises trailing slashes and .md", () => {
    const home = renderAnsi("/", { color: false, origin: ORIGIN });
    expect(renderAnsi("/cv", { color: false, origin: ORIGIN })).toBe(home);
    const slug = projects[0].slug;
    expect(renderAnsi(`/work/${slug}/`, { color: false, origin: ORIGIN })).toBe(renderAnsi(`/work/${slug}`, { color: false, origin: ORIGIN }));
  });

  it("returns 404 with the list of valid paths for unknown pages", () => {
    const res = renderAnsiPage("/work/does-not-exist", { color: false, origin: ORIGIN });
    expect(res.status).toBe(404);
    expect(res.body).toMatch(/^404 not found: \/work\/does-not-exist/);
    expect(res.body).toContain("/cv");
    for (const p of projects) expect(res.body).toContain(`/work/${p.slug}`);
  });

  it("never echoes control characters from the requested path", () => {
    const res = renderAnsiPage("/x%0a%1b%5b2J%1b%5d52%3bc%3bZXZpbA%3d%3d%07%c2%9b", { color: false, origin: ORIGIN });
    expect(res.status).toBe(404);
    const firstLine = res.body.split("\n")[0];
    expect(firstLine).toBe("404 not found: /x[2J]52;c;ZXZpbA==");
    expect(res.body).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
  });

  it("caps very long requested paths", () => {
    const res = renderAnsiPage(`/${"a".repeat(5000)}`, { color: false, origin: ORIGIN });
    expect(res.body.split("\n")[0].length).toBeLessThan(160);
  });
});

describe("options", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("colours terminals by default and honours plain/color/no_color", () => {
    expect(wantsColor(q(""), "curl/8.5.0")).toBe(true);
    expect(wantsColor(q(""), "HTTPie/3.2.2")).toBe(true);
    expect(wantsColor(q(""), "Wget/1.21")).toBe(false);
    expect(wantsColor(q(""), "Mozilla/5.0")).toBe(false);
    expect(wantsColor(q("plain=1"), "curl/8.5.0")).toBe(false);
    expect(wantsColor(q("plain"), "curl/8.5.0")).toBe(false);
    expect(wantsColor(q("color=0"), "curl/8.5.0")).toBe(false);
    expect(wantsColor(q("no_color"), "curl/8.5.0")).toBe(false);
    expect(wantsColor(q("NO_COLOR=1"), "curl/8.5.0")).toBe(false);
    expect(wantsColor(q("color=1"), "Wget/1.21")).toBe(true);
  });

  it("clamps the width", () => {
    expect(parseWidth(new URLSearchParams(""))).toBe(80);
    expect(parseWidth(new URLSearchParams("width=100"))).toBe(100);
    expect(parseWidth(new URLSearchParams("w=5"))).toBe(40);
    expect(parseWidth(new URLSearchParams("width=9999"))).toBe(200);
    expect(parseWidth(new URLSearchParams("width=abc"))).toBe(80);
  });
});

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
