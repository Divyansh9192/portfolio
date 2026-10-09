/**
 * The shell engine: parse → execute (with && / || / ; and pipes into grep) → structured result.
 * Pure apart from the injected ShellIO, so every command is unit-testable.
 */

import type { SearchIndex } from "@/lib/search";
import { buildActions, matchActions, queryActions, type ActionHit, type QuickAction } from "./actions";
import { COMMANDS, HOST, notFound, USER, type CmdOutput, type CommandDef, type MutableState, type ShellEnv } from "./commands";
import { complete as completeInput, type Completion, type CompletionSpec } from "./complete";
import { parse } from "./parse";
import { err } from "./render";
import type { Effect, Line, RunResult, ShellIO, ShellState } from "./types";
import { allRoutes, buildVfs, dirForPathname, lookup, pathnameOf, type VfsSource } from "./vfs";

export interface ShellSource extends VfsSource {
  index: SearchIndex;
}

export interface Shell {
  env: ShellEnv;
  /** Run one command line. */
  run(input: string, state: ShellState, io: ShellIO): Promise<RunResult>;
  /** Tab completion for the current input. */
  complete(input: string, cwd: string): Completion;
  /** Quick actions for the palette under the input (plus "search"/"ask" for free text). */
  actions(query: string, limit?: number): ActionHit[];
  /** Map a URL pathname to the matching directory. */
  dirForPathname(pathname: string): string;
  /** Route for a directory path ("/work" -> "/#work"). */
  routeFor(dir: string): string;
  /** Whether a directory's route has this pathname (used to keep cwd and URL in sync). */
  dirMatchesPathname(dir: string, pathname: string): boolean;
  prompt(cwd: string): string;
  /** True when the first word of the input is a known command. */
  startsWithCommand(input: string): boolean;
  commandNames: string[];
}

export function createShell(src: ShellSource): Shell {
  const root = buildVfs(src);
  const routes = allRoutes(root);
  const routePaths = new Set(routes.map(pathnameOf).filter((p) => p !== "/"));
  const commands = new Map<string, CommandDef>(COMMANDS.map((c) => [c.name, c]));
  const actionList: QuickAction[] = buildActions(src);
  const env: ShellEnv = {
    root,
    profile: src.profile,
    projects: src.projects,
    labs: src.labs,
    index: src.index,
    actions: actionList,
    routes,
    isRoute: (p) => p.length > 1 && routePaths.has(pathnameOf(p)),
    commands,
  };
  const completionSpecs: Record<string, CompletionSpec> = Object.fromEntries(COMMANDS.map((c) => [c.name, c.complete ?? {}]));
  const slugs = src.projects.map((p) => p.slug);
  const manTopics = [...commands.keys(), ...slugs];
  completionSpecs.man = { args: (before) => (before.length === 0 ? manTopics : null) };
  const curlRoutes = Array.from(new Set(routes.map(pathnameOf))).sort();

  async function runCommand(argv: string[], state: MutableState, io: ShellIO, stdin?: Line[]): Promise<Required<CmdOutput>> {
    const [name, ...args] = argv;
    const def = commands.get(name);
    if (!def) {
      const nf = notFound(name, args, env);
      return { lines: nf.lines, effects: [], code: nf.code ?? 127 };
    }
    if (args[0] === "--help" || (args[0] === "-h" && name !== "history")) {
      return { lines: [{ spans: [{ text: `usage: ${def.usage}`, tone: "text-2" }] }, { spans: [{ text: def.summary, tone: "text-3" }], stream: "hint" }], effects: [], code: 0 };
    }
    try {
      const r = await def.run({ name, args, state, io, env, stdin });
      return { lines: r.lines, effects: r.effects ?? [], code: r.code ?? 0 };
    } catch (e) {
      return { lines: [err(`${name}: ${e instanceof Error ? e.message : String(e)}`)], effects: [], code: 1 };
    }
  }

  async function runPipeline(pipeline: string[][], state: MutableState, io: ShellIO): Promise<Required<CmdOutput>> {
    const downstream = pipeline.slice(1);
    const bad = downstream.find((c) => c[0] !== "grep");
    if (bad) {
      return { lines: [err(`sh: pipes only feed grep here, not ${bad[0]}`), { spans: [{ text: "try: ls -l /work | grep orchrez", tone: "text-3" }], stream: "hint" }], effects: [], code: 2 };
    }
    let r = await runCommand(pipeline[0], state, io);
    for (const cmd of downstream) {
      const next = await runCommand(cmd, state, io, r.lines);
      r = { lines: next.lines, effects: [...r.effects, ...next.effects], code: next.code };
    }
    return r;
  }

  async function run(input: string, state0: ShellState, io: ShellIO): Promise<RunResult> {
    const state: MutableState = { cwd: state0.cwd, oldCwd: state0.oldCwd, history: state0.history };
    const base = { cwd: state.cwd, oldCwd: state.oldCwd };
    const text = input.trim();
    if (!text) return { lines: [], effects: [], code: 0, cleared: false, ...base };
    const parsed = parse(text);
    if (!parsed.ok) return { lines: [err(`sh: ${parsed.error}`)], effects: [], code: 2, cleared: false, ...base };

    let lines: Line[] = [];
    const effects: Effect[] = [];
    let code = 0;
    let cleared = false;
    for (const seg of parsed.list) {
      if (seg.op === "&&" && code !== 0) continue;
      if (seg.op === "||" && code === 0) continue;
      const r = await runPipeline(seg.pipeline, state, io);
      code = r.code;
      if (r.effects.some((e) => e.type === "clear")) {
        lines = [];
        cleared = true;
      }
      lines.push(...r.lines);
      effects.push(...r.effects.filter((e) => e.type !== "clear"));
    }
    // Only the last navigation matters when a chain changes directory several times.
    const lastNav = effects.map((e) => e.type).lastIndexOf("navigate");
    const finalEffects = effects.filter((e, i) => e.type !== "navigate" || i === lastNav);
    return { lines, effects: finalEffects, code, cleared, cwd: state.cwd, oldCwd: state.oldCwd };
  }

  return {
    env,
    run,
    complete: (input, cwd) =>
      completeInput(input, { root, cwd, commands: completionSpecs, slugs, routes: curlRoutes }),
    actions(query, limit = 8) {
      const q = query.trim();
      const hits = matchActions(actionList, q, limit);
      if (!q) return hits;
      const extra = queryActions(q).map<ActionHit>((a) => ({ action: a, score: 0, positions: [] }));
      return [...hits.slice(0, Math.max(0, limit - extra.length)), ...extra];
    },
    dirForPathname: (p) => dirForPathname(root, p),
    routeFor(dir) {
      const node = lookup(root, dir);
      return node?.type === "dir" ? node.route : "/";
    },
    dirMatchesPathname(dir, pathname) {
      const node = lookup(root, dir);
      if (!node || node.type !== "dir") return false;
      const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
      return pathnameOf(node.route) === clean;
    },
    prompt: (cwd) => `${USER}@${HOST}:${cwd}$`,
    startsWithCommand(input) {
      const first = input.trimStart().split(/\s+/)[0] ?? "";
      return commands.has(first);
    },
    commandNames: [...commands.keys()],
  };
}
