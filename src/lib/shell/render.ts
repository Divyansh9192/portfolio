/**
 * Turn plain text and markdown into structured shell lines. No DOM, no React.
 */

import type { Line, Span, Tone } from "./types";

export function line(text: string, tone?: Tone, extra: Partial<Line> = {}): Line {
  return { spans: [{ text, tone }], ...extra };
}

export function err(text: string): Line {
  return { spans: [{ text, tone: "crit" }], stream: "err" };
}

export function hint(text: string): Line {
  return { spans: [{ text, tone: "text-3" }], stream: "hint" };
}

export function blank(): Line {
  return { spans: [{ text: "" }] };
}

/** Plain text of a line (used by pipes into grep). */
export function lineText(l: Line): string {
  return l.spans.map((s) => s.text).join("");
}

const TAG_TONE: Record<string, Tone> = { sync: "sync", async: "async", data: "text-3" };

/**
 * Split text into spans, turning URLs, email addresses and known site routes into links,
 * and [sync] / [async] / [data] tags into their protocol tone.
 */
export function inline(text: string, base: Tone, isRoute?: (p: string) => boolean): Span[] {
  // Groups: 1 url, 2 mailto, 3 email, 4 tag, 5 char before a path, 6 path
  const re = /(https?:\/\/[^\s)]+)|(mailto:[^\s)]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|\[(sync|async|data)\]|(^|[\s(])(\/[\w./#-]*)/g;
  const spans: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const [whole, url, mailto, email, tag, before, path] = m;
    let start = m.index ?? 0;
    let span: Span | null = null;
    if (url || mailto) {
      const target = (url ?? mailto).replace(/[.,;:]+$/, "");
      span = { text: target, tone: "link", href: target };
    } else if (email) {
      const addr = email.replace(/\.+$/, "");
      span = { text: addr, tone: "link", href: `mailto:${addr}` };
    } else if (tag) span = { text: whole, tone: TAG_TONE[tag] };
    else if (path !== undefined) {
      const clean = path.replace(/[.,;:]+$/, "");
      if (!clean || !isRoute?.(clean)) continue;
      start += before.length;
      span = { text: clean, tone: "link", href: clean };
    }
    if (!span) continue;
    pushText(spans, text.slice(last, start), base);
    spans.push(span);
    last = start + span.text.length;
  }
  pushText(spans, text.slice(last), base);
  return spans.length ? spans : [{ text: "", tone: base }];
}

function pushText(spans: Span[], text: string, tone: Tone) {
  if (text) spans.push({ text, tone });
}

/** Render markdown the way `cat` would show it: raw text, lightly styled. */
export function renderMarkdown(text: string, isRoute?: (p: string) => boolean): Line[] {
  const out: Line[] = [];
  for (const raw of text.replace(/\n$/, "").split("\n")) {
    if (/^#{1,6}\s/.test(raw)) {
      const hashes = raw.match(/^#+/)![0];
      out.push({ spans: [{ text: hashes + " ", tone: "text-3" }, { text: raw.slice(hashes.length + 1), tone: "text", bold: true }] });
      continue;
    }
    if (raw.startsWith("- ")) {
      out.push({ spans: [{ text: "- ", tone: "text-3" }, ...inline(raw.slice(2), "text-2", isRoute)], hang: 2 });
      continue;
    }
    if (/^\s{2,}\S/.test(raw)) {
      out.push({ spans: inline(raw.trim(), "text-2", isRoute), indent: 2 });
      continue;
    }
    out.push({ spans: inline(raw, "text-2", isRoute) });
  }
  return out;
}

export interface Column {
  header: string;
  /** Maximum width before the cell is truncated with "…". */
  max?: number;
  align?: "left" | "right";
}

export interface Cell {
  text: string;
  tone?: Tone;
  href?: string;
  run?: string;
  bold?: boolean;
}

/** Fixed-width table as `pre` lines: header row in text-3, two spaces between columns. */
export function table(columns: Column[], rows: (string | Cell)[][]): Line[] {
  const cells: Cell[][] = rows.map((r) =>
    r.map((c, i) => {
      const cell = typeof c === "string" ? { text: c } : c;
      const max = columns[i]?.max;
      return max && cell.text.length > max ? { ...cell, text: cell.text.slice(0, max - 1) + "…" } : cell;
    }),
  );
  const widths = columns.map((col, i) => Math.max(col.header.length, ...cells.map((r) => r[i]?.text.length ?? 0)));
  const pad = (s: string, i: number) => (columns[i].align === "right" ? s.padStart(widths[i]) : s.padEnd(widths[i]));
  const lines: Line[] = [
    { spans: [{ text: columns.map((c, i) => pad(c.header, i)).join("  ").trimEnd(), tone: "text-3" }], pre: true },
  ];
  for (const r of cells) {
    const spans: Span[] = [];
    r.forEach((c, i) => {
      const last = i === r.length - 1;
      const padded = pad(c.text, i);
      const body = columns[i].align === "right" ? padded : c.text;
      if (columns[i].align === "right") spans.push({ ...c, text: body, tone: c.tone ?? "text-2" });
      else {
        spans.push({ ...c, text: body, tone: c.tone ?? "text-2" });
        if (!last) spans.push({ text: " ".repeat(widths[i] - c.text.length) });
      }
      if (!last) spans.push({ text: "  " });
    });
    lines.push({ spans, pre: true });
  }
  return lines;
}

/** Wrap a paragraph for man-page style output: one line, hanging indent; the renderer wraps it. */
export function para(text: string, indent = 7, tone: Tone = "text-2", isRoute?: (p: string) => boolean): Line {
  return { spans: inline(text, tone, isRoute), indent };
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m ${sec}s`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
