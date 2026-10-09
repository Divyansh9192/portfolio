/**
 * Tab completion: command names in command position, then per-command arguments
 * (paths, directories, project slugs, sub-commands).
 */

import { lookup, resolvePath, type VDir } from "./vfs";

export type ArgKind = "path" | "dir" | "slug" | "command" | "route" | readonly string[];

export interface CompletionSpec {
  /** Completion source for each argument position; the last entry repeats. */
  args?: ArgKind[] | ((argsBefore: string[]) => ArgKind | null);
}

export interface CompletionEnv {
  root: VDir;
  cwd: string;
  commands: Record<string, CompletionSpec>;
  slugs: readonly string[];
  routes: readonly string[];
}

export interface Completion {
  /** The new input value. Unchanged when there is nothing to add. */
  value: string;
  /** Every candidate for the word being completed (shown when ambiguous). */
  candidates: string[];
}

function lcp(words: string[]): string {
  if (!words.length) return "";
  let p = words[0];
  for (const w of words.slice(1)) {
    let i = 0;
    while (i < p.length && i < w.length && p[i] === w[i]) i++;
    p = p.slice(0, i);
  }
  return p;
}

/** Split the input into words of the current command, plus the partial word at the end. */
function currentCommand(input: string): { words: string[]; partial: string; start: number } {
  // Find the start of the last simple command (after ; && || |), ignoring quoted text.
  let segStart = 0;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === ";" || c === "|" || (c === "&" && input[i + 1] === "&")) segStart = i + (c === "&" ? 2 : 1);
  }
  const seg = input.slice(segStart);
  const m = seg.match(/(\S*)$/);
  const partial = m ? m[1] : "";
  const before = seg.slice(0, seg.length - partial.length);
  const words = before.split(/\s+/).filter(Boolean).map((w) => w.replace(/^['"]|['"]$/g, ""));
  return { words, partial, start: input.length - partial.length };
}

function pathCandidates(env: CompletionEnv, partial: string, dirsOnly: boolean): string[] {
  const slash = partial.lastIndexOf("/");
  const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : "";
  const base = slash >= 0 ? partial.slice(slash + 1) : partial;
  const dirPath = resolvePath(env.cwd, dirPart || ".");
  const node = lookup(env.root, dirPath);
  if (!node || node.type !== "dir") return [];
  return node.children
    .filter((c) => c.name.startsWith(base) && (!dirsOnly || c.type === "dir"))
    .map((c) => dirPart + c.name + (c.type === "dir" ? "/" : ""));
}

function sourceFor(spec: CompletionSpec | undefined, argsBefore: string[]): ArgKind | null {
  if (!spec?.args) return null;
  if (typeof spec.args === "function") return spec.args(argsBefore);
  const list = spec.args;
  if (!list.length) return null;
  return list[Math.min(argsBefore.length, list.length - 1)];
}

export function complete(input: string, env: CompletionEnv): Completion {
  const { words, partial, start } = currentCommand(input);
  let candidates: string[];
  if (words.length === 0) {
    candidates = Object.keys(env.commands).filter((c) => c.startsWith(partial)).sort();
  } else {
    const [cmd, ...args] = words;
    const kind = sourceFor(env.commands[cmd], args.filter((a) => !a.startsWith("-")));
    if (!kind) return { value: input, candidates: [] };
    if (kind === "path" || kind === "dir") candidates = pathCandidates(env, partial, kind === "dir");
    else if (kind === "slug") candidates = env.slugs.filter((s) => s.startsWith(partial));
    else if (kind === "command") candidates = Object.keys(env.commands).filter((c) => c.startsWith(partial)).sort();
    else if (kind === "route") candidates = env.routes.filter((r) => r.startsWith(partial));
    else candidates = kind.filter((s) => s.startsWith(partial));
  }
  candidates = Array.from(new Set(candidates));
  if (!candidates.length) return { value: input, candidates: [] };
  if (candidates.length === 1) {
    const only = candidates[0];
    const suffix = only.endsWith("/") ? "" : " ";
    return { value: input.slice(0, start) + only + suffix, candidates };
  }
  const prefix = lcp(candidates);
  return { value: input.slice(0, start) + (prefix.length > partial.length ? prefix : partial), candidates };
}
