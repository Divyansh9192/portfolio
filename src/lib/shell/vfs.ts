/**
 * Virtual filesystem for the ⌘K shell, generated from the typed content in @/content.
 * Every directory maps to a site route, so the shell's working directory can mirror the URL.
 *
 *   /                 about.md  contact.md  resume.pdf -> /resume.pdf
 *   /work/<slug>/     README.md  ARCHITECTURE.md  DECISIONS.md  FACTS.md
 *   /labs/<lab>/      README.md
 *   /cv/              education.md  achievements.md  skills.md  resume.pdf
 *   /status/          README.md
 *   /colophon/        README.md
 */

import type { Achievement, EducationItem, LabRef, Profile, Project, ProjectSlug, SkillGroup } from "@/content";
import { protocolClass } from "@/content";

export interface VDir {
  type: "dir";
  name: string;
  path: string;
  /** Site route this directory corresponds to. */
  route: string;
  /** One line shown by `ls -l` and completion hints. */
  summary: string;
  children: VNode[];
}

export interface VFile {
  type: "file";
  name: string;
  path: string;
  /** Page (and anchor) that shows the same content, if any. */
  route?: string;
  content: string;
}

export interface VLink {
  type: "link";
  name: string;
  path: string;
  /** Static file the link points to, e.g. "/resume.pdf". */
  target: string;
}

export type VNode = VDir | VFile | VLink;

export interface VfsSource {
  profile: Profile;
  projects: Project[];
  labs: (LabRef & { project: ProjectSlug; projectName: string })[];
  education: EducationItem[];
  achievements: Achievement[];
  skills: SkillGroup[];
  /** Build a GitHub URL for a Fact.evidence. */
  evidenceUrl: (repo: string, branch: string, evidence: string) => string;
}

/* ------------------------------------------------------------------ */
/* Path helpers                                                        */
/* ------------------------------------------------------------------ */

/** Resolve `input` against `cwd` into a normalised absolute path ("/a/b"). "~" is the root. */
export function resolvePath(cwd: string, input: string): string {
  let raw = input.trim();
  if (raw === "" || raw === "~") return "/";
  if (raw.startsWith("~/")) raw = raw.slice(1);
  const base = raw.startsWith("/") ? [] : cwd.split("/").filter(Boolean);
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") base.pop();
    else base.push(seg);
  }
  return "/" + base.join("/");
}

export function parentPath(path: string): string {
  const segs = path.split("/").filter(Boolean);
  segs.pop();
  return "/" + segs.join("/");
}

export function lookup(root: VDir, path: string): VNode | undefined {
  let node: VNode = root;
  for (const seg of path.split("/").filter(Boolean)) {
    if (node.type !== "dir") return undefined;
    const next: VNode | undefined = node.children.find((c) => c.name === seg);
    if (!next) return undefined;
    node = next;
  }
  return node;
}

/** Path part of a route: "/#work" -> "/", "/work/x#facts" -> "/work/x". */
export function pathnameOf(route: string): string {
  const p = route.split("#")[0].split("?")[0];
  return p === "" ? "/" : p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** Map a URL pathname to the deepest matching directory. Unknown paths fall back to the nearest ancestor. */
export function dirForPathname(root: VDir, pathname: string): string {
  let clean = pathnameOf(pathname || "/");
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // keep the raw pathname if it isn't valid percent-encoding
  }
  clean = clean.replace(/\.md$/, "");
  let node: VDir = root;
  for (const seg of clean.split("/").filter(Boolean)) {
    const next = node.children.find((c): c is VDir => c.type === "dir" && c.name === seg);
    if (!next) break;
    node = next;
  }
  return node.path;
}

/** The route a node opens, if it has one. */
export function routeOf(node: VNode): string | undefined {
  if (node.type === "dir") return node.route;
  if (node.type === "file") return node.route;
  return node.target;
}

export function byteSize(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Every route in the tree (for linkifying output and completing `curl`). */
export function allRoutes(root: VDir): string[] {
  const out = new Set<string>();
  const walk = (n: VNode) => {
    const r = routeOf(n);
    if (r) out.add(r);
    if (n.type === "dir") n.children.forEach(walk);
  };
  walk(root);
  return [...out];
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

function dir(path: string, route: string, summary: string, children: VNode[]): VDir {
  const name = path === "/" ? "/" : path.split("/").filter(Boolean).pop()!;
  return { type: "dir", name, path, route, summary, children };
}

function file(parent: string, name: string, content: string, route?: string): VFile {
  return { type: "file", name, path: join(parent, name), route, content: content.replace(/\n{3,}/g, "\n\n").trim() + "\n" };
}

function link(parent: string, name: string, target: string): VLink {
  return { type: "link", name, path: join(parent, name), target };
}

function join(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

function bullets(items: string[], empty: string): string {
  return items.length ? items.map((s) => `- ${s}`).join("\n") : empty;
}

function kv(rows: [string, string | undefined][]): string {
  const present = rows.filter((r): r is [string, string] => Boolean(r[1]));
  const w = Math.max(...present.map(([k]) => k.length));
  return present.map(([k, v]) => `${k.padEnd(w)}  ${v}`).join("\n");
}

function projectFiles(p: Project, src: VfsSource): VNode[] {
  const base = `/work/${p.slug}`;
  const nodeLabel = (id: string) => p.system.nodes.find((n) => n.id === id)?.label ?? id;
  const decisions = p.caseStudy.decisions;

  const readme = `# ${p.name}
${p.tagline}

${p.summary}

${p.headline}

${kv([
  ["Status", p.status],
  ["Period", p.period.label],
  ["Stack", p.stack.join(", ")],
  ["Repo", p.links.repo],
  ["Live", p.links.live],
  ["Lab", `/labs/${p.lab.slug} (${p.lab.kind})`],
  ["Page", base],
])}

## Metrics
${bullets(
  p.metrics.map((m) => `${m.value}  ${m.label} (source: ${m.source})`),
  "No measured numbers published yet.",
)}

## Files
${kv([
  ["ARCHITECTURE.md", "components and how they connect"],
  ["DECISIONS.md", "choices, trade-offs and next steps"],
  ["FACTS.md", "claims, each linked to a line of code"],
])}`;

  const architecture = `# ${p.name}: architecture

${p.caseStudy.architecture}

## Components (${p.system.nodes.length})
${bullets(
  p.system.nodes.map((n) => `${n.label} [${n.kind}] ${n.tech}${n.note ? `: ${n.note}` : ""}`),
  "None listed.",
)}

## Connections (${p.system.edges.length})
${bullets(
  p.system.edges.map((e) => `${nodeLabel(e.from)} → ${nodeLabel(e.to)} [${protocolClass[e.protocol]}] ${e.protocol}: ${e.label}`),
  "None listed.",
)}

Key: [sync] a synchronous call (solid line) · [async] a message (dashed line) · [data] a data store (dotted line)`;

  const decisionsMd = `# ${p.name}: decisions

## Choices
${bullets(decisions.filter((d) => d.kind === "choice").map((d) => d.text), "None published yet.")}

## Trade-offs
${bullets(decisions.filter((d) => d.kind === "tradeoff").map((d) => d.text), "None published yet.")}

## Next steps
${bullets(p.caseStudy.nextSteps, "None published yet.")}`;

  const facts = `# ${p.name}: facts

Each claim links to the line of code that backs it.

${
  p.facts.length
    ? p.facts.map((f) => `- ${f.claim}\n  ${src.evidenceUrl(p.links.repo, p.repoBranch, f.evidence)}`).join("\n")
    : "No source-cited facts published yet."
}`;

  return [
    file(base, "README.md", readme, base),
    file(base, "ARCHITECTURE.md", architecture, `${base}#architecture`),
    file(base, "DECISIONS.md", decisionsMd, `${base}#decisions`),
    file(base, "FACTS.md", facts, `${base}#evidence`),
  ];
}

/** Build the whole tree. Pure: same content in, same tree out. */
export function buildVfs(src: VfsSource): VDir {
  const { profile } = src;

  const work = dir(
    "/work",
    "/#work",
    `${src.projects.length} projects`,
    src.projects.map((p) => dir(`/work/${p.slug}`, `/work/${p.slug}`, p.tagline, projectFiles(p, src))),
  );

  const labsDir = dir("/labs", "/labs", `${src.labs.length} labs, one per project`, [
    file(
      "/labs",
      "README.md",
      `# Labs

One lab per project. Simulations model the real mechanism with identifiers from the repo; in-browser labs run real computation on your device.

${bullets(
  src.labs.map((l) => `/labs/${l.slug}  ${l.title} (${l.kind}, from ${l.projectName})`),
  "No labs yet.",
)}`,
      "/labs",
    ),
    ...src.labs.map((l) =>
      dir(`/labs/${l.slug}`, `/labs/${l.slug}`, l.title, [
        file(
          `/labs/${l.slug}`,
          "README.md",
          `# ${l.title}
${l.kind === "simulation" ? "Simulation" : "Runs in your browser"} · from ${l.projectName}

${l.blurb}

${kv([
  ["Project", `/work/${l.project}`],
  ["Open", `/labs/${l.slug}`],
])}`,
          `/labs/${l.slug}`,
        ),
      ]),
    ),
  ]);

  const cv = dir("/cv", "/cv", "resume as a page", [
    file(
      "/cv",
      "education.md",
      `# Education

${src.education.map((e) => `- ${e.degree}, ${e.school} (${e.place}). ${e.period}.${e.detail ? ` ${e.detail}.` : ""}`).join("\n")}`,
      "/cv#education",
    ),
    file(
      "/cv",
      "achievements.md",
      `# Achievements

${src.achievements.map((a) => `- ${a.title}. ${a.org}. ${a.detail}`).join("\n")}`,
      "/cv#achievements",
    ),
    file("/cv", "skills.md", `# Skills\n\n${kv(src.skills.map((s) => [s.label, s.items.join(", ")]))}`, "/cv#skills"),
    link("/cv", "resume.pdf", profile.resumePdf),
  ]);

  const status = dir("/status", "/status", "live health of the systems", [
    file(
      "/status",
      "README.md",
      `# Status

Live health of the deployed systems behind this site, measured server-side and cached for 60 seconds.
Anything that could not be checked shows as unknown.

Run status to fetch /api/health now, or open /status for the page.`,
      "/status",
    ),
  ]);

  const colophon = dir("/colophon", "/colophon", "how this site is built", [
    file(
      "/colophon",
      "README.md",
      `# Colophon

This site is built like the systems it describes. It traces the request that served it, reports its own health, and answers to curl and to AI agents as well as browsers.

${kv([
  ["Framework", "Next.js 16 (App Router), React 19, TypeScript"],
  ["Styling", "Tailwind CSS 4 with design tokens"],
  ["Type", "Archivo, IBM Plex Sans, JetBrains Mono"],
  ["Tests", "vitest"],
  ["This shell", "src/lib/shell: parser, virtual filesystem and executor"],
])}

The filesystem you are browsing is generated from the same typed content as the pages, so the two cannot drift apart.`,
      "/colophon",
    ),
  ]);

  const about = file(
    "/",
    "about.md",
    `# ${profile.name}
${profile.role} · ${profile.location}

${profile.pitch}

${profile.about.join("\n\n")}

## Availability
${profile.availability}`,
    "/#about",
  );

  const contact = file(
    "/",
    "contact.md",
    `# Contact

${kv([
  ["Email", profile.email],
  ["GitHub", profile.links.github],
  ["LinkedIn", profile.links.linkedin],
  ["Resume", profile.resumePdf],
])}

${profile.availability}`,
    "/#contact",
  );

  return dir("/", "/", "home", [work, labsDir, cv, status, colophon, about, contact, link("/", "resume.pdf", profile.resumePdf)]);
}
