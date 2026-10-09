/**
 * Markdown twins of every page (CommonMark + GFM tables). Served at `<path>.md`
 * and to clients that send `Accept: text/markdown`. Everything is rendered from
 * `@/content`; links are absolute so the text stands on its own.
 */
import {
  achievements,
  education,
  evidenceUrl,
  getProject,
  labs,
  profile,
  projects,
  protocolClass,
  skills,
  type Project,
} from "@/content";
import { SITE_URL } from "@/lib/site";
import { absUrl, mdUrl, normalizePath, pageEntries, statusLabel } from "./routes";

export interface RenderResult {
  status: number;
  body: string;
}

/* ------------------------------------------------------------------ escaping */

/** Escape prose so content can never turn into unintended markdown. */
export function mdText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/([*`[\]<>])/g, "\\$1")
    .replace(/(^|[^A-Za-z0-9])_|_(?=[^A-Za-z0-9]|$)/g, (m) => m.replace("_", "\\_"))
    .replace(/\r?\n+/g, " ")
    .replace(/^(\d+)([.)])(\s)/, "$1\\$2$3")
    .replace(/^([-+#])(\s)/, "\\$1$2");
}

/** Inline code span that survives backticks inside the value. */
export function code(s: string): string {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${fence}${pad}${s}${pad}${fence}`;
}

function cell(s: string): string {
  return mdText(s).replace(/\|/g, "\\|");
}

function codeCell(s: string): string {
  return code(s).replace(/\|/g, "\\|");
}

function safeUrl(url: string): string {
  return url.replace(/[()<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

function link(text: string, url: string): string {
  return `[${mdText(text)}](${safeUrl(url)})`;
}

/** CommonMark autolink: renders as a clickable URL everywhere, not only in GFM. */
function auto(url: string): string {
  return `<${safeUrl(url)}>`;
}

function table(head: string[], rows: string[][]): string {
  const sep = head.map(() => "---");
  return [head, sep, ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

function bullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

/** Mermaid ids must be plain words; labels are quoted with `"` replaced. */
function mermaidLabel(s: string): string {
  return `"${s.replace(/"/g, "#quot;").replace(/\|/g, "#124;").replace(/\r?\n/g, " ")}"`;
}

function mermaidId(id: string): string {
  return `n_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/* ------------------------------------------------------------------ pieces */

function footer(path: string, origin: string): string {
  return [
    "---",
    "",
    `HTML: ${auto(absUrl(path, origin))} · Markdown: ${auto(mdUrl(path, origin))} · Index for LLMs: ${auto(absUrl("/llms.txt", origin))}`,
  ].join("\n");
}

function contactList(origin: string): string {
  return bullets([
    `Email: [${profile.email}](mailto:${profile.email})`,
    `GitHub: ${link(profile.links.github.replace(/^https?:\/\//, ""), profile.links.github)}`,
    `LinkedIn: ${link(profile.links.linkedin.replace(/^https?:\/\//, ""), profile.links.linkedin)}`,
    `Résumé (PDF): ${link(absUrl(profile.resumePdf, origin), absUrl(profile.resumePdf, origin))}`,
  ]);
}

function educationList(): string {
  return bullets(
    education.map(
      (e) =>
        `**${mdText(e.degree)}**, ${mdText(e.school)}, ${mdText(e.place)}. ${mdText(e.period)}.${e.detail ? ` ${mdText(e.detail)}.` : ""}`,
    ),
  );
}

function achievementList(): string {
  return bullets(achievements.map((a) => `**${mdText(a.title)}**, ${mdText(a.org)}${a.period ? ` (${mdText(a.period)})` : ""}. ${mdText(a.detail)}`));
}

function skillList(): string {
  return bullets(skills.map((s) => `**${mdText(s.label)}:** ${s.items.map(mdText).join(", ")}`));
}

function projectsTable(origin: string): string {
  return table(
    ["Project", "What it is", "Status", "Period"],
    projects.map((p) => [
      `[${cell(p.name)}](${absUrl(`/work/${p.slug}`, origin)})`,
      cell(p.tagline),
      cell(statusLabel(p.status)),
      cell(p.period.label),
    ]),
  );
}

function machineSurfaces(origin: string): string {
  return bullets([
    `Markdown twin of any page: append \`.md\` to its path (home is ${auto(mdUrl("/", origin))}) or send \`Accept: text/markdown\`.`,
    `Terminal: \`curl ${absUrl("/", origin)}\` (add \`?plain=1\` for no colour).`,
    `JSON Resume (v1.0.0): ${auto(absUrl("/resume.json", origin))}`,
    `LLM index: ${auto(absUrl("/llms.txt", origin))}, and every page in one file: ${auto(absUrl("/llms-full.txt", origin))}`,
    `MCP server (Streamable HTTP, read-only tools): \`POST ${absUrl("/api/mcp", origin)}\``,
  ]);
}

/* ------------------------------------------------------------------ pages */

function renderHome(origin: string): string {
  const out: string[] = [
    `# ${mdText(profile.name)}`,
    "",
    `**${mdText(profile.role)}** · ${mdText(profile.location)}`,
    "",
    `> ${mdText(profile.pitch)}`,
    "",
    ...profile.about.flatMap((p) => [mdText(p), ""]),
    `**Availability:** ${mdText(profile.availability)}`,
    "",
    "## Contact",
    "",
    contactList(origin),
    "",
    "## Projects",
    "",
    projectsTable(origin),
    "",
  ];
  for (const p of projects) {
    out.push(
      `### ${mdText(p.name)}`,
      "",
      `**${mdText(p.headline)}**`,
      "",
      mdText(p.summary),
      "",
      `Stack: ${p.stack.map(mdText).join(", ")}.`,
      "",
      [
        link("Case study", absUrl(`/work/${p.slug}`, origin)),
        link("Markdown", mdUrl(`/work/${p.slug}`, origin)),
        link("Repository", p.links.repo),
        ...(p.links.live ? [link("Live", p.links.live)] : []),
        link(`Lab: ${p.lab.title}`, absUrl(`/labs/${p.lab.slug}`, origin)),
      ].join(" · "),
      "",
    );
  }
  out.push(
    "## Labs",
    "",
    bullets(labs.map((l) => `${link(l.title, absUrl(`/labs/${l.slug}`, origin))} (${l.kind}, ${mdText(l.projectName)}): ${mdText(l.blurb)}`)),
    "",
    "## Education",
    "",
    educationList(),
    "",
    "## Achievements",
    "",
    achievementList(),
    "",
    "## Skills",
    "",
    skillList(),
    "",
    "## Machine-readable",
    "",
    machineSurfaces(origin),
    "",
    footer("/", origin),
  );
  return out.join("\n");
}

function architectureBlock(p: Project): string[] {
  const nodes = new Map(p.system.nodes.map((n) => [n.id, n]));
  const name = (id: string) => nodes.get(id)?.label ?? id;
  const out: string[] = [];
  if (p.caseStudy.architecture) out.push(mdText(p.caseStudy.architecture), "");
  if (p.system.nodes.length) {
    out.push(
      "### Components",
      "",
      table(
        ["Component", "Kind", "Technology", "Responsibility"],
        p.system.nodes.map((n) => [codeCell(n.label), cell(n.kind), cell(n.tech), n.note ? cell(n.note) : ""]),
      ),
      "",
    );
  }
  if (p.system.edges.length) {
    out.push(
      "### Connections",
      "",
      "Sync = request/response call, async = message, data = data-store access.",
      "",
      bullets(
        p.system.edges.map(
          (e) => `${code(name(e.from))} → ${code(name(e.to))} over **${e.protocol}** (${protocolClass[e.protocol]}): ${code(e.label)}`,
        ),
      ),
      "",
      "```mermaid",
      "flowchart LR",
      ...p.system.nodes.map((n) => `  ${mermaidId(n.id)}[${mermaidLabel(n.label)}]`),
      ...p.system.edges.map((e) => {
        const arrow = protocolClass[e.protocol] === "sync" ? "-->" : "-.->";
        return `  ${mermaidId(e.from)} ${arrow}|${mermaidLabel(`${e.protocol}: ${e.label}`)}| ${mermaidId(e.to)}`;
      }),
      "```",
      "",
    );
  }
  return out;
}

export function renderProjectMarkdown(p: Project, origin: string = SITE_URL): string {
  const cs = p.caseStudy;
  const facts: string[] = [
    `| Status | ${cell(statusLabel(p.status))} |`,
    `| Period | ${cell(p.period.label)} |`,
    `| Stack | ${cell(p.stack.join(", "))} |`,
    `| Repository | ${auto(p.links.repo)} |`,
    ...(p.links.live ? [`| Live | ${auto(p.links.live)} |`] : []),
    `| Lab | [${cell(p.lab.title)}](${absUrl(`/labs/${p.lab.slug}`, origin)}) (${p.lab.kind}) |`,
  ];
  const out: string[] = [
    `# ${mdText(p.name)}`,
    "",
    `${mdText(p.tagline)}.`,
    "",
    `> ${mdText(p.headline)}`,
    "",
    mdText(p.summary),
    "",
    "| | |",
    "|---|---|",
    ...facts,
    "",
  ];
  if (p.metrics.length) {
    out.push("## Numbers", "", table(["Value", "What", "Source"], p.metrics.map((m) => [cell(m.value), cell(m.label), cell(m.source)])), "");
  }
  if (cs.intro || cs.problem.length) {
    out.push("## The problem", "", ...[cs.intro, ...cs.problem].filter(Boolean).flatMap((t) => [mdText(t), ""]));
  }
  if (cs.constraints.length) out.push("## What made it hard", "", bullets(cs.constraints.map(mdText)), "");
  out.push("## Architecture", "", ...architectureBlock(p));
  if (cs.decisions.length) {
    out.push(
      "## Decisions and trade-offs",
      "",
      bullets(cs.decisions.map((d) => `**${d.kind === "choice" ? "Choice" : "Trade-off"}:** ${mdText(d.text)}`)),
      "",
    );
  }
  if (cs.result) out.push("## Where it stands", "", mdText(cs.result), "");
  if (cs.nextSteps.length) out.push("## Next steps", "", bullets(cs.nextSteps.map(mdText)), "");
  if (p.facts.length) {
    out.push(
      "## Evidence",
      "",
      `Each claim cites a file and line in ${link(p.links.repo.replace(/^https?:\/\//, ""), p.links.repo)} (branch ${code(p.repoBranch)}).`,
      "",
      bullets(p.facts.map((f) => `${mdText(f.claim)} ([${code(f.evidence)}](${evidenceUrl(p.links.repo, p.repoBranch, f.evidence)}))`)),
      "",
    );
  }
  out.push(
    "## Lab",
    "",
    `${link(p.lab.title, absUrl(`/labs/${p.lab.slug}`, origin))} (${p.lab.kind}): ${mdText(p.lab.blurb)}`,
    "",
    footer(`/work/${p.slug}`, origin),
  );
  return out.join("\n");
}

function renderCv(origin: string): string {
  const out: string[] = [
    `# ${mdText(profile.name)}: CV`,
    "",
    `**${mdText(profile.role)}** · ${mdText(profile.location)}`,
    "",
    mdText(profile.pitch),
    "",
    contactList(origin),
    "",
    "## Education",
    "",
    educationList(),
    "",
    "## Projects",
    "",
  ];
  for (const p of projects) {
    out.push(
      `### ${link(p.name, absUrl(`/work/${p.slug}`, origin))}: ${mdText(p.tagline)}`,
      "",
      `${mdText(p.period.label)} · ${mdText(statusLabel(p.status))} · ${p.stack.map(mdText).join(", ")}`,
      "",
      bullets([
        mdText(p.summary),
        ...p.metrics.map((m) => `${mdText(m.value)} ${mdText(m.label)} (${mdText(m.source)}).`),
        ...p.caseStudy.decisions.filter((d) => d.kind === "choice").map((d) => mdText(d.text)),
      ]),
      "",
    );
  }
  out.push(
    "## Achievements",
    "",
    achievementList(),
    "",
    "## Skills",
    "",
    skillList(),
    "",
    `Machine-readable version: ${auto(absUrl("/resume.json", origin))} (JSON Resume v1.0.0).`,
    "",
    footer("/cv", origin),
  );
  return out.join("\n");
}

function labKindNote(kind: "simulation" | "in-browser"): string {
  return kind === "simulation"
    ? "Simulation: a deterministic model of the real mechanism, using real identifiers from the project's repository."
    : "In-browser: real computation that runs on your device.";
}

function renderLabs(origin: string): string {
  return [
    "# Labs",
    "",
    "One safe-to-break lab per project. Labs are interactive, so open them in a browser.",
    "",
    table(
      ["Lab", "Kind", "Project", "What you can do"],
      labs.map((l) => [
        `[${cell(l.title)}](${absUrl(`/labs/${l.slug}`, origin)})`,
        cell(l.kind),
        `[${cell(l.projectName)}](${absUrl(`/work/${l.project}`, origin)})`,
        cell(l.blurb),
      ]),
    ),
    "",
    "- **simulation**: " + labKindNote("simulation").replace(/^Simulation: /, ""),
    "- **in-browser**: " + labKindNote("in-browser").replace(/^In-browser: /, ""),
    "",
    footer("/labs", origin),
  ].join("\n");
}

function renderLab(slug: string, origin: string): string | null {
  const l = labs.find((x) => x.slug === slug);
  if (!l) return null;
  return [
    `# ${mdText(l.title)}`,
    "",
    mdText(l.blurb),
    "",
    labKindNote(l.kind),
    "",
    `Part of ${link(l.projectName, absUrl(`/work/${l.project}`, origin))} (case study as Markdown: ${auto(mdUrl(`/work/${l.project}`, origin))}).`,
    "",
    `This lab is interactive. Open it in a browser: ${auto(absUrl(`/labs/${l.slug}`, origin))}`,
    "",
    footer(`/labs/${l.slug}`, origin),
  ].join("\n");
}

function renderStatus(origin: string): string {
  const live = projects.filter((p) => p.links.live);
  return [
    "# Status",
    "",
    `Status is measured live, so read it at ${auto(absUrl("/status", origin))} or as JSON at ${auto(absUrl("/api/health", origin))}. This Markdown twin lists what is checked.`,
    "",
    "## What is checked",
    "",
    bullets([
      ...live.map(
        (p) =>
          `**${mdText(p.name)}** (${auto(p.links.live ?? "")}): an HTTP check from the server with a short timeout, cached for 60 seconds. Reports health (ok, warn, crit or unknown), latency and HTTP status.`,
      ),
      "**This site**: the build commit and the region that served the request.",
    ]),
    "",
    "`unknown` means the check could not run. It never means \"probably fine\". Nothing here is invented: there are no uptime or traffic numbers that were not measured.",
    "",
    footer("/status", origin),
  ].join("\n");
}

function renderColophon(origin: string): string {
  return [
    "# Colophon",
    "",
    "This portfolio behaves like the infrastructure it describes: it traces the request that served it, reports its own health, lets you break simulated systems safely, and answers to curl and to AI agents as well as browsers.",
    "",
    "## Built with",
    "",
    bullets([
      "Next.js 16 (App Router) and React 19, written in TypeScript",
      "Tailwind CSS 4 with design tokens; three.js for the live topology",
      "zod for validation and vitest for tests",
      "Type: Archivo, IBM Plex Sans and JetBrains Mono",
    ]),
    "",
    "## Request trace",
    "",
    "Every page response carries `x-request-id` and a `Server-Timing` header with the proxy duration, the request id and the serving region. Browsers expose it through `performance.getEntriesByType(\"navigation\")[0].serverTiming`.",
    "",
    "## Machine-readable surfaces",
    "",
    machineSurfaces(origin),
    "",
    "## Honesty rules",
    "",
    [
      "1. Every number has a source, and every project fact cites a file and line in that project's repository.",
      "2. Labs are labelled simulation (a deterministic model of the real mechanism) or in-browser (real computation on your device).",
      "3. Anything unmeasured shows as unknown. No invented traffic, uptime or latency.",
    ].join("\n"),
    "",
    footer("/colophon", origin),
  ].join("\n");
}

function renderNotFound(path: string, origin: string): string {
  return [
    "# 404 not found",
    "",
    `There is no page at ${code(path)}. These pages have Markdown twins:`,
    "",
    bullets(pageEntries().map((e) => `${link(e.title, mdUrl(e.path, origin))}: ${code(e.path)}`)),
    "",
  ].join("\n");
}

/**
 * Render the markdown twin of a site path.
 * Accepts `/`, `/index`, `/work/<slug>`, `/cv`, `/labs`, `/labs/<lab>`, `/status`, `/colophon`
 * (with or without a `.md` suffix). Unknown paths return status 404 with a list of valid pages.
 */
export function renderMarkdown(rawPath: string, origin: string = SITE_URL): RenderResult {
  const path = normalizePath(rawPath);
  let body: string | null = null;
  if (path === "/") body = renderHome(origin);
  else if (path === "/cv") body = renderCv(origin);
  else if (path === "/labs") body = renderLabs(origin);
  else if (path === "/status") body = renderStatus(origin);
  else if (path === "/colophon") body = renderColophon(origin);
  else if (path.startsWith("/work/")) {
    const p = getProject(path.slice("/work/".length));
    if (p) body = renderProjectMarkdown(p, origin);
  } else if (path.startsWith("/labs/")) {
    body = renderLab(path.slice("/labs/".length), origin);
  }
  if (body === null) return { status: 404, body: ensureTrailingNewline(renderNotFound(path, origin)) };
  return { status: 200, body: ensureTrailingNewline(body) };
}

/** Every path that has a markdown twin, in reading order. */
export function markdownPaths(): string[] {
  return pageEntries().map((e) => e.path);
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}
