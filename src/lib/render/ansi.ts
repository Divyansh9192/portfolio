/**
 * Terminal rendering of the site for `curl`, Wget, HTTPie, xh and PowerShell.
 * 16-colour SGR only, every line wrapped to `width` (default 80) columns.
 * Pure and framework-free: the route handler only picks options.
 */
import { achievements, education, getProject, labs, profile, projects, protocolClass, skills, type Project } from "@/content";
import { SITE_URL } from "@/lib/site";
import { absUrl, mdUrl, normalizePath, pageEntries, statusLabel, truncatePath } from "./routes";

export interface AnsiOptions {
  /** Emit SGR colour/weight codes. */
  color: boolean;
  /** Maximum visible line length. Clamped to 40..200. Default 80. */
  width?: number;
  /** Origin used for printed URLs. Default SITE_URL. */
  origin?: string;
}

export interface AnsiResult {
  status: number;
  body: string;
}

export const DEFAULT_WIDTH = 80;
const MIN_WIDTH = 40;
const MAX_WIDTH = 200;

/* ------------------------------------------------------------------ options */

const TRUTHY = /^(1|true|yes|on|always)$/i;
const FALSY = /^(0|false|no|off|never)$/i;

/**
 * Decide whether to colour the output.
 * Off: `?plain`, `?plain=1`, `?color=0`, `?no_color` / `?NO_COLOR` (the NO_COLOR convention as a query flag).
 * On: `?color=1`. Otherwise on for interactive terminal clients (curl, HTTPie, xh) and off for the
 * rest (Wget writes to a file by default; PowerShell and Accept-negotiated clients may not render SGR).
 */
export function wantsColor(params: URLSearchParams, userAgent: string | null): boolean {
  const plain = params.get("plain");
  if (plain !== null && !FALSY.test(plain)) return false;
  for (const key of ["no_color", "NO_COLOR", "nocolor"]) {
    const v = params.get(key);
    if (v !== null && !FALSY.test(v)) return false;
  }
  const c = params.get("color") ?? params.get("colour");
  if (c !== null) {
    if (FALSY.test(c)) return false;
    if (c === "" || TRUTHY.test(c)) return true;
  }
  return /^(curl|HTTPie|xh)\//i.test(userAgent ?? "");
}

/** Read `?width=` (or `?w=`/`?cols=`) and clamp it; default 80. */
export function parseWidth(params: URLSearchParams): number {
  const raw = params.get("width") ?? params.get("w") ?? params.get("cols");
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  return clampWidth(Number.isFinite(n) ? n : DEFAULT_WIDTH);
}

function clampWidth(n: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(n)));
}

/* ------------------------------------------------------------------ text primitives */

/** Visible length in terminal columns (code points; the content has no wide glyphs). */
export function vlen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Count a surrogate pair once.
    if (c < 0xd800 || c > 0xdbff) n++;
  }
  return n;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Remove SGR sequences, e.g. to measure or test rendered output. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function padEnd(s: string, w: number): string {
  const n = vlen(s);
  return n >= w ? s : s + " ".repeat(w - n);
}

const BREAK_AFTER = "/-_.:?&=#,";

/** Split a token longer than `w`, preferring to break after URL/path punctuation. */
function breakLong(word: string, w: number): string[] {
  const out: string[] = [];
  let chars = Array.from(word);
  while (chars.length > w) {
    let cut = w;
    for (let i = w; i > Math.floor(w / 2); i--) {
      if (BREAK_AFTER.includes(chars[i - 1])) {
        cut = i;
        break;
      }
    }
    out.push(chars.slice(0, cut).join(""));
    chars = chars.slice(cut);
  }
  out.push(chars.join(""));
  return out;
}

/** Greedy word wrap to `width` columns. Never returns a line longer than `width`. */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const lines: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const len = vlen(word);
    if (len > w) {
      if (cur) lines.push(cur);
      const parts = breakLong(word, w);
      lines.push(...parts.slice(0, -1));
      cur = parts[parts.length - 1];
      curLen = vlen(cur);
      continue;
    }
    if (!cur) {
      cur = word;
      curLen = len;
    } else if (curLen + 1 + len <= w) {
      cur += ` ${word}`;
      curLen += 1 + len;
    } else {
      lines.push(cur);
      cur = word;
      curLen = len;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/* ------------------------------------------------------------------ styled writer */

const SGR = {
  bold: [1, 22],
  dim: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  gray: [90, 39],
} as const;

type Style = keyof typeof SGR;

class Writer {
  readonly lines: string[] = [];
  readonly indent = 2;

  constructor(
    readonly width: number,
    readonly color: boolean,
  ) {}

  paint(s: string, ...styles: Style[]): string {
    if (!this.color || !s || styles.length === 0) return s;
    let open = "";
    let close = "";
    for (const st of styles) {
      open += `\x1b[${SGR[st][0]}m`;
      close = `\x1b[${SGR[st][1]}m${close}`;
    }
    return `${open}${s}${close}`;
  }

  push(line = ""): void {
    this.lines.push(line.replace(/\s+$/, ""));
  }

  blank(): void {
    if (this.lines.length && this.lines[this.lines.length - 1] !== "") this.lines.push("");
  }

  rule(): void {
    this.push(this.paint("─".repeat(this.width), "dim"));
  }

  heading(text: string): void {
    this.blank();
    this.push(this.paint(text.toUpperCase(), "bold"));
  }

  /** Wrapped paragraph with a left indent. */
  para(text: string, opts: { indent?: number; styles?: Style[] } = {}): void {
    const ind = opts.indent ?? this.indent;
    for (const l of wrap(text, this.width - ind)) this.push(" ".repeat(ind) + this.paint(l, ...(opts.styles ?? [])));
  }

  /** Bullet with a hanging indent. */
  bullet(text: string, opts: { marker?: string; indent?: number; styles?: Style[]; markerStyles?: Style[] } = {}): void {
    const ind = opts.indent ?? this.indent;
    const marker = opts.marker ?? "•";
    const hang = ind + vlen(marker) + 1;
    wrap(text, this.width - hang).forEach((l, i) => {
      const lead = i === 0 ? " ".repeat(ind) + this.paint(marker, ...(opts.markerStyles ?? ["dim"])) + " " : " ".repeat(hang);
      this.push(lead + this.paint(l, ...(opts.styles ?? [])));
    });
  }

  /** Two-column key/value rows; values wrap under themselves. */
  kv(rows: { key: string; value: string; styles?: Style[] }[], opts: { indent?: number; keyStyles?: Style[] } = {}): void {
    const ind = opts.indent ?? this.indent;
    const maxKey = Math.min(Math.floor((this.width - ind) / 3), Math.max(0, ...rows.map((r) => vlen(r.key))));
    const valueW = this.width - ind - maxKey - 2;
    // A value with an unbreakable token (usually a URL) that only fits on a full line: stack every row.
    const stack = rows.some((r) => r.value.split(/\s+/).some((t) => vlen(t) > valueW && vlen(t) <= this.width - ind - 2));
    if (stack) {
      for (const r of rows) {
        for (const l of wrap(r.key, this.width - ind)) this.push(" ".repeat(ind) + this.paint(l, ...(opts.keyStyles ?? ["dim"])));
        for (const l of wrap(r.value, this.width - ind - 2)) this.push(" ".repeat(ind + 2) + this.paint(l, ...(r.styles ?? [])));
      }
      return;
    }
    for (const r of rows) {
      const keyLines = wrap(r.key, maxKey);
      const valueLines = wrap(r.value, valueW);
      const n = Math.max(keyLines.length, valueLines.length, 1);
      for (let i = 0; i < n; i++) {
        const k = keyLines[i] ?? "";
        const v = valueLines[i] ?? "";
        this.push(
          " ".repeat(ind) +
            this.paint(k, ...(opts.keyStyles ?? ["dim"])) +
            " ".repeat(maxKey - vlen(k) + 2) +
            this.paint(v, ...(r.styles ?? [])),
        );
      }
    }
  }

  /** A row with left text and right-aligned text when both fit, otherwise two lines. */
  split(left: string, right: string, leftStyles: Style[], rightStyles: Style[]): void {
    const ind = this.indent;
    const room = this.width - ind;
    if (vlen(left) + 2 + vlen(right) <= room) {
      this.push(
        " ".repeat(ind) + this.paint(left, ...leftStyles) + " ".repeat(room - vlen(left) - vlen(right)) + this.paint(right, ...rightStyles),
      );
    } else {
      this.para(left, { styles: leftStyles });
      this.para(right, { styles: rightStyles });
    }
  }

  toString(): string {
    while (this.lines.length && this.lines[this.lines.length - 1] === "") this.lines.pop();
    return `${this.lines.join("\n")}\n`;
  }
}

/* ------------------------------------------------------------------ shared blocks */

function statusGlyph(status: Project["status"]): { glyph: string; styles: Style[] } {
  if (status === "live") return { glyph: "●", styles: ["green"] };
  if (status === "in-development") return { glyph: "◐", styles: ["yellow"] };
  return { glyph: "○", styles: ["cyan"] };
}

function header(o: Writer, title: string, subtitle: string): void {
  for (const l of wrap(title, o.width)) o.push(o.paint(l, "bold"));
  for (const l of wrap(subtitle, o.width)) o.push(o.paint(l, "cyan"));
  o.rule();
}

function machineFooter(o: Writer, origin: string, extra: { key: string; value: string }[] = []): void {
  o.heading("Machine-readable");
  o.kv([
    ...extra,
    { key: "case study", value: `curl ${absUrl("/work/<slug>", origin)}` },
    { key: "JSON Resume", value: `curl ${absUrl("/resume.json", origin)}` },
    { key: "LLM index", value: `curl ${absUrl("/llms.txt", origin)}` },
    { key: "Markdown", value: `curl ${mdUrl("/", origin)}` },
    { key: "MCP server", value: `POST ${absUrl("/api/mcp", origin)} (Streamable HTTP, read-only tools)` },
    { key: "no colour", value: `curl '${absUrl("/?plain=1", origin)}'` },
  ]);
}

function projectsTable(o: Writer, origin: string): void {
  const ind = o.indent;
  const gap = 2;
  const cells = projects.map((p) => {
    const g = statusGlyph(p.status);
    return { p, g, status: `${g.glyph} ${statusLabel(p.status)}` };
  });
  const sW = Math.max(vlen("STATUS"), ...cells.map((c) => vlen(c.status)));
  const nW = Math.max(vlen("PROJECT"), ...projects.flatMap((p) => [vlen(p.name), vlen(p.period.label)]));
  const hW = o.width - ind - sW - gap - nW - gap;

  if (hW >= 24) {
    const pad = " ".repeat(ind);
    const sp = " ".repeat(gap);
    o.push(pad + o.paint(padEnd("STATUS", sW), "dim") + sp + o.paint(padEnd("PROJECT", nW), "dim") + sp + o.paint("HEADLINE", "dim"));
    o.push(pad + o.paint(`${"─".repeat(sW)}${sp}${"─".repeat(nW)}${sp}${"─".repeat(hW)}`, "dim"));
    cells.forEach((c, row) => {
      if (row > 0) o.push();
      const head = wrap(c.p.headline, hW);
      const n = Math.max(2, head.length);
      for (let i = 0; i < n; i++) {
        const status =
          i === 0 ? o.paint(c.g.glyph, ...c.g.styles) + " " + statusLabel(c.p.status) + " ".repeat(sW - vlen(c.status)) : " ".repeat(sW);
        const nameCell = i === 0 ? c.p.name : i === 1 ? c.p.period.label : "";
        const name = (i === 0 ? o.paint(nameCell, "bold") : o.paint(nameCell, "dim")) + " ".repeat(nW - vlen(nameCell));
        o.push(pad + status + sp + name + sp + (head[i] ?? ""));
      }
    });
  } else {
    // Narrow terminals: one block per project.
    cells.forEach((c, row) => {
      if (row > 0) o.push();
      o.bullet(c.p.name, { marker: c.g.glyph, markerStyles: c.g.styles, styles: ["bold"] });
      o.para(`${statusLabel(c.p.status)} · ${c.p.period.label}`, { indent: ind + 2, styles: ["dim"] });
      o.para(c.p.headline, { indent: ind + 2 });
    });
  }

  o.push();
  o.para("Case studies:", { styles: ["dim"] });
  o.kv(projects.map((p) => ({ key: p.name, value: absUrl(`/work/${p.slug}`, origin), styles: ["underline"] as Style[] })));
}

/* ------------------------------------------------------------------ pages */

function renderHome(o: Writer, origin: string): void {
  header(o, profile.name, `${profile.role} · ${profile.location}`);
  o.push();
  o.para(profile.pitch, { indent: 0 });
  o.push();
  o.bullet(profile.availability, { marker: "●", indent: 0, markerStyles: ["green"] });

  o.heading("Contact");
  o.kv([
    { key: "email", value: profile.email },
    { key: "github", value: profile.links.github },
    { key: "linkedin", value: profile.links.linkedin },
    { key: "web", value: absUrl("/", origin) },
    { key: "résumé", value: absUrl(profile.resumePdf, origin) },
  ]);

  o.heading("Projects");
  projectsTable(o, origin);

  o.heading("Education");
  education.forEach((e, i) => {
    if (i > 0) o.push();
    o.split(e.degree, e.period, ["bold"], ["dim"]);
    o.para(`${e.school}, ${e.place}${e.detail ? ` · ${e.detail}` : ""}`);
  });

  o.heading("Achievements");
  achievements.forEach((a, i) => {
    if (i > 0) o.push();
    o.bullet(a.period ? `${a.title} (${a.period})` : a.title, { marker: "▸", styles: ["bold"] });
    o.para(`${a.org}. ${a.detail}`, { indent: o.indent + 2 });
  });

  o.heading("Skills");
  o.kv(skills.map((s) => ({ key: s.label, value: s.items.join(", ") })));

  machineFooter(o, origin, [{ key: "this page", value: `${absUrl("/", origin)} in a browser` }]);
}

function edgeLines(o: Writer, p: Project): void {
  const nodes = new Map(p.system.nodes.map((n) => [n.id, n.label]));
  const name = (id: string) => nodes.get(id) ?? id;
  const fromW = Math.min(Math.floor(o.width / 3), Math.max(0, ...p.system.edges.map((e) => vlen(name(e.from)))));
  const classStyle: Record<string, Style[]> = { sync: ["blue"], async: ["magenta"], data: ["dim"] };
  for (const e of p.system.edges) {
    const from = name(e.from);
    const arrow = `--${e.protocol}-->`;
    // Colour the arrow by class (sync / async / data); the arrow text itself names the protocol.
    const paintArrow = (l: string) => l.replace(arrow, o.paint(arrow, ...classStyle[protocolClass[e.protocol]]));
    const prefixW = Math.max(fromW, vlen(from)) + 1;
    const restW = o.width - o.indent - prefixW;
    if (restW >= 24) {
      // Aligned: "from  --proto--> to : label", continuation lines indented under the arrow.
      wrap(`${arrow} ${name(e.to)} : ${e.label}`, restW).forEach((l, i) => {
        const lead = i === 0 ? padEnd(from, prefixW) : " ".repeat(prefixW);
        o.push(" ".repeat(o.indent) + lead + (i === 0 ? paintArrow(l) : l));
      });
    } else {
      wrap(`${from} ${arrow} ${name(e.to)} : ${e.label}`, o.width - o.indent - 2).forEach((l, i) => {
        o.push(" ".repeat(i === 0 ? o.indent : o.indent + 2) + paintArrow(l));
      });
    }
  }
  if (o.color && o.width - o.indent >= vlen("legend: sync call · message · data store")) {
    o.push();
    o.push(
      " ".repeat(o.indent) +
        o.paint("legend:", "dim") +
        " " +
        o.paint("sync call", "blue") +
        o.paint(" · ", "dim") +
        o.paint("message", "magenta") +
        o.paint(" · ", "dim") +
        o.paint("data store", "dim"),
    );
  }
}

function renderProject(o: Writer, p: Project, origin: string): void {
  const cs = p.caseStudy;
  const g = statusGlyph(p.status);
  header(o, p.name, p.tagline);
  wrap(`${g.glyph} ${statusLabel(p.status)} · ${p.period.label}`, o.width).forEach((l, i) =>
    o.push(i === 0 ? o.paint(g.glyph, ...g.styles) + l.slice(g.glyph.length) : l),
  );
  o.push();
  for (const l of wrap(p.headline, o.width)) o.push(o.paint(l, "bold"));

  o.heading("Summary");
  o.para(p.summary);
  o.push();
  o.kv([
    { key: "stack", value: p.stack.join(", ") },
    { key: "repo", value: p.links.repo },
    ...(p.links.live ? [{ key: "live", value: p.links.live }] : []),
  ]);

  if (p.metrics.length) {
    o.heading("Numbers");
    const valueW = Math.min(Math.floor(o.width / 3), Math.max(...p.metrics.map((m) => vlen(m.value))));
    const textInd = o.indent + valueW + 2;
    p.metrics.forEach((m, i) => {
      if (i > 0) o.push();
      const value = wrap(m.value, valueW);
      const label = wrap(m.label, o.width - textInd);
      for (let j = 0; j < Math.max(value.length, label.length); j++) {
        const v = value[j] ?? "";
        o.push(" ".repeat(o.indent) + o.paint(v, "cyan", "bold") + " ".repeat(valueW - vlen(v) + 2) + o.paint(label[j] ?? "", "bold"));
      }
      o.para(`source: ${m.source}`, { indent: textInd, styles: ["dim"] });
    });
  }

  if (cs.intro || cs.problem.length) {
    o.heading("The problem");
    [cs.intro, ...cs.problem].filter(Boolean).forEach((t, i) => {
      if (i > 0) o.push();
      o.para(t);
    });
  }

  if (cs.constraints.length) {
    o.heading("What made it hard");
    for (const c of cs.constraints) o.bullet(c);
  }

  o.heading("Architecture");
  if (cs.architecture) {
    o.para(cs.architecture);
    o.push();
  }
  edgeLines(o, p);

  if (cs.decisions.length) {
    o.heading("Decisions and trade-offs");
    o.kv(
      cs.decisions.map((d) => ({ key: d.kind === "choice" ? "choice" : "trade-off", value: d.text })),
      { keyStyles: ["cyan"] },
    );
  }

  if (cs.result) {
    o.heading("Where it stands");
    o.para(cs.result);
  }

  if (cs.nextSteps.length) {
    o.heading("Next steps");
    for (const s of cs.nextSteps) o.bullet(s, { marker: "-" });
  }

  if (p.facts.length) {
    o.heading("Evidence");
    o.para(`Paths are relative to ${p.links.repo} (branch ${p.repoBranch}).`, { styles: ["dim"] });
    for (const f of p.facts) {
      o.push();
      o.bullet(f.claim);
      o.para(f.evidence, { indent: o.indent + 2, styles: ["dim"] });
    }
  }

  o.heading("Lab");
  o.para(p.lab.title, { styles: ["bold"] });
  o.para(p.lab.kind, { styles: ["dim"] });
  o.para(p.lab.blurb);
  o.para(`open in a browser: ${absUrl(`/labs/${p.lab.slug}`, origin)}`, { styles: ["dim"] });

  o.heading("More");
  o.kv([
    { key: "HTML", value: absUrl(`/work/${p.slug}`, origin) },
    { key: "Markdown", value: mdUrl(`/work/${p.slug}`, origin) },
    { key: "all work", value: `curl ${absUrl("/", origin)}` },
  ]);
}

function renderLabs(o: Writer, origin: string): void {
  header(o, "Labs", "One safe-to-break lab per project. Labs are interactive: open them in a browser.");
  for (const l of labs) {
    o.push();
    o.para(l.title, { styles: ["bold"] });
    o.para(`${l.kind} · ${l.projectName}`, { styles: ["dim"] });
    o.para(l.blurb);
    o.para(absUrl(`/labs/${l.slug}`, origin), { styles: ["underline"] });
  }
}

function renderLab(o: Writer, slug: string, origin: string): boolean {
  const l = labs.find((x) => x.slug === slug);
  if (!l) return false;
  header(o, l.title, `${l.kind === "simulation" ? "Simulation" : "In-browser"} · ${l.projectName}`);
  o.push();
  o.para(l.blurb, { indent: 0 });
  o.push();
  o.para(
    l.kind === "simulation"
      ? "A deterministic model of the real mechanism, using real identifiers from the project's repository."
      : "Real computation that runs on your device.",
    { indent: 0, styles: ["dim"] },
  );
  o.heading("Open it");
  o.kv([
    { key: "lab", value: absUrl(`/labs/${l.slug}`, origin) },
    { key: "case study", value: `curl ${absUrl(`/work/${l.project}`, origin)}` },
  ]);
  return true;
}

function renderStatus(o: Writer, origin: string): void {
  header(o, "Status", "Measured live. This text lists what is checked.");
  o.heading("Checks");
  for (const p of projects.filter((x) => x.links.live)) {
    o.bullet(`${p.name} (${p.links.live}): HTTP check from the server with a short timeout, cached for 60 seconds.`);
  }
  o.bullet("This site: build commit and serving region.");
  o.heading("Read it");
  o.kv([
    { key: "page", value: absUrl("/status", origin) },
    { key: "JSON", value: `curl ${absUrl("/api/health", origin)}` },
  ]);
  o.push();
  o.para("unknown means the check could not run. It never means probably fine.", { indent: 0, styles: ["dim"] });
}

function renderColophon(o: Writer, origin: string): void {
  header(o, "Colophon", "How this site is built.");
  o.push();
  o.para(
    "Next.js 16 and React 19 in TypeScript, Tailwind CSS 4, three.js for the live topology, zod and vitest. Type: Archivo, IBM Plex Sans, JetBrains Mono.",
    { indent: 0 },
  );
  o.push();
  o.para(
    "Every page response carries x-request-id and a Server-Timing header with the proxy duration, request id and serving region. Try: curl -sI " +
      absUrl("/", origin),
    { indent: 0 },
  );
  machineFooter(o, origin);
}

function renderNotFound(o: Writer, path: string, origin: string): void {
  o.push(o.paint("404 not found:", "bold", "red") + " " + truncatePath(path));
  o.push();
  o.para("Valid paths:", { indent: 0 });
  o.kv(pageEntries().map((e) => ({ key: e.path, value: e.title })), { keyStyles: ["cyan"] });
  o.push();
  o.para(`Start at: curl ${absUrl("/", origin)}`, { indent: 0, styles: ["dim"] });
}

/** Render a site path for a terminal, with an HTTP status. */
export function renderAnsiPage(rawPath: string, opts: AnsiOptions): AnsiResult {
  const width = clampWidth(opts.width ?? DEFAULT_WIDTH);
  const origin = opts.origin ?? SITE_URL;
  const o = new Writer(width, opts.color);
  const path = normalizePath(rawPath);

  if (path === "/" || path === "/cv") renderHome(o, origin);
  else if (path === "/labs") renderLabs(o, origin);
  else if (path === "/status") renderStatus(o, origin);
  else if (path === "/colophon") renderColophon(o, origin);
  else if (path.startsWith("/work/") && getProject(path.slice(6))) renderProject(o, getProject(path.slice(6)) as Project, origin);
  else if (path.startsWith("/labs/") && renderLab(o, path.slice(6), origin)) {
    // rendered
  } else {
    const nf = new Writer(width, opts.color);
    renderNotFound(nf, path, origin);
    return { status: 404, body: nf.toString() };
  }
  return { status: 200, body: o.toString() };
}

/** Render a site path for a terminal. Unknown paths render a short 404 with the valid paths. */
export function renderAnsi(path: string, opts: AnsiOptions): string {
  return renderAnsiPage(path, opts).body;
}
