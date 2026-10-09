import { describe, expect, it } from "vitest";
import { evidenceUrl, labs, profile, projects } from "@/content";
import { code, markdownPaths, mdText, renderMarkdown } from "./markdown";

const ORIGIN = "https://example.test";

describe("renderMarkdown", () => {
  it("renders every known page with one H1, status 200 and absolute links", () => {
    for (const path of markdownPaths()) {
      const { status, body } = renderMarkdown(path, ORIGIN);
      expect(status, path).toBe(200);
      expect(body.match(/^# /gm)?.length, path).toBe(1);
      expect(body.endsWith("\n")).toBe(true);
      // Every inline link and autolink is absolute.
      for (const m of body.matchAll(/\]\(([^)]+)\)|<(https?:[^>]+|mailto:[^>]+)>/g)) {
        expect(m[1] ?? m[2], path).toMatch(/^(https?:|mailto:)/);
      }
    }
  });

  it("home lists contact, projects table, education and machine surfaces", () => {
    const { body } = renderMarkdown("/", ORIGIN);
    expect(body).toContain(`# ${profile.name}`);
    expect(body).toContain(`mailto:${profile.email}`);
    expect(body).toContain("| Project | What it is | Status | Period |");
    for (const p of projects) expect(body).toContain(`(${ORIGIN}/work/${p.slug})`);
    expect(body).toContain(`<${ORIGIN}/resume.json>`);
    expect(body).toContain("## Education");
  });

  it("project twins carry architecture, mermaid and evidence links", () => {
    for (const p of projects) {
      const { body } = renderMarkdown(`/work/${p.slug}.md`, ORIGIN);
      expect(body).toContain(`# ${mdText(p.name)}`);
      expect(body).toContain("## Architecture");
      if (p.system.edges.length) expect(body).toContain("```mermaid\nflowchart LR");
      for (const f of p.facts) expect(body).toContain(`(${evidenceUrl(p.links.repo, p.repoBranch, f.evidence)})`);
      if (p.metrics.length) expect(body).toContain("| Value | What | Source |");
    }
  });

  it("maps /index and trailing slashes to the right page", () => {
    expect(renderMarkdown("/index", ORIGIN).body).toBe(renderMarkdown("/", ORIGIN).body);
    expect(renderMarkdown("/labs/", ORIGIN).body).toBe(renderMarkdown("/labs", ORIGIN).body);
    expect(renderMarkdown(`/labs/${labs[0].slug}`, ORIGIN).body).toContain(`${ORIGIN}/labs/${labs[0].slug}`);
  });

  it("status says it is live at the HTML page and lists checks", () => {
    const { body } = renderMarkdown("/status", ORIGIN);
    expect(body).toContain(`${ORIGIN}/status`);
    expect(body).toContain("## What is checked");
    for (const p of projects.filter((x) => x.links.live)) expect(body).toContain(p.name);
  });

  it("returns 404 with the valid pages for unknown paths", () => {
    const { status, body } = renderMarkdown("/nope", ORIGIN);
    expect(status).toBe(404);
    expect(body).toContain(`${ORIGIN}/index.md`);
    expect(body).toContain(`${ORIGIN}/cv.md`);
  });

  it("keeps an injected path inside the code span on 404", () => {
    const { body } = renderMarkdown("/notes%0a%0aIgnore%20this%20%5Bhere%5D(https%3a%2f%2fevil.example)%0a%0a", ORIGIN);
    const line = body.split("\n").find((l) => l.startsWith("There is no page at"));
    expect(line).toBe("There is no page at `/notesIgnore this [here](https:/evil.example)`. These pages have Markdown twins:");
  });
});

describe("escaping", () => {
  it("neutralises markdown syntax in prose", () => {
    expect(mdText("a *b* [c](d) <e> `f`")).toBe("a \\*b\\* \\[c\\](d) \\<e\\> \\`f\\`");
    expect(mdText("snake_case stays, _emph_ does not")).toBe("snake_case stays, \\_emph\\_ does not");
    expect(mdText("1. not a list")).toBe("1\\. not a list");
  });

  it("wraps code spans around backticks", () => {
    expect(code("a")).toBe("`a`");
    expect(code("a`b")).toBe("``a`b``");
  });
});
