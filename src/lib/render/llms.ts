/**
 * /llms.txt (https://llmstxt.org) and /llms-full.txt, built from the same page
 * inventory and markdown twins as the rest of the site.
 */
import { labs, profile, projects } from "@/content";
import { SITE_URL } from "@/lib/site";
import { mdText, renderMarkdown } from "./markdown";
import { absUrl, mdUrl, pageEntries } from "./routes";
import { MCP_TOOL_NAMES } from "@/lib/mcp/server";

function item(title: string, url: string, note?: string): string {
  return `- [${mdText(title)}](${url})${note ? `: ${mdText(note)}` : ""}`;
}

export function renderLlmsTxt(origin: string = SITE_URL): string {
  const pages = pageEntries();
  const page = (kind: string) => pages.find((p) => p.kind === kind);
  const home = page("home");
  const cv = page("cv");
  const labsPage = page("labs");
  const status = page("status");
  const colophon = page("colophon");

  const lines: string[] = [
    `# ${mdText(profile.name)}`,
    "",
    `> ${mdText(`${profile.role} based in ${profile.location}. ${profile.pitch}`)}`,
    "",
    mdText(profile.availability) + ` Contact: ${profile.email}.`,
    "",
    "Every metric on this site names its source, and every project fact cites a file and line in that project's repository. Links below point to Markdown twins of the HTML pages: drop the `.md` suffix for the HTML version.",
    "",
    "## Projects",
    "",
    ...projects.map((p) => item(p.name, mdUrl(`/work/${p.slug}`, origin), `${p.tagline}. ${p.headline} (${p.period.label}, ${p.status.replace(/-/g, " ")})`)),
    "",
    "## Pages",
    "",
    ...[home, cv, labsPage, status, colophon]
      .filter((p) => p !== undefined)
      .map((p) => item(p.kind === "home" ? "Home" : p.title, mdUrl(p.path, origin), p.description)),
    "",
    "## Labs",
    "",
    ...labs.map((l) => item(l.title, mdUrl(`/labs/${l.slug}`, origin), `${l.blurb} (${l.kind}, ${l.projectName})`)),
    "",
    "## Machine-readable",
    "",
    item("resume.json", absUrl("/resume.json", origin), "JSON Resume v1.0.0: basics, education, awards, skills and projects"),
    item(
      "MCP server",
      absUrl("/api/mcp", origin),
      `Model Context Protocol over Streamable HTTP, stateless and read-only. POST JSON-RPC 2.0. Tools: ${MCP_TOOL_NAMES.join(", ")}`,
    ),
    item("llms-full.txt", absUrl("/llms-full.txt", origin), "every page above as Markdown in one file"),
    "",
    "## Optional",
    "",
    item("GitHub", profile.links.github, "source code for every project"),
    item("LinkedIn", profile.links.linkedin),
    item("Résumé (PDF)", absUrl(profile.resumePdf, origin)),
    "",
  ];
  return lines.join("\n");
}

export function renderLlmsFullTxt(origin: string = SITE_URL): string {
  const parts: string[] = [
    `# ${mdText(profile.name)}: every page as Markdown`,
    "",
    `> ${mdText(`${profile.role} based in ${profile.location}. ${profile.pitch}`)}`,
    "",
    `This file concatenates the Markdown twin of every page on ${absUrl("/", origin)}. Each page starts after a horizontal rule with its source URL. The index is at ${absUrl("/llms.txt", origin)}.`,
    "",
  ];
  for (const p of pageEntries()) {
    parts.push("---", "", `Source: ${mdUrl(p.path, origin)}`, "", renderMarkdown(p.path, origin).body.trimEnd(), "");
  }
  return parts.join("\n");
}
