/**
 * Minimal ANSI renderer: SGR colours (the 16 basic ones), bold and dim, plus OSC 8 hyperlinks.
 * Colours map to the site's theme tokens so the output stays legible in both themes.
 * Every other escape sequence is stripped.
 */

import type { Line, Span, Tone } from "./types";

// Basic colours 0..7 (black, red, green, yellow, blue, magenta, cyan, white) -> theme tones.
const BASIC: (Tone | undefined)[] = ["text-3", "crit", "ok", "warn", "sync", "async", "link", "text"];

const ESC = "\u001b";
const BEL = "\u0007";

interface Style {
  tone?: Tone;
  bold?: boolean;
  dim?: boolean;
  href?: string;
}

/** Remove every escape sequence, leaving plain text. */
export function stripAnsi(s: string): string {
  return ansiToLines(s)
    .map((l) => l.spans.map((sp) => sp.text).join(""))
    .join("\n");
}

function applySgr(params: string, style: Style): Style {
  const codes = params === "" ? [0] : params.split(";").map((p) => (p === "" ? 0 : Number(p)));
  let next: Style = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) next = { href: next.href };
    else if (c === 1) next.bold = true;
    else if (c === 2) next.dim = true;
    else if (c === 22) {
      next.bold = false;
      next.dim = false;
    } else if (c >= 30 && c <= 37) next.tone = BASIC[c - 30];
    else if (c >= 90 && c <= 97) next.tone = BASIC[c - 90];
    else if (c === 39) next.tone = undefined;
    else if (c === 38 || c === 48) {
      // 256-colour or truecolour: skip the arguments, keep the default tone for 38.
      if (codes[i + 1] === 5) i += 2;
      else if (codes[i + 1] === 2) i += 4;
      if (c === 38) next.tone = undefined;
    }
    // Backgrounds (40-47, 100-107, 49) and everything else are ignored.
  }
  return next;
}

/** Parse text with ANSI escapes into lines of styled spans. */
export function ansiToLines(input: string): Line[] {
  const lines: Line[] = [];
  let spans: Span[] = [];
  let style: Style = {};
  let buf = "";

  const flush = () => {
    if (!buf) return;
    const tone: Tone | undefined = style.dim ? "text-3" : style.href ? "link" : style.tone;
    const span: Span = { text: buf };
    if (tone) span.tone = tone;
    if (style.bold) span.bold = true;
    if (style.href) span.href = style.href;
    spans.push(span);
    buf = "";
  };
  const endLine = () => {
    flush();
    lines.push({ spans: spans.length ? spans : [{ text: "" }], pre: true });
    spans = [];
  };

  const s = input.replace(/\r\n?/g, "\n");
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\n") {
      endLine();
      i++;
      continue;
    }
    if (ch === ESC) {
      const kind = s[i + 1];
      if (kind === "[") {
        // CSI: ESC [ params final
        let j = i + 2;
        while (j < s.length && /[0-9;?]/.test(s[j])) j++;
        const final = s[j];
        const params = s.slice(i + 2, j);
        if (final === "m") {
          flush();
          style = applySgr(params, style);
        }
        i = j + 1;
        continue;
      }
      if (kind === "]") {
        // OSC: ESC ] ... (BEL | ESC \)
        let j = i + 2;
        let end = -1;
        let termLen = 0;
        while (j < s.length) {
          if (s[j] === BEL) {
            end = j;
            termLen = 1;
            break;
          }
          if (s[j] === ESC && s[j + 1] === "\\") {
            end = j;
            termLen = 2;
            break;
          }
          j++;
        }
        if (end === -1) break; // unterminated: drop the rest
        const body = s.slice(i + 2, end);
        if (body.startsWith("8;")) {
          flush();
          const url = body.slice(body.indexOf(";", 2) + 1);
          style = { ...style, href: /^(https?:|mailto:|\/)/.test(url) ? url : undefined };
        }
        i = end + termLen;
        continue;
      }
      // Any other two-byte escape.
      i += 2;
      continue;
    }
    // Drop other control characters except tab.
    if (ch < " " && ch !== "\t") {
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf || spans.length || !s.endsWith("\n")) endLine();
  return lines;
}
