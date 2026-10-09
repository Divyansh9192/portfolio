/**
 * Command-line parser for the ⌘K shell.
 *
 * Grammar (a small subset of POSIX sh):
 *   list      := pipeline ( ("&&" | "||" | ";") pipeline )* [";"]
 *   pipeline  := command ( "|" command )*
 *   command   := word+
 * Words support 'single quotes' (literal), "double quotes" (backslash escapes \" and \\)
 * and backslash escapes outside quotes. A "#" at the start of a word begins a comment.
 */

export type ListOp = "&&" | "||" | ";";

export interface Segment {
  /** Operator joining this pipeline to the previous one; null for the first. */
  op: ListOp | null;
  /** Commands in the pipeline, each an argv array. */
  pipeline: string[][];
}

export type ParseResult = { ok: true; list: Segment[] } | { ok: false; error: string };

type Token = { kind: "word"; value: string } | { kind: "op"; value: ListOp | "|" };

export function tokenizeLine(input: string): { ok: true; tokens: Token[] } | { ok: false; error: string } {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c === "#") break;
    if (c === "&" && input[i + 1] === "&") {
      tokens.push({ kind: "op", value: "&&" });
      i += 2;
      continue;
    }
    if (c === "|" && input[i + 1] === "|") {
      tokens.push({ kind: "op", value: "||" });
      i += 2;
      continue;
    }
    if (c === "|") {
      tokens.push({ kind: "op", value: "|" });
      i++;
      continue;
    }
    if (c === ";") {
      tokens.push({ kind: "op", value: ";" });
      i++;
      continue;
    }
    if (c === "&") return { ok: false, error: "background jobs (&) aren't supported here; use && to chain" };
    if (c === ">" || c === "<") return { ok: false, error: `redirection (${c}) isn't supported: the filesystem is read-only` };

    // A word: concatenation of unquoted, single- and double-quoted parts.
    let word = "";
    while (i < n) {
      const ch = input[i];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === ";" || ch === "|" || ch === "&" || ch === ">" || ch === "<") break;
      if (ch === "'") {
        const end = input.indexOf("'", i + 1);
        if (end === -1) return { ok: false, error: "unterminated quote: missing closing '" };
        word += input.slice(i + 1, end);
        i = end + 1;
        continue;
      }
      if (ch === '"') {
        i++;
        let closed = false;
        while (i < n) {
          const d = input[i];
          if (d === "\\" && (input[i + 1] === '"' || input[i + 1] === "\\")) {
            word += input[i + 1];
            i += 2;
            continue;
          }
          if (d === '"') {
            closed = true;
            i++;
            break;
          }
          word += d;
          i++;
        }
        if (!closed) return { ok: false, error: 'unterminated quote: missing closing "' };
        continue;
      }
      if (ch === "\\") {
        if (i + 1 < n) word += input[i + 1];
        i += 2;
        continue;
      }
      word += ch;
      i++;
    }
    tokens.push({ kind: "word", value: word });
  }
  return { ok: true, tokens };
}

export function parse(input: string): ParseResult {
  const t = tokenizeLine(input);
  if (!t.ok) return t;
  const list: Segment[] = [];
  let op: ListOp | null = null;
  let pipeline: string[][] = [];
  let argv: string[] = [];
  let expectCommand = false; // true right after an operator that needs a command after it

  const unexpected = (tok: string) => ({ ok: false as const, error: `syntax error near unexpected token \`${tok}'` });

  for (const tok of t.tokens) {
    if (tok.kind === "word") {
      argv.push(tok.value);
      expectCommand = false;
      continue;
    }
    if (argv.length === 0) return unexpected(tok.value);
    pipeline.push(argv);
    argv = [];
    if (tok.value === "|") {
      expectCommand = true;
      continue;
    }
    list.push({ op, pipeline });
    pipeline = [];
    op = tok.value;
    expectCommand = tok.value !== ";";
  }

  if (expectCommand) return unexpected("newline");
  if (argv.length) pipeline.push(argv);
  if (pipeline.length) list.push({ op, pipeline });
  return { ok: true, list };
}

/** Quote a single argument so `parse` reads it back as one word. */
export function quoteArg(s: string): string {
  if (s === "") return "''";
  if (/^[\w@%+=:,./~#-]+$/.test(s) && !s.startsWith("#")) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
