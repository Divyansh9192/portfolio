/**
 * Shared types for the ⌘K shell. Framework-free: the executor returns structured
 * lines and effects, and React only renders them.
 */

/** Theme-token tones. The renderer maps each to a token utility (text-ok, text-sync, …). */
export type Tone = "text" | "text-2" | "text-3" | "ok" | "warn" | "crit" | "sync" | "async" | "link";

export interface Span {
  text: string;
  tone?: Tone;
  bold?: boolean;
  /** Internal path ("/work/orchrez") or external URL; rendered as a link. */
  href?: string;
  /** A shell command to run when activated; rendered as a button. */
  run?: string;
}

export interface Line {
  spans: Span[];
  /** out (default), err, echo (the prompt plus what the visitor typed), hint (dim guidance). */
  stream?: "out" | "err" | "echo" | "hint";
  /** Block indent of every row, in character cells (man pages, snippets). */
  indent?: number;
  /** Extra indent for wrapped continuation rows only (bullets, definition lists). */
  hang?: number;
  /** Keep whitespace and never wrap (tables). Consecutive pre lines scroll together. */
  pre?: boolean;
}

export type ThemeName = "dark" | "light";
export type MotionSetting = "system" | "reduce" | "full";

/** Side effects the UI applies after a run. The executor never touches the DOM. */
export type Effect =
  | { type: "navigate"; href: string }
  | { type: "external"; href: string }
  | { type: "download"; href: string }
  | { type: "theme"; value: ThemeName }
  | { type: "motion"; value: MotionSetting }
  | { type: "incident"; on: boolean }
  | { type: "overlay"; on?: boolean }
  | { type: "ask"; question: string }
  | { type: "clear" }
  | { type: "clearHistory" }
  | { type: "exit" };

/** What the shell knows between commands. */
export interface ShellState {
  cwd: string;
  /** Previous directory, for `cd -`. */
  oldCwd?: string;
  /** Command history, oldest first, including the command being run. */
  history: readonly string[];
}

export interface FetchResult {
  status: number;
  contentType: string;
  body: string;
}

/** Summary of the page's own navigation entry (see perf.ts). */
export interface NavSummary {
  reqid: string | null;
  region: string | null;
  proxyMs: number | null;
  serverTiming: { name: string; description: string; duration: number }[];
  ttfbMs: number | null;
  domContentLoadedMs: number | null;
  loadMs: number | null;
  transferSize: number | null;
  encodedBodySize: number | null;
  cache: "network" | "cache" | "unknown";
  /** One honest sentence on how `cache` was decided. */
  cacheNote: string;
  navType: string | null;
  protocol: string | null;
}

/** Everything the executor needs from the outside world. Tests inject fakes. */
export interface ShellIO {
  now(): number;
  /** Milliseconds since this page started loading, or null when unknown. */
  uptimeMs(): number | null;
  fetch(path: string, opts: { accept: string }): Promise<FetchResult>;
  navigation(): NavSummary | null;
  theme(): ThemeName;
  motion(): MotionSetting;
  /** Whether the OS currently asks for reduced motion. */
  prefersReducedMotion(): boolean;
  incidentOn(): boolean;
}

export interface RunResult {
  lines: Line[];
  effects: Effect[];
  cwd: string;
  oldCwd?: string;
  /** Exit status of the last command. */
  code: number;
  /** True when `clear` ran: the UI resets the scrollback before appending `lines`. */
  cleared: boolean;
}
