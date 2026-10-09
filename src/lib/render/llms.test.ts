import { describe, expect, it } from "vitest";
import { labs, profile, projects } from "@/content";
import { renderLlmsFullTxt, renderLlmsTxt } from "./llms";
import { renderMarkdown } from "./markdown";
import { pageEntries } from "./routes";

const ORIGIN = "https://example.test";

describe("llms.txt", () => {
  const txt = renderLlmsTxt(ORIGIN);

  it("follows the llms.txt layout: H1, blockquote, then H2 sections of link lists", () => {
    const lines = txt.split("\n");
    expect(lines[0]).toBe(`# ${profile.name}`);
    expect(lines[2].startsWith("> ")).toBe(true);
    expect(txt.match(/^# /gm)).toHaveLength(1);
    const sections = [...txt.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(sections).toEqual(["Projects", "Pages", "Labs", "Machine-readable", "Optional"]);
    for (const line of lines.filter((l) => l.startsWith("- "))) expect(line).toMatch(/^- \[[^\]]+\]\((https?:)[^)]+\)(: .+)?$/);
  });

  it("links the markdown twin of every page, plus resume.json and the MCP endpoint", () => {
    for (const p of projects) expect(txt).toContain(`(${ORIGIN}/work/${p.slug}.md)`);
    for (const l of labs) expect(txt).toContain(`(${ORIGIN}/labs/${l.slug}.md)`);
    expect(txt).toContain(`(${ORIGIN}/index.md)`);
    expect(txt).toContain(`(${ORIGIN}/cv.md)`);
    expect(txt).toContain(`(${ORIGIN}/resume.json)`);
    expect(txt).toContain(`(${ORIGIN}/api/mcp)`);
    expect(txt).toContain("get_project");
  });
});

describe("llms-full.txt", () => {
  it("concatenates the markdown of every page", () => {
    const full = renderLlmsFullTxt(ORIGIN);
    for (const p of pageEntries()) {
      expect(full).toContain(renderMarkdown(p.path, ORIGIN).body.trimEnd());
    }
  });
});
