/**
 * Built-in commands. Each returns structured lines and effects; none touches the DOM.
 */

import type { LabRef, Profile, Project, ProjectSlug } from "@/content";
import { protocolClass } from "@/content";
import type { SearchIndex } from "@/lib/search";
import { matchActions, type QuickAction } from "./actions";
import { ansiToLines } from "./ansi";
import type { CompletionSpec } from "./complete";
import { quoteArg } from "./parse";
import { blank, err, formatDuration, hint, inline, line, lineText, para, renderMarkdown, table } from "./render";
import { didYouMean } from "./suggest";
import type { Effect, Line, ShellIO, Span } from "./types";
import { byteSize, lookup, parentPath, pathnameOf, resolvePath, routeOf, type VDir, type VNode } from "./vfs";

export interface ShellEnv {
  root: VDir;
  profile: Profile;
  projects: Project[];
  labs: (LabRef & { project: ProjectSlug; projectName: string })[];
  index: SearchIndex;
  actions: QuickAction[];
  /** Every route in the filesystem (for completion and linkifying). */
  routes: string[];
  isRoute(path: string): boolean;
  commands: Map<string, CommandDef>;
}

export interface MutableState {
  cwd: string;
  oldCwd?: string;
  history: readonly string[];
}

export interface Invocation {
  name: string;
  args: string[];
  state: MutableState;
  io: ShellIO;
  env: ShellEnv;
  /** Lines piped in from the previous command (only grep reads them). */
  stdin?: Line[];
}

export interface CmdOutput {
  lines: Line[];
  effects?: Effect[];
  code?: number;
}

export type CommandGroup = "Navigate" | "Explore" | "Site" | "Shell";

export interface CommandDef {
  name: string;
  usage: string;
  summary: string;
  description: string[];
  examples?: string[];
  group: CommandGroup;
  complete?: CompletionSpec;
  run(inv: Invocation): CmdOutput | Promise<CmdOutput>;
}

export const USER = "divyansh";
export const HOST = "live-system";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const ok = (lines: Line[], effects?: Effect[]): CmdOutput => ({ lines, effects, code: 0 });
const fail = (lines: Line[], code = 1): CmdOutput => ({ lines, code });

function usageError(def: { name: string; usage: string }, message?: string): CmdOutput {
  return fail([...(message ? [err(`${def.name}: ${message}`)] : []), hint(`usage: ${def.usage}`)], 2);
}

function flags(args: string[]): { flags: Set<string>; rest: string[] } {
  const f = new Set<string>();
  const rest: string[] = [];
  for (const a of args) {
    if (/^-[a-zA-Z]+$/.test(a)) for (const c of a.slice(1)) f.add(c);
    else rest.push(a);
  }
  return { flags: f, rest };
}

function runSpan(text: string, run: string, tone: Span["tone"] = "link"): Span {
  return { text, run, tone };
}

function nodeDisplay(n: VNode): string {
  return n.type === "dir" ? `${n.name}/` : n.name;
}

function nodeAction(n: VNode, shownPath: string): string {
  if (n.type === "dir") return `cd ${shownPath}`;
  if (n.type === "link") return `open ${shownPath}`;
  return `cat ${shownPath}`;
}

function getProject(env: ShellEnv, slug: string | undefined): Project | undefined {
  return slug ? env.projects.find((p) => p.slug === slug) : undefined;
}

function stackSummary(stack: string[], n = 3): string {
  return stack.length > n ? `${stack.slice(0, n).join(", ")} +${stack.length - n}` : stack.join(", ");
}

/** Validate a URL for `open`: only http(s) and mailto, never javascript: or data:. */
export function safeExternal(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:") return u.href;
  } catch {
    // not a URL
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* commands                                                            */
/* ------------------------------------------------------------------ */

const help: CommandDef = {
  name: "help",
  usage: "help [command]",
  summary: "list commands, or show how to use one",
  description: ["With no argument, lists every command grouped by what it is for. With a command name, prints its usage line and summary. For the full page, use man <command>."],
  examples: ["help", "help grep"],
  group: "Shell",
  complete: { args: ["command"] },
  run({ args, env }) {
    if (args[0]) {
      const def = env.commands.get(args[0]);
      if (!def) return fail([err(`help: no help topic for ${args[0]}`), hint("type help to list every command")]);
      return ok([line(def.usage, "text", { pre: true }), line(def.summary, "text-2"), hint(`more: man ${def.name}`)]);
    }
    const groups: CommandGroup[] = ["Navigate", "Explore", "Site", "Shell"];
    const all = [...env.commands.values()];
    const w = Math.max(...all.map((c) => c.name.length)) + 2;
    const lines: Line[] = [line("Commands. Click one for its manual page, or run help <command> for its usage.", "text-2")];
    for (const g of groups) {
      lines.push(blank(), { spans: [{ text: g.toUpperCase(), tone: "text-3", bold: true }] });
      for (const c of all.filter((x) => x.group === g)) {
        lines.push({
          spans: [runSpan(c.name, `man ${c.name}`, "text"), { text: " ".repeat(w - c.name.length) }, { text: c.summary, tone: "text-2" }],
          indent: 2,
          hang: w,
        });
      }
    }
    lines.push(
      blank(),
      hint("Tab completes · ↑ ↓ history · Ctrl+L clears · Esc closes"),
      hint("Chain with && or ; · pipe into grep to filter, e.g. ls -l /work | grep orchrez"),
    );
    return ok(lines);
  },
};

const ls: CommandDef = {
  name: "ls",
  usage: "ls [-l] [path]",
  summary: "list a directory",
  description: [
    "Lists the files in a directory of this site. Directories end in a slash and match pages: /work/<project> is that case study, /labs/<lab> is that lab.",
    "-l prints one entry per line with permissions, size in bytes and a short description. Click an entry to open it.",
  ],
  examples: ["ls", "ls -l /work", "ls /labs"],
  group: "Navigate",
  complete: { args: ["path"] },
  run(inv) {
    const { flags: f, rest } = flags(inv.args);
    const bad = [...f].find((c) => c !== "l" && c !== "a");
    if (bad) return usageError(ls, `invalid option -- '${bad}'`);
    const targets = rest.length ? rest : ["."];
    const lines: Line[] = [];
    let code = 0;
    targets.forEach((t, i) => {
      const path = resolvePath(inv.state.cwd, t);
      const node = lookup(inv.env.root, path);
      if (!node) {
        lines.push(err(`ls: cannot access '${t}': No such file or directory`));
        code = 2;
        return;
      }
      if (targets.length > 1) lines.push(...(i ? [blank()] : []), line(`${t}:`, "text"));
      const entries = node.type === "dir" ? node.children : [node];
      const shown = (n: VNode) => (node.type === "dir" ? (t === "." ? n.name : `${t.replace(/\/$/, "")}/${n.name}`) : t);
      if (f.has("l")) {
        lines.push(
          ...table(
            [{ header: "MODE" }, { header: "OWNER" }, { header: "SIZE", align: "right" }, { header: "NAME" }, { header: "ABOUT", max: 48 }],
            entries.map((n) => [
              { text: n.type === "dir" ? "drwxr-xr-x" : n.type === "link" ? "lrwxrwxrwx" : "-rw-r--r--", tone: "text-3" },
              { text: USER, tone: "text-3" },
              { text: n.type === "file" ? String(byteSize(n.content)) : n.type === "dir" ? String(n.children.length) : "-", tone: "text-3" },
              { text: n.type === "link" ? `${n.name} -> ${n.target}` : nodeDisplay(n), tone: n.type === "dir" ? "text" : "text-2", bold: n.type === "dir", run: nodeAction(n, shown(n)) },
              { text: n.type === "dir" ? n.summary : n.type === "file" && n.route ? `page: ${n.route}` : n.type === "link" ? "download" : "", tone: "text-3" },
            ]),
          ),
        );
      } else {
        const spans: Span[] = [];
        entries.forEach((n, j) => {
          if (j) spans.push({ text: "  " });
          spans.push({ text: nodeDisplay(n), tone: n.type === "dir" ? "text" : "text-2", bold: n.type === "dir", run: nodeAction(n, shown(n)) });
        });
        lines.push({ spans });
      }
    });
    return { lines, code };
  },
};

const cd: CommandDef = {
  name: "cd",
  usage: "cd [dir]",
  summary: "change directory, and the page with it",
  description: [
    "Changes the working directory. The directory and the page are the same thing here, so cd /work/orchrez also opens the Orchrez case study behind the shell.",
    "cd with no argument (or ~) goes to /. cd - returns to the previous directory.",
  ],
  examples: ["cd /work/linkedin-clone", "cd ..", "cd -"],
  group: "Navigate",
  complete: { args: ["dir"] },
  run({ args, state, env }) {
    const target = args[0] ?? "/";
    if (args.length > 1) return usageError(cd, "too many arguments");
    if (target === "-" && !state.oldCwd) return fail([err("cd: OLDPWD not set")]);
    const path = target === "-" ? state.oldCwd! : resolvePath(state.cwd, target);
    const node = lookup(env.root, path);
    if (!node) return fail([err(`cd: no such file or directory: ${target}`)]);
    if (node.type !== "dir") return fail([err(`cd: not a directory: ${target}`), hint(node.type === "file" ? `try cat ${target}` : `try open ${target}`)]);
    if (path !== state.cwd) state.oldCwd = state.cwd;
    state.cwd = path;
    const lines: Line[] = target === "-" ? [line(path, "text-2")] : [];
    lines.push({ spans: [{ text: "page → ", tone: "text-3" }, { text: node.route, tone: "link", href: node.route }], stream: "hint" });
    return ok(lines, [{ type: "navigate", href: node.route }]);
  },
};

const pwd: CommandDef = {
  name: "pwd",
  usage: "pwd",
  summary: "print the working directory",
  description: ["Prints the working directory. It mirrors the page you are on: open the shell on a case study and you start in /work/<project>."],
  group: "Navigate",
  run: ({ state }) => ok([line(state.cwd, "text")]),
};

const cat: CommandDef = {
  name: "cat",
  usage: "cat <file>...",
  summary: "print a file",
  description: [
    "Prints files. Every file is generated from the same content as the pages: README.md is the summary, ARCHITECTURE.md the components and connections, DECISIONS.md the trade-offs, FACTS.md the claims with links to the code.",
  ],
  examples: ["cat /about.md", "cat /work/orchrez/README.md", "cat ARCHITECTURE.md | grep kafka"],
  group: "Navigate",
  complete: { args: ["path"] },
  run({ args, state, env }) {
    if (!args.length) return usageError(cat, "missing file operand");
    const lines: Line[] = [];
    let code = 0;
    for (const a of args) {
      const node = lookup(env.root, resolvePath(state.cwd, a));
      if (!node) {
        lines.push(err(`cat: ${a}: No such file or directory`));
        code = 1;
      } else if (node.type === "dir") {
        lines.push(err(`cat: ${a}: Is a directory`), { spans: [{ text: "try ", tone: "text-3" }, runSpan(`ls ${a}`, `ls ${a}`)], stream: "hint" });
        code = 1;
      } else if (node.type === "link") {
        lines.push({
          spans: [{ text: `cat: ${a}: binary file (PDF). `, tone: "text-2" }, runSpan(`open ${a}`, `open ${a}`), { text: " downloads it.", tone: "text-2" }],
        });
      } else {
        lines.push(...renderMarkdown(node.content, env.isRoute));
      }
    }
    return { lines, code };
  },
};

const open: CommandDef = {
  name: "open",
  usage: "open <path|url>",
  summary: "open a page, file or link",
  description: [
    "Opens what a path points to: a directory or file opens its page (README.md opens the case study, FACTS.md jumps to the evidence), resume.pdf downloads, and https:// or mailto: links open in a new tab or your mail app.",
    "With no argument, opens the page for the working directory.",
  ],
  examples: ["open /work/orchrez", "open FACTS.md", "open resume.pdf", "open https://github.com/Divyansh9192"],
  group: "Navigate",
  complete: { args: ["path"] },
  run({ args, state, env }) {
    const target = args[0] ?? ".";
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      const href = safeExternal(target);
      if (!href) return fail([err(`open: only http(s) and mailto links can be opened: ${target}`)]);
      const label = href.startsWith("mailto:") ? `Opening your mail app for ${href.slice(7)}` : `Opening ${href} in a new tab`;
      return ok([{ spans: [{ text: `${label} · `, tone: "text-2" }, { text: "link", tone: "link", href }] }], [{ type: "external", href }]);
    }
    const [pathPart, hash] = target.split("#");
    const path = resolvePath(state.cwd, pathPart || ".");
    const node = lookup(env.root, path);
    if (!node) {
      return fail([err(`open: no such file or directory: ${target}`), hint("try ls, or grep <words> to search the site")]);
    }
    if (node.type === "link") {
      return ok([{ spans: [{ text: `Downloading ${node.name} · `, tone: "text-2" }, { text: node.target, tone: "link", href: node.target }] }], [{ type: "download", href: node.target }]);
    }
    const route = routeOf(node);
    if (!route) return fail([err(`open: ${target} has no page; try cat ${target}`)]);
    const href = hash ? `${pathnameOf(route)}#${hash}` : route;
    const dirPath = node.type === "dir" ? node.path : parentPath(node.path);
    if (dirPath !== state.cwd) state.oldCwd = state.cwd;
    state.cwd = dirPath;
    return ok([{ spans: [{ text: "page → ", tone: "text-3" }, { text: href, tone: "link", href }], stream: "hint" }], [{ type: "navigate", href }]);
  },
};

function commandMan(def: CommandDef): Line[] {
  const head = `${def.name.toUpperCase()}(1)`;
  const lines: Line[] = [
    line(`${head} · Live System Manual`, "text-3"),
    blank(),
    { spans: [{ text: "NAME", tone: "text", bold: true }] },
    para(`${def.name} - ${def.summary}`),
    { spans: [{ text: "SYNOPSIS", tone: "text", bold: true }] },
    { spans: [{ text: def.usage, tone: "text" }], indent: 7 },
    { spans: [{ text: "DESCRIPTION", tone: "text", bold: true }] },
    ...def.description.map((d) => para(d)),
  ];
  if (def.examples?.length) {
    lines.push({ spans: [{ text: "EXAMPLES", tone: "text", bold: true }] });
    for (const e of def.examples) lines.push({ spans: [runSpan(e, e)], indent: 7 });
  }
  return lines;
}

function projectMan(p: Project, env: ShellEnv): Line[] {
  const h = (t: string): Line => ({ spans: [{ text: t, tone: "text", bold: true }] });
  const nodeLabel = (id: string) => p.system.nodes.find((n) => n.id === id)?.label ?? id;
  const tradeoffs = p.caseStudy.decisions.filter((d) => d.kind === "tradeoff");
  const lines: Line[] = [
    line(`${p.slug.toUpperCase()}(7) · Live System Manual`, "text-3"),
    blank(),
    h("NAME"),
    para(`${p.slug} - ${p.tagline}`),
    h("SYNOPSIS"),
    ...[`open /work/${p.slug}`, `kubectl describe project ${p.slug}`, `cat /work/${p.slug}/ARCHITECTURE.md`, `open /labs/${p.lab.slug}`].map<Line>((c) => ({
      spans: [runSpan(c, c)],
      indent: 7,
    })),
    h("DESCRIPTION"),
    para(p.summary),
    para(p.headline),
    para(`Status: ${p.status}. Period: ${p.period.label}. Stack: ${p.stack.join(", ")}.`),
    h("ARCHITECTURE"),
    para(p.caseStudy.architecture),
    ...p.system.edges.map<Line>((e) => {
      const cls = protocolClass[e.protocol];
      return {
        spans: [
          { text: `${nodeLabel(e.from)} → ${nodeLabel(e.to)} `, tone: "text-2" },
          { text: `[${cls}]`, tone: cls === "sync" ? "sync" : cls === "async" ? "async" : "text-3" },
          { text: ` ${e.protocol}: ${e.label}`, tone: "text-3" },
        ],
        indent: 7,
        hang: 2,
      };
    }),
    h("FAILURE MODES"),
  ];
  if (!tradeoffs.length && !p.caseStudy.nextSteps.length) lines.push(para("None documented yet.", 7, "text-3"));
  for (const t of tradeoffs) lines.push({ spans: [{ text: "- ", tone: "text-3" }, ...inline(t.text, "text-2", env.isRoute)], indent: 7, hang: 2 });
  if (p.caseStudy.nextSteps.length) {
    lines.push(para("What I would change next:", 7, "text-3"));
    for (const s of p.caseStudy.nextSteps) lines.push({ spans: [{ text: "- ", tone: "text-3" }, ...inline(s, "text-2", env.isRoute)], indent: 7, hang: 2 });
  }
  lines.push(h("SEE ALSO"));
  const see: Span[] = [
    { text: `/work/${p.slug}`, tone: "link", href: `/work/${p.slug}` },
    { text: ", ", tone: "text-3" },
    { text: `/labs/${p.lab.slug}`, tone: "link", href: `/labs/${p.lab.slug}` },
    { text: ` (${p.lab.title}), `, tone: "text-3" },
    { text: p.links.repo, tone: "link", href: p.links.repo },
  ];
  if (p.links.live) see.push({ text: ", ", tone: "text-3" }, { text: p.links.live, tone: "link", href: p.links.live });
  lines.push({ spans: see, indent: 7 });
  return lines;
}

const man: CommandDef = {
  name: "man",
  usage: "man <command|project>",
  summary: "manual page for a command or a project",
  description: [
    "man <command> explains a command. man <project> renders a project as a manual page: NAME, SYNOPSIS, DESCRIPTION, ARCHITECTURE, FAILURE MODES (its documented trade-offs and what I would change next) and SEE ALSO.",
  ],
  examples: ["man ls", "man linkedin-clone", "man orchrez"],
  group: "Explore",
  complete: { args: (before) => (before.length === 0 ? "command" : null) },
  run({ args, env }) {
    const topic = args[0];
    if (!topic) return fail([line("What manual page do you want?", "text-2"), hint(`try man ls or man ${env.projects[0]?.slug ?? "help"}`)]);
    const def = env.commands.get(topic);
    if (def) return ok(commandMan(def));
    const p = getProject(env, topic);
    if (p) return ok(projectMan(p, env));
    const near = didYouMean(topic, [...env.commands.keys(), ...env.projects.map((x) => x.slug)]);
    return fail([
      err(`No manual entry for ${topic}`),
      near.length
        ? { spans: [{ text: "did you mean: ", tone: "text-3" }, ...near.flatMap((n, i) => [...(i ? [{ text: ", ", tone: "text-3" as const }] : []), runSpan(n, `man ${n}`)])], stream: "hint" }
        : hint(`projects: ${env.projects.map((x) => x.slug).join(", ")}`),
    ]);
  },
};

const grep: CommandDef = {
  name: "grep",
  usage: "grep <words>",
  summary: "search the whole site (or filter piped lines)",
  description: [
    "On its own, grep ranks every chunk of site content against your words with BM25, the same index the ask-the-agent panel and the MCP server use, and prints the best hits with their paths.",
    "After a pipe, grep filters the lines of the previous command instead (a case-insensitive substring match; -v inverts it).",
  ],
  examples: ["grep kafka consumer lag", "grep idempotency", "ls -l /work | grep orchrez"],
  group: "Explore",
  run({ args, env, stdin }) {
    const { flags: f, rest } = flags(args);
    const query = rest.join(" ").trim();
    if (!query) return usageError(grep, "missing search words");
    if (stdin) {
      const q = query.toLowerCase();
      const invert = f.has("v");
      const kept = stdin.filter((l) => lineText(l).toLowerCase().includes(q) !== invert);
      return { lines: kept, code: kept.length ? 0 : 1 };
    }
    const hits = env.index.search(query, 8);
    if (!hits.length) {
      return fail([
        line(`grep: no matches for "${query}"`, "text-2"),
        { spans: [{ text: "try fewer words, or ", tone: "text-3" }, runSpan(`ask ${query}`, `ask ${quoteArg(query)}`)], stream: "hint" },
      ]);
    }
    const lines: Line[] = [hint(`${hits.length} best ${hits.length === 1 ? "match" : "matches"} for "${query}" (BM25 over ${env.index.size} chunks of site content)`)];
    for (const h of hits) {
      lines.push({
        spans: [
          { text: h.score.toFixed(2).padStart(5), tone: "text-3" },
          { text: "  " },
          { text: h.doc.url, tone: "link", href: h.doc.url },
          { text: "  " },
          { text: h.doc.title, tone: "text" },
        ],
        hang: 7,
      });
      lines.push({ spans: [{ text: h.snippet, tone: "text-3" }], indent: 7 });
    }
    return ok(lines);
  },
};

const ask: CommandDef = {
  name: "ask",
  usage: "ask <question>",
  summary: "hand a question to the ask-the-agent panel",
  description: [
    "Opens the ask-the-agent panel with your question. Answers come only from this site's content and show their sources. If you'd rather search yourself, grep <words> does the same retrieval without the model.",
  ],
  examples: ["ask how does orchrez survive a restart", "ask what did you build with kafka"],
  group: "Explore",
  run({ args }) {
    const question = args.join(" ").trim();
    if (!question) return usageError(ask, "missing question");
    return ok([line(`Handing “${question}” to the ask panel…`, "text-2")], [{ type: "ask", question }]);
  },
};

function describeProject(p: Project): Line[] {
  const kvLine = (k: string, v: string | Span[]): Line => ({
    spans: [{ text: `${k}:`.padEnd(14), tone: "text-3" }, ...(typeof v === "string" ? [{ text: v, tone: "text-2" as const }] : v)],
    hang: 14,
  });
  const nodeLabel = (id: string) => p.system.nodes.find((n) => n.id === id)?.label ?? id;
  const lines: Line[] = [
    kvLine("Name", p.slug),
    kvLine("Namespace", "work"),
    kvLine("Labels", `status=${p.status}`),
    kvLine("Period", p.period.label),
    kvLine("Stack", p.stack.join(", ")),
    kvLine("Repo", [{ text: p.links.repo, tone: "link", href: p.links.repo }]),
  ];
  if (p.links.live) lines.push(kvLine("Live", [{ text: p.links.live, tone: "link", href: p.links.live }]));
  lines.push(kvLine("Lab", [{ text: `/labs/${p.lab.slug}`, tone: "link", href: `/labs/${p.lab.slug}` }, { text: ` (${p.lab.kind})`, tone: "text-3" }]));
  lines.push(kvLine("Components", String(p.system.nodes.length)));
  lines.push(
    ...table(
      [{ header: "  ID" }, { header: "NAME" }, { header: "KIND" }, { header: "TECH", max: 40 }],
      p.system.nodes.map((n) => [`  ${n.id}`, n.label, n.kind, n.tech]),
    ),
  );
  lines.push(kvLine("Connections", String(p.system.edges.length)));
  lines.push(
    ...table(
      [{ header: "  FROM" }, { header: "TO" }, { header: "PROTOCOL" }, { header: "CARRIES", max: 48 }],
      p.system.edges.map((e) => {
        const cls = protocolClass[e.protocol];
        return [`  ${nodeLabel(e.from)}`, nodeLabel(e.to), { text: `${e.protocol} (${cls})`, tone: cls === "sync" ? "sync" : cls === "async" ? "async" : "text-3" }, e.label];
      }),
    ),
  );
  if (p.metrics.length) {
    lines.push(kvLine("Metrics", ""));
    for (const m of p.metrics) lines.push({ spans: [{ text: `${m.value}  `, tone: "text" }, { text: m.label, tone: "text-2" }, { text: ` (source: ${m.source})`, tone: "text-3" }], indent: 2, hang: 2 });
  }
  lines.push(kvLine("Events", p.caseStudy.decisions.length ? "" : "<none>"));
  for (const d of p.caseStudy.decisions) {
    lines.push({
      spans: [{ text: d.kind === "tradeoff" ? "Warning  TradeOff  " : "Normal   Choice    ", tone: "text-3" }, { text: d.text, tone: "text-2" }],
      indent: 2,
      hang: 19,
    });
  }
  return lines;
}

const kubectl: CommandDef = {
  name: "kubectl",
  usage: "kubectl get projects|labs · kubectl describe project <slug>",
  summary: "projects and labs as kubectl tables",
  description: [
    "A kubectl-flavoured view of the content. get projects prints NAME, STATUS, PERIOD and STACK. get labs prints each lab, whether it is a simulation or runs in your browser, and its project. describe project <slug> prints the components, connections, metrics and decisions.",
    "Nothing here runs in a real cluster; it's a familiar shape for the same data.",
  ],
  examples: ["kubectl get projects", "kubectl get labs", "kubectl describe project linkedin-clone"],
  group: "Explore",
  complete: {
    args: (before) => {
      if (before.length === 0) return ["get", "describe"];
      if (before[0] === "get" && before.length === 1) return ["projects", "labs"];
      if (before[0] === "describe" && before.length === 1) return ["project"];
      if (before[0] === "describe" && before.length === 2) return "slug";
      return null;
    },
  },
  run({ args, env }) {
    const [verb, kindRaw, nameRaw] = args;
    let kind = kindRaw;
    let name = nameRaw;
    if (kind?.includes("/")) [kind, name] = kind.split("/", 2);
    const isProjects = kind === "projects" || kind === "project" || kind === "proj";
    const isLabs = kind === "labs" || kind === "lab";
    if (verb === "get" && isProjects) {
      const rows = name ? env.projects.filter((p) => p.slug === name) : env.projects;
      if (!rows.length) return fail([err(`Error from server (NotFound): projects "${name}" not found`)]);
      return ok(
        table(
          [{ header: "NAME" }, { header: "STATUS" }, { header: "PERIOD" }, { header: "STACK", max: 44 }],
          rows.map((p) => [{ text: p.slug, tone: "text", run: `kubectl describe project ${p.slug}` }, p.status, p.period.label, stackSummary(p.stack)]),
        ),
      );
    }
    if (verb === "get" && isLabs) {
      return ok(
        table(
          [{ header: "NAME" }, { header: "KIND" }, { header: "PROJECT" }, { header: "PATH" }],
          env.labs.map((l) => [{ text: l.slug, tone: "text", run: `open /labs/${l.slug}` }, l.kind, l.project, { text: `/labs/${l.slug}`, tone: "link", href: `/labs/${l.slug}` }]),
        ),
      );
    }
    if (verb === "describe" && isProjects) {
      if (!name) return usageError({ name: "kubectl", usage: "kubectl describe project <slug>" }, "missing project name");
      const p = getProject(env, name);
      if (!p) {
        const near = didYouMean(name, env.projects.map((x) => x.slug));
        return fail([err(`Error from server (NotFound): projects "${name}" not found`), hint(near.length ? `did you mean ${near[0]}?` : `projects: ${env.projects.map((x) => x.slug).join(", ")}`)]);
      }
      return ok(describeProject(p));
    }
    if (verb === "get" && kind) {
      return fail([line(`No resources found in ${HOST} namespace.`, "text-2"), hint("this cluster only has projects and labs: kubectl get projects")]);
    }
    return usageError(kubectl);
  },
};

const curl: CommandDef = {
  name: "curl",
  usage: "curl [path]",
  summary: "fetch a page as plain text, like a terminal would",
  description: [
    "Fetches a page of this site with Accept: text/plain, the same rendering curl gets in a real terminal, and prints it with its ANSI colours (add ?plain=1 for none). Only same-origin paths work from the browser.",
    "With no path, fetches the page for the working directory.",
  ],
  examples: ["curl /", "curl /work/orchrez", "curl /cv?plain=1"],
  group: "Explore",
  complete: { args: ["route"] },
  async run({ args, state, env, io }) {
    const { rest } = flags(args);
    const arg = rest[0];
    let path: string;
    if (!arg) {
      const node = lookup(env.root, state.cwd);
      path = node ? pathnameOf(routeOf(node) ?? "/") : "/";
    } else if (/^https?:/i.test(arg)) {
      return fail([err("curl: from the browser only same-origin paths work, e.g. curl /work/orchrez"), hint("from your own terminal, curl the site's address to get the full ANSI version")]);
    } else if (arg.startsWith("/")) {
      path = arg;
    } else {
      const node = lookup(env.root, resolvePath(state.cwd, arg));
      const route = node ? routeOf(node) : undefined;
      if (!route) return fail([err(`curl: (3) can't resolve ${arg}; use a site path like /work/orchrez`)]);
      path = pathnameOf(route);
    }
    // Ask for colour unless the visitor chose a colour option themselves.
    const requestPath = /[?&](colou?r|plain|no_?color|NO_COLOR|nocolor)(=|&|$)/.test(path) ? path : `${path}${path.includes("?") ? "&" : "?"}color=1`;
    let res;
    try {
      res = await io.fetch(requestPath, { accept: "text/plain" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail([err(`curl: (7) couldn't fetch ${path}: ${msg}`)], 7);
    }
    if (res.status === 404) {
      return fail(
        [err(`curl: (22) ${path} returned HTTP 404`), hint("The plain-text renderer doesn't serve this path (yet). Try curl / or cat a file in this directory.")],
        22,
      );
    }
    if (res.status >= 400) return fail([err(`curl: (22) ${path} returned HTTP ${res.status}`)], 22);
    if (/text\/html/i.test(res.contentType)) {
      return fail([
        err(`curl: ${path} answered with HTML, so the plain-text version isn't live for it yet`),
        hint("cat README.md shows the same content from this shell's own files"),
      ]);
    }
    if (res.contentType && !/^text\/|json|markdown|xml/i.test(res.contentType)) {
      const type = res.contentType.split(";")[0].trim();
      return ok([{ spans: [{ text: `curl: binary output (${type}) not shown. `, tone: "text-2" }, runSpan(`open ${path}`, `open ${path}`), { text: " opens it.", tone: "text-2" }] }]);
    }
    const out = ansiToLines(res.body);
    const MAX = 400;
    const lines = out.length > MAX ? [...out.slice(0, MAX), hint(`… ${out.length - MAX} more lines`)] : out;
    return ok(lines);
  },
};

interface HealthService {
  id: string;
  name: string;
  url?: string;
  health: "ok" | "warn" | "crit" | "unknown";
  latencyMs?: number | null;
  httpStatus?: number | null;
  note?: string;
}

function parseHealth(body: string): { checkedAt?: string; services: HealthService[]; site?: { buildSha?: string; region?: string } } | null {
  try {
    const j: unknown = JSON.parse(body);
    if (!j || typeof j !== "object" || !Array.isArray((j as { services?: unknown }).services)) return null;
    const o = j as { checkedAt?: unknown; services: unknown[]; site?: { buildSha?: unknown; region?: unknown } };
    const services = o.services.flatMap((s): HealthService[] => {
      if (!s || typeof s !== "object") return [];
      const r = s as Record<string, unknown>;
      const health = r.health === "ok" || r.health === "warn" || r.health === "crit" ? r.health : "unknown";
      return [
        {
          id: String(r.id ?? r.name ?? "?"),
          name: String(r.name ?? r.id ?? "?"),
          health,
          latencyMs: typeof r.latencyMs === "number" ? r.latencyMs : null,
          httpStatus: typeof r.httpStatus === "number" ? r.httpStatus : null,
          note: typeof r.note === "string" ? r.note : undefined,
        },
      ];
    });
    return {
      checkedAt: typeof o.checkedAt === "string" ? o.checkedAt : undefined,
      services,
      site: o.site ? { buildSha: typeof o.site.buildSha === "string" ? o.site.buildSha : undefined, region: typeof o.site.region === "string" ? o.site.region : undefined } : undefined,
    };
  } catch {
    return null;
  }
}

const HEALTH_WORD = { ok: "healthy", warn: "degraded", crit: "down", unknown: "unknown" } as const;

const status: CommandDef = {
  name: "status",
  usage: "status",
  summary: "live health of the deployed systems",
  description: [
    "Fetches /api/health, which checks each deployed system server-side with a short timeout and caches the result for 60 seconds. unknown means the check could not run, never probably fine.",
  ],
  group: "Explore",
  async run({ io }) {
    let res;
    try {
      res = await io.fetch("/api/health", { accept: "application/json" });
    } catch (e) {
      return fail([line("status: unknown", "text-3"), hint(`couldn't reach /api/health (${e instanceof Error ? e.message : String(e)})`)]);
    }
    const data = res.status === 200 ? parseHealth(res.body) : null;
    if (!data) {
      return fail([line("status: unknown", "text-3"), hint(res.status === 200 ? "/api/health answered, but not with the expected JSON" : `/api/health returned HTTP ${res.status}`)]);
    }
    const meta = [data.checkedAt ? `checked ${data.checkedAt}` : null, data.site?.buildSha ? `build ${data.site.buildSha}` : null, data.site?.region ? `region ${data.site.region}` : null].filter(Boolean).join(" · ");
    const lines: Line[] = meta ? [hint(meta)] : [];
    if (!data.services.length) return ok([...lines, line("No services are checked yet.", "text-2")]);
    lines.push(
      ...table(
        [{ header: "SERVICE" }, { header: "HEALTH" }, { header: "LATENCY", align: "right" }, { header: "HTTP", align: "right" }, { header: "NOTE", max: 48 }],
        data.services.map((s) => [
          { text: s.name, tone: "text" },
          { text: `● ${HEALTH_WORD[s.health]}`, tone: s.health === "unknown" ? "text-3" : s.health },
          s.latencyMs != null ? `${Math.round(s.latencyMs)} ms` : "-",
          s.httpStatus != null ? String(s.httpStatus) : "-",
          { text: s.note ?? "", tone: "text-3" },
        ]),
      ),
    );
    return ok(lines);
  },
};

const whoami: CommandDef = {
  name: "whoami",
  usage: "whoami",
  summary: "your own request, as the server saw it",
  description: [
    "Prints the request id and region the server stamped on the request that loaded this page. They come from the page's Server-Timing header, read through the Performance API. Nothing is stored or sent anywhere.",
  ],
  group: "Explore",
  run({ io }) {
    const nav = io.navigation();
    const kv = (k: string, v: string | null, note?: string): Line => ({
      spans: [{ text: k.padEnd(8), tone: "text-3" }, { text: v ?? "unknown", tone: v ? "text" : "text-3" }, ...(note ? [{ text: `  ${note}`, tone: "text-3" as const }] : [])],
      hang: 8,
    });
    const lines: Line[] = [line("visitor (that's you)", "text")];
    lines.push(kv("reqid", nav?.reqid ?? null), kv("region", nav?.region ?? null), kv("proxy", nav?.proxyMs != null ? `${nav.proxyMs.toFixed(1)} ms` : null));
    if (nav?.ttfbMs != null) lines.push(kv("ttfb", `${Math.round(nav.ttfbMs)} ms`));
    lines.push(hint(nav && (nav.reqid || nav.region) ? "from this page's Server-Timing header (the first load in this tab)" : "this page load carried no Server-Timing request trace"));
    return ok(lines);
  },
};

const theme: CommandDef = {
  name: "theme",
  usage: "theme [dark|light]",
  summary: "switch between the dark and light theme",
  description: ["With no argument, toggles the theme. The choice is remembered in this browser."],
  examples: ["theme", "theme light"],
  group: "Site",
  complete: { args: [["dark", "light"]] },
  run({ args, io }) {
    const v = args[0];
    if (v && v !== "dark" && v !== "light") return usageError(theme, `unknown theme '${v}'`);
    const next = (v ?? (io.theme() === "dark" ? "light" : "dark")) as "dark" | "light";
    return ok([line(`theme: ${next}`, "text-2")], [{ type: "theme", value: next }]);
  },
};

const motion: CommandDef = {
  name: "motion",
  usage: "motion [system|reduce|full]",
  summary: "show or set the motion preference",
  description: ["system follows your OS setting; reduce turns animation off everywhere on the site; full allows it even if your OS asks for less. With no argument, prints the current setting."],
  examples: ["motion", "motion reduce"],
  group: "Site",
  complete: { args: [["system", "reduce", "full"]] },
  run({ args, io }) {
    const v = args[0];
    if (!v) {
      const cur = io.motion();
      const why = cur === "system" ? ` (your OS ${io.prefersReducedMotion() ? "asks for reduced motion" : "allows motion"})` : "";
      return ok([line(`motion: ${cur}${why}`, "text-2")]);
    }
    if (v !== "system" && v !== "reduce" && v !== "full") return usageError(motion, `unknown setting '${v}'`);
    return ok([line(`motion: ${v}`, "text-2")], [{ type: "motion", value: v }]);
  },
};

const incident: CommandDef = {
  name: "incident",
  usage: "incident [start|stop]",
  summary: "run a simulated incident (INC-1)",
  description: [
    "Starts or stops INC-1, a clearly labelled simulation of a notification consumer lagging. It replays a real trade-off documented in the LinkedIn clone and ends with a short blameless postmortem. Nothing real breaks.",
  ],
  examples: ["incident start", "incident stop"],
  group: "Site",
  complete: { args: [["start", "stop"]] },
  run({ args, io }) {
    const v = args[0];
    if (!v) return ok([line(`incident: ${io.incidentOn() ? "INC-1 in progress (simulation)" : "none active"}`, "text-2"), hint("incident start runs a simulated one")]);
    if (v === "start") return ok([line("INC-1 started. This is a simulation; nothing real is broken.", "text-2")], [{ type: "incident", on: true }]);
    if (v === "stop") return ok([line("INC-1 stopped.", "text-2")], [{ type: "incident", on: false }]);
    return usageError(incident, `unknown action '${v}'`);
  },
};

const overlay: CommandDef = {
  name: "overlay",
  usage: "overlay [on|off]",
  summary: "outline every component on the page",
  description: ["Toggles the architecture overlay: an outline around each component on the page, labelled server, client or static, with a legend showing this page's request timings. Press ? anywhere to toggle it too."],
  group: "Site",
  complete: { args: [["on", "off"]] },
  run({ args }) {
    const v = args[0];
    if (v && v !== "on" && v !== "off") return usageError(overlay, `unknown argument '${v}'`);
    return ok([line(`overlay: ${v ?? "toggled"} · Esc closes it (so does ?, unless key shortcuts are off)`, "text-2")], [{ type: "overlay", on: v ? v === "on" : undefined }]);
  },
};

const history: CommandDef = {
  name: "history",
  usage: "history [-c]",
  summary: "commands you have run",
  description: ["Lists the commands you've run in this browser. -c clears the list. It is stored only in your browser."],
  group: "Shell",
  run({ args, state }) {
    if (args[0] === "-c") return ok([line("history cleared", "text-2")], [{ type: "clearHistory" }]);
    const w = String(state.history.length).length;
    return ok(state.history.map((h, i) => ({ spans: [{ text: `${String(i + 1).padStart(w + 2)}  `, tone: "text-3" }, { text: h, tone: "text-2", run: h }], pre: true })));
  },
};

const clear: CommandDef = {
  name: "clear",
  usage: "clear",
  summary: "clear the screen (Ctrl+L)",
  description: ["Clears the scrollback. Ctrl+L does the same."],
  group: "Shell",
  run: () => ok([], [{ type: "clear" }]),
};

const exit: CommandDef = {
  name: "exit",
  usage: "exit",
  summary: "close the shell (Esc)",
  description: ["Closes the shell and returns focus to where you were. Esc does the same."],
  group: "Shell",
  run: () => ok([line("logout", "text-3")], [{ type: "exit" }]),
};

const echo: CommandDef = {
  name: "echo",
  usage: "echo [text]",
  summary: "print text",
  description: ["Prints its arguments. $PWD, $USER and $HOME expand."],
  group: "Shell",
  run({ args, state }) {
    const vars: Record<string, string> = { PWD: state.cwd, USER, HOME: "/", HOSTNAME: HOST, SHELL: "/bin/live-sh" };
    const text = args.join(" ").replace(/\$(\w+)|\$\{(\w+)\}/g, (_, a: string | undefined, b: string | undefined) => vars[(a ?? b)!] ?? "");
    return ok([line(text, "text")]);
  },
};

const date: CommandDef = {
  name: "date",
  usage: "date",
  summary: "print the date and time",
  description: ["Prints your local date and time."],
  group: "Shell",
  run: ({ io }) => ok([line(new Date(io.now()).toString(), "text")]),
};

const uptime: CommandDef = {
  name: "uptime",
  usage: "uptime",
  summary: "how long this page has been open",
  description: ["Prints how long this tab has had the site open, measured with performance.now(). It is your session's uptime, not the server's; status shows live health."],
  group: "Shell",
  run({ io }) {
    const up = io.uptimeMs();
    const clock = new Date(io.now()).toTimeString().slice(0, 8);
    if (up == null) return ok([line(`${clock} up unknown, 1 user`, "text"), hint("this browser doesn't expose performance.now()")]);
    return ok([line(`${clock} up ${formatDuration(up)}, 1 user`, "text"), hint("time since this tab loaded the site; server uptime isn't measured here")]);
  },
};

const contact: CommandDef = {
  name: "contact",
  usage: "contact",
  summary: "email and links",
  description: ["Prints how to reach me. Email is the fastest."],
  group: "Explore",
  run({ env }) {
    const p = env.profile;
    const row = (k: string, text: string, href: string): Line => ({ spans: [{ text: k.padEnd(10), tone: "text-3" }, { text, tone: "link", href }], hang: 10 });
    return ok([
      row("Email", p.email, `mailto:${p.email}`),
      row("GitHub", p.links.github, p.links.github),
      row("LinkedIn", p.links.linkedin, p.links.linkedin),
      row("Resume", p.resumePdf, p.resumePdf),
      blank(),
      line(p.availability, "text-2"),
    ]);
  },
};

const sudo: CommandDef = {
  name: "sudo",
  usage: "sudo <command>",
  summary: "ask nicely",
  description: ["You already have every permission this site offers: read everything, break the labs. sudo chaos starts a simulated incident."],
  group: "Shell",
  complete: { args: (before) => (before.length === 0 ? ["chaos", "ls", "cat", "status"] : null) },
  async run(inv) {
    const [what, ...rest] = inv.args;
    if (!what) return usageError(sudo);
    if (what === "chaos") {
      return ok(
        [line("[sudo] permission granted, kindly. Starting INC-1, a simulated incident. Nothing real will break.", "text-2")],
        [{ type: "incident", on: true }],
      );
    }
    if (what === "rm") {
      return fail([line("Nice try. This filesystem is generated from read-only content, so there's nothing to delete.", "text-2"), { spans: [{ text: "for safe destruction, try ", tone: "text-3" }, runSpan("sudo chaos", "sudo chaos")], stream: "hint" }]);
    }
    const def = inv.env.commands.get(what);
    if (def && what !== "sudo") {
      const r = await def.run({ ...inv, name: what, args: rest });
      return { ...r, lines: [hint("(you already had permission)"), ...r.lines] };
    }
    return fail([
      line(`${USER} is not in the sudoers file. That's fine: everything here is already yours to read.`, "text-2"),
      { spans: [{ text: "for a safe, simulated incident, try ", tone: "text-3" }, runSpan("sudo chaos", "sudo chaos")], stream: "hint" },
    ]);
  },
};

export const COMMANDS: CommandDef[] = [
  ls,
  cd,
  pwd,
  cat,
  open,
  man,
  grep,
  ask,
  kubectl,
  curl,
  status,
  whoami,
  contact,
  theme,
  motion,
  overlay,
  incident,
  help,
  history,
  clear,
  echo,
  date,
  uptime,
  sudo,
  exit,
];

/** `command not found` with Levenshtein suggestions and matching quick actions. Never a dead end. */
export function notFound(name: string, args: string[], env: ShellEnv): CmdOutput {
  const lines: Line[] = [err(`command not found: ${name}`)];
  // Commands are lowercase; "LS" or "Ls" should suggest "ls" first (didYouMean skips exact matches).
  const lower = name.toLowerCase();
  const near = [...(env.commands.has(lower) ? [lower] : []), ...didYouMean(name, [...env.commands.keys()])];
  if (near.length) {
    lines.push({
      spans: [
        { text: "did you mean ", tone: "text-3" },
        ...near.slice(0, 3).flatMap((n, i) => [...(i ? [{ text: " or ", tone: "text-3" as const }] : []), runSpan([n, ...args].join(" "), [n, ...args].join(" "))]),
        { text: "?", tone: "text-3" },
      ],
      stream: "hint",
    });
  }
  const actions = matchActions(env.actions, [name, ...args].join(" "), 2).filter((h) => h.score > 4);
  if (actions.length) {
    lines.push({
      spans: [
        { text: near.length ? "or maybe: " : "maybe: ", tone: "text-3" },
        ...actions.flatMap((h, i) => [...(i ? [{ text: " · ", tone: "text-3" as const }] : []), runSpan(h.action.label, h.action.command)]),
      ],
      stream: "hint",
    });
  }
  if (!near.length && !actions.length) lines.push({ spans: [{ text: "type ", tone: "text-3" }, runSpan("help", "help"), { text: " to see every command", tone: "text-3" }], stream: "hint" });
  return { lines, code: 127 };
}

